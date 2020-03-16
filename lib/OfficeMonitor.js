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

const CaptchaSolver = require('./CaptchaSolver');
const AccountManager = require('./AccountManager');
const SmtpClient = require('./SmtpClient');

const { getLoginPage, getRandomProfession, chromeOptions } = require('./utils');

require('dotenv').config();

puppeteer.use(StealthPlugin());

const CAPTCHA_LOGIN_PATH = '../tmp/captcha_login.jpeg';
const CAPTCHA_CONFIRM_PATH = '../tmp/captcha_confirm.jpeg';
const REFRESH_PERIOD = 30000;
const SLEEP_ERR_PERIOD = 60000 * 5;
const CONSECUTIVE_ERROR_LIMIT = 5;
const MINIMUM_ACCEPTABLE_DATE = moment('04/04/2022', 'DD/MM/YYYY');

const months = [
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
      format: winston.format.printf((info) => `[${this.pid}] <${new Date().toLocaleTimeString()}> ${info.message}`),
      transports: [
        new winston.transports.Console(),
      ],
    });

    this.office = office;
    this.account = {};

    this.page = null;
    this.browser = null;

    this.smtpClient = new SmtpClient(office.name);
    this.accountManager = new AccountManager(office, this.logger);

    this.consecutiveErrors = [];
    this.success = false;
  }

  static getCalendarDate(calendarTitle) {
    const match = calendarTitle.match(/(\w+), (\d+)/);
    return {
      month: months.indexOf(match[1]),
      year: parseInt(match[2], 10),
    };
  }

  async monitor() {
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
          this.logger.info('login captcha failed');

          const content = await this.page.content();

          if (/account is blocked/.test(content)) {
            this.account.blocked = true;
            this.logger.info('account has been blocked');
            throw new Error('account blocked');
          }

          this.page.waitFor(1500);
        }
      }
    }

    this.logger.info('at citizenship page');

    const citizenshipButtons = await this.page.$$('[value="Citizenship"]');

    await Promise.all([
      citizenshipButtons[0].click(),
      this.page.waitForNavigation({ waitUntil: 'networkidle2' }),
    ]);

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
    // so we can just nav back and forth to calendar until we find a slot
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
        this.logger.info(`found open day at ${dateStr}`);

        // open slot is too far in advance. wait for five minutes before rechecking server
        if (m >= MINIMUM_ACCEPTABLE_DATE) {
          this.smtpClient.notifyMeOnSlotFound(dateStr);
          throw new Error('slot is too far away. trying again after sleep');
        }

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

          await this.page.waitForSelector('#ctl00_ContentPlaceHolder1_captchaConf');
          await this.page.type('#ctl00_ContentPlaceHolder1_captchaConf', confirmCaptchaText);

          // click confirm appt
          await Promise.all([
            this.page.click('#ctl00_ContentPlaceHolder1_btnFinalConf'),
            this.page.waitForNavigation({ waitUntil: 'networkidle2' }),
          ]);

          try {
            // if captcha element remains, we must have entered wrong solution
            await this.page.waitForSelector('#ctl00_ContentPlaceHolder1_captchaConf', { timeout: 2000 });
          } catch (error) {
            // no captcha element found; must be on next screen
            confirmCaptchaSuccess = true;
          }
        }

        await this.page.screenshot({ path: `../tmp/${this.pid}_confirmed.png` });

        this.smtpClient.notifyMeOnConfirmation(dateStr);
        this.success = true;
      } else {
        await this.page.waitFor(REFRESH_PERIOD / 2);

        await Promise.all([
          this.page.click('#ctl00_ContentPlaceHolder1_lnkBack'),
          this.page.waitForNavigation({ waitUntil: 'networkidle2' }),
        ]);

        this.logger.info('back at citizenship page');

        await this.page.waitFor(REFRESH_PERIOD);

        await Promise.all([
          this.page.click('#ctl00_ContentPlaceHolder1_acc_datiAddizionali1_btnContinua'),
          this.page.waitForNavigation({ waitUntil: 'networkidle2' }),
        ]);

        this.logger.info('back at calendar page');
      }
    }
  }

  async launch() {
    try {
      this.account = await this.accountManager.create();
      await this.monitor();
    } catch (err) {
      this.consecutiveErrors.push(err);
      this.logger.error(err);
    } finally {
      if (this.browser) { await this.browser.close(); }

      if (!this.success) {
        if (this.account.blocked) { this.account = await this.accountManager.create(); }

        const atErrorLimit = this.consecutiveErrors.length >= CONSECUTIVE_ERROR_LIMIT;
        if (atErrorLimit) {
          this.consecutiveErrors.length = 0;
          this.logger.info('error limit reached');
        }

        this.logger.info('process unsuccessful; trying again after waiting period');

        const period = atErrorLimit ? SLEEP_ERR_PERIOD : REFRESH_PERIOD;

        setTimeout(() => this.monitor, period);
      }
    }
  }
}

module.exports = OfficeMonitor;
