/* eslint-disable no-async-promise-executor */
/* eslint-disable no-nested-ternary */
/* eslint-disable no-loop-func */
/* eslint-disable no-await-in-loop */
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const faker = require('faker');
const _ = require('lodash');
const moment = require('moment');
const shortid = require('shortid');
const winston = require('winston');
const path = require('path');

const CaptchaSolver = require('./CaptchaSolver');
const AccountManager = require('./AccountManager');
const SmtpClient = require('./SmtpClient');

const {
  sleep, getLoginPage, getRandomDelay, getRandomProfession, chromeOptions,
} = require('./utils');

require('dotenv').config();

puppeteer.use(StealthPlugin());

const CAPTCHA_LOGIN_PATH = path.join(__dirname, '..', 'tmp', 'captcha_login.jpeg');
const CAPTCHA_CONFIRM_PATH = path.join(__dirname, '..', 'tmp', 'captcha_confirm.jpeg');
const REFRESH_PERIOD = parseInt(process.env.REFRESH_PERIOD || 30000, 10);
const SLEEP_ERR_PERIOD = 60000 * 5;
const CONSECUTIVE_ERROR_LIMIT = 5;
const CAPTCHA_ERROR_LIMIT = 5;
const MAX_ACCEPTABLE_DATE = process.env.MAX_ACCEPTABLE_DATE ? moment(process.env.MAX_ACCEPTABLE_DATE, 'MM/DD/YYYY') : undefined;
const SMTP_ENABLED = !!process.env.SMTP_ENABLED;

const getConfirmedScreenshotPath = (pid) => path.join(__dirname, '..', 'tmp', `${pid}_confirmed.jpeg`);

const MONTHS = [
  'gennaio',
  'febbraio',
  'marzo',
  'aprile',
  'maggio',
  'giugno',
  'luglio',
  'agosto',
  'settembre',
  'ottobre',
  'novembre',
  'dicembre',
];

class OfficeMonitor {
  constructor(office) {
    this.pid = shortid();
    this.logger = winston.createLogger({
      format: winston.format.printf((info) => `[${this.pid}] <${new Date().toLocaleString('en-US', { timeZone: 'America/Los_Angeles' })}> ${info.message}`),
      transports: [
        new winston.transports.Console(),
      ],
    });

    this.office = office;
    this.account = {};

    this.page = null;
    this.browser = null;

    if (SMTP_ENABLED) {
      this.smtpClient = new SmtpClient(office.name);
    }
    this.accountManager = new AccountManager(office, this.logger);

    this.consecutiveErrors = [];
    this.success = false;
  }

  static getCalendarDate(calendarTitle) {
    const match = calendarTitle.match(/(\w+), (\d+)/);
    return {
      month: MONTHS.indexOf(match[1]),
      year: parseInt(match[2], 10),
    };
  }

  async launch() {
    while (!this.success) {
      try {
        this.logger.info('launching process');

        this.account = await this.accountManager.initAccount();
        if (this.account.success) {
          this.logger.info(`appointment already booked for ${this.account.email}`);
          this.success = true;
        }

        if (this.browser) await this.browser.close();
        this.browser = await puppeteer.launch(chromeOptions);

        const captchaSolver = new CaptchaSolver(this.logger);
        this.logger.info(`monitoring ${this.office.name} with ${this.account.email}, ${this.account.password}`);

        this.page = await this.browser.newPage();
        this.page.setViewport({ width: 1920, height: 1080, deviceScaleFactor: 2 });

        await this.page.goto(getLoginPage(this.office.cid));

        await Promise.all([
          this.page.click('#BtnLogin'),
          this.page.waitForNavigation({ waitUntil: 'networkidle2' }),
        ]);

        this.logger.info('at login page');

        await this.page.waitForSelector('#UserName');
        await this.page.type('#UserName', this.account.email);

        const loginCaptchaFailures = [];
        let loginCaptchaSuccess = false;

        while (!loginCaptchaSuccess) {
          captchaSolver.page = this.page;
          captchaSolver.path = CAPTCHA_LOGIN_PATH;
          const loginCaptchaText = await captchaSolver.solveCaptcha('#captchaLogin');

          if (loginCaptchaText) {
            this.logger.info(`captcha solved: ${loginCaptchaText}`);

            await this.page.waitForSelector('#loginCaptcha');
            await this.page.type('#loginCaptcha', loginCaptchaText);
            await this.page.waitForSelector('#Password');
            await this.page.type('#Password', this.account.password);

            await Promise.all([
              this.page.click('#BtnConfermaL'),
              this.page.waitForNavigation({ waitUntil: 'networkidle2' }),
            ]);

            this.logger.info('clicked login');

            try {
              await Promise.all([
                this.page.click('#ctl00_repFunzioni_ctl00_btnMenuItem'),
                this.page.waitForNavigation({ waitUntil: 'networkidle2' }),
              ]);

              loginCaptchaSuccess = true;
            } catch (error) {
              this.logger.error('login captcha failed', error);

              const content = await this.page.content();

              if (/user does not exist/.test(content)) {
                throw new Error('account was not activated');
              }

              if (/account is blocked/.test(content)) {
                this.account.blocked = true;

                this.accountManager.deleteSavedAccount();

                throw new Error('account blocked');
              }

              loginCaptchaFailures.push(error);
              if (loginCaptchaFailures.length === CAPTCHA_ERROR_LIMIT) {
                throw new Error('login captcha error limit reached');
              }

              this.page.waitFor(1500);
            }
          }
        }

        this.logger.info('logged in');

        const citizenshipButtons = await this.page.$$('[value="Citizenship"], [value="CITIZENSHIP"]');

        await Promise.all([
          citizenshipButtons[0].click(),
          this.page.waitForNavigation({ waitUntil: 'networkidle2' }),
        ]);

        this.logger.info('at citizenship page');

        // fill out citizenship info (only req. for some offices)
        if (this.office.citizenship) {
          const controlId = '#ctl00_ContentPlaceHolder1_acc_datiAddizionali1_mycontrol';

          await this.page.click(`${controlId}1`);
          await this.page.keyboard.type(_.random(100000000, 999999999).toString());
          await this.page.select(`${controlId}2`, 'single');
          await this.page.click(`${controlId}3`);
          await this.page.keyboard.type('US');
          await this.page.click(`${controlId}4`);
          await this.page.keyboard.type(`${faker.address.streetAddress()}, ${faker.address.city()}, ${faker.address.stateAbbr()} ${faker.address.zipCode()}`);
          await this.page.click(`${controlId}5`);
          await this.page.keyboard.type(getRandomProfession());
          await this.page.click(`${controlId}6`);
          await this.page.keyboard.type('Yes');
        }

        await Promise.all([
          this.page.click('#ctl00_ContentPlaceHolder1_acc_datiAddizionali1_btnContinua'),
          this.page.waitForNavigation({ waitUntil: 'networkidle2' }),
        ]);

        this.logger.info('at calendar page');

        // if slot is open, calendar will start at the corresponding month
        // refresh page until we find an open slot
        while (!this.success) {
          const openElms = await this.page.$$('.calendarCellOpen input');
          const medElms = await this.page.$$('.calendarCellMed input');
          const openDayElms = openElms.concat(medElms);

          if (openDayElms.length) {
            const openDayElm = openDayElms[0];

            const spans = await this.page.$$('tr.calTitolo span');
            const calendarTitle = await this.page.evaluate((e) => e.textContent, spans[0]);
            const { month, year } = OfficeMonitor.getCalendarDate(calendarTitle);
            const day = await this.page.evaluate((e) => e.getAttribute('value'), openDayElm);

            const m = moment();
            m.set('day', parseInt(day, 10));
            m.set('month', month);
            m.set('year', year);

            const dateStr = m.format('MMMM DD, YYYY');
            const slotFound = `SLOT FOUND IN ${this.office.name} ON ${dateStr}`;
            this.logger.info(slotFound);
            this.smtpClient && this.smtpClient.notifyMe(slotFound);

            if (!MAX_ACCEPTABLE_DATE || m.isBefore(MAX_ACCEPTABLE_DATE)) {
              await Promise.all([
                openDayElm.click(),
                this.page.waitForNavigation({ waitUntil: 'networkidle2' }),
              ]);

              const confirmButtons = await this.page.$$('[value="Confirm"]');
              await Promise.all([
                confirmButtons[0].click(),
                this.page.waitForNavigation({ waitUntil: 'networkidle2' }),
              ]);

              this.logger.info('at final captcha screen');

              let confirmCaptchaSuccess = false;

              while (!confirmCaptchaSuccess) {
                captchaSolver.page = this.page;
                captchaSolver.path = CAPTCHA_CONFIRM_PATH;

                const confirmCaptchaText = await captchaSolver.solveCaptcha('#ctl00_ContentPlaceHolder1_confCaptcha');
                this.logger.info(`final captcha text: ${confirmCaptchaText}`);

                await this.page.waitForSelector('#ctl00_ContentPlaceHolder1_captchaConf');
                await this.page.type('#ctl00_ContentPlaceHolder1_captchaConf', confirmCaptchaText);

                // click confirm appt
                await Promise.all([
                  this.page.click('#ctl00_ContentPlaceHolder1_btnFinalConf'),
                  this.page.waitForNavigation({ waitUntil: 'networkidle2' }),
                ]);

                const content = await this.page.content();
                this.logger.info(content);

                if (/Errors occurred/i.test(content) === false) {
                  confirmCaptchaSuccess = true;
                  this.logger.info(await this.page.content());
                }
              }

              try {
                await this.page.screenshot({ path: getConfirmedScreenshotPath(this.pid) });
              } catch(e) { this.logger.error(e); }

              const title = `APPOINTMENT BOOKED IN ${this.office.name} ON ${dateStr}`;
              const body = `user: ${this.account.email}, pw: ${this.account.password}`
              this.logger.info(title + ' ' + body);
              this.smtpClient && this.smtpClient.notifyMe(title, body);

              this.account.success = true;
              this.accountManager.saveAccount(this.account);
              this.success = true;
            } else {
              this.logger.info('slot is too far away. going to sleep');
              this.page.waitFor(SLEEP_ERR_PERIOD);
              throw new Error('');
            }
          } else {
            await this.page.waitFor(getRandomDelay(REFRESH_PERIOD));

            // Refresh
            await this.page.reload({ waitUntil: ["networkidle0", "domcontentloaded"] });

            this.logger.info('refreshed calendar');

            // Session expired
            if ((await this.page.$('#ctl00_ContentPlaceHolder1_lnkBack')) == null) {
              this.logger.info('session expired');
              break;
            }
          }
        }
      } catch (err) {
        this.consecutiveErrors.push(err);
        this.logger.error(err);
      } finally {
        if (this.browser) {
          await this.browser.close();
        }
      }

      const atErrorLimit = this.consecutiveErrors.length >= CONSECUTIVE_ERROR_LIMIT;
      if (atErrorLimit) {
        this.consecutiveErrors.length = 0;
        this.logger.info('error limit reached');
        this.accountManager.deleteSavedAccount();
      }

      this.logger.info('process unsuccessful; trying again after waiting period');

      const period = atErrorLimit ? SLEEP_ERR_PERIOD : REFRESH_PERIOD;

      await sleep(period);
    }
  }
}

module.exports = OfficeMonitor;
