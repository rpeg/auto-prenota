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

const CAPTCHA_LOGIN_PATH = './tmp/captcha_login.jpeg';
const CAPTCHA_CONFIRM_PATH = './tmp/captcha_confirm.jpeg';
const REFRESH_PERIOD = 10000;
const SLEEP_ERR_PERIOD = 60000 * 5;
const SLEEP_CALENDAR_PERIOD = 30000;
const CONSECUTIVE_ERROR_LIMIT = 8;
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

const offices = {
  SF: {
    cid: 100012,
    name: 'SF',
    citizenship: true,
  },
};

const consecutiveErrors = [];

const getCalendarDate = (calendarTitle) => {
  const match = calendarTitle.match(/(\w+), (\d+)/);
  return {
    month: months.indexOf(match[1]),
    year: parseInt(match[2], 10),
  };
};

const monitorOffice = async (office, createNewAccount) => {
  let account = null;

  let success = false;
  let accountBlocked = false;
  let sleepForCalendarChange = false;

  const pid = shortid();

  const logger = winston.createLogger({
    format: winston.format.printf((info) => `[${pid}] ${info.message}`),
    transports: [
      new winston.transports.Console(),
    ],
  });

  const smtpClient = new SmtpClient(office.name);
  const accountManager = new AccountManager(office, logger);

  if (createNewAccount) {
    try {
      account = await accountManager.create();

      if (account === {}) throw new Error('account creation failed');
      if (!account.activated) throw new Error('account failed to activate');
    } catch (err) {
      consecutiveErrors.push(err);
      logger.log('error', err);

      setTimeout(() => monitorOffice(office, true), SLEEP_ERR_PERIOD);
      return;
    }
  }

  puppeteer.launch(chromeOptions).then(async (browser) => {
    const captchaSolver = new CaptchaSolver(logger);

    logger.info(`launching monitor process at ${new Date().toISOString()} for ${office.name}`);

    try {
      const page = await browser.newPage();

      await page.goto(getLoginPage(office.cid));

      await Promise.all([
        page.click('#BtnLogin'),
        page.waitForNavigation({ waitUntil: 'networkidle2' }),
      ]);

      logger.info('at login page');

      await page.waitForSelector('#UserName');
      await page.type('#UserName', office.username);

      let loginCaptchaSuccess = false;
      while (!loginCaptchaSuccess) {
        captchaSolver.page = page;
        captchaSolver.path = CAPTCHA_LOGIN_PATH;
        const loginCaptchaText = await captchaSolver.solveCaptcha('#captchaLogin');

        logger.info(`captcha solved: ${loginCaptchaText}`);

        await page.waitForSelector('#loginCaptcha');
        await page.type('#loginCaptcha', loginCaptchaText);
        await page.waitForSelector('#Password');
        await page.type('#Password', office.password);

        await Promise.all([
          page.click('#BtnConfermaL'),
          page.waitForNavigation({ waitUntil: 'networkidle2' }),
        ]);

        logger.info('clicked login');

        try {
          await Promise.all([
            page.click('#ctl00_repFunzioni_ctl00_btnMenuItem'),
            page.waitForNavigation({ waitUntil: 'networkidle2' }),
          ]);

          loginCaptchaSuccess = true;
        } catch (error) {
          logger.info('login captcha failed');

          if ((await page.content()).match(/account is blocked/)) {
            accountBlocked = true;
            logger.info('account has been blocked');
            throw new Error('blocked');
          }

          page.waitFor(1500);
        }
      }

      logger.info('at citizenship page');
      const citizenshipConfirmButtons = await page.$$('[value="Confirm"]');

      await Promise.all([
        citizenshipConfirmButtons[0].click(),
        page.waitForNavigation({ waitUntil: 'networkidle2' }),
      ]);

      // fill out citizenship info (only req. for some offices e.g. SF)
      if (office.citizenship) {
        const controlId = '#ctl00_ContentPlaceHolder1_acc_datiAddizionali1_mycontrol';

        await page.click(`${controlId}1`);
        await page.keyboard.type(_.random(100000000, 999999999));
        await page.select(`${controlId}2`, 'single');
        await page.click(`${controlId}3`);
        await page.keyboard.type('US');
        await page.click(`${controlId}4`);
        await page.keyboard.type(`${faker.address.streetAddress()}, ${faker.address.city()}, ${faker.address.stateAbbr()} ${faker.address.zipCode()}`);
        await page.click(`${controlId}5`);
        await page.keyboard.type(getRandomProfession());
        await page.click(`${controlId}6`);
        await page.keyboard.type('Yes');
      }

      await Promise.all([
        page.click('#ctl00_ContentPlaceHolder1_acc_datiAddizionali1_btnContinua'),
        page.waitForNavigation({ waitUntil: 'networkidle2' }),
      ]);

      logger.info('at calendar page');

      // if slot is open, calendar will start at the corresponding month
      // so we can just nav back and forth to calendar until we find a slot
      while (!success && !sleepForCalendarChange) {
        const openElms = await page.$$('.calendarCellOpen input');
        const medElms = await page.$$('.calendarCellMed input');
        const openDayElms = openElms.concat(medElms);

        if (openDayElms.length) {
          const openDayElm = openDayElms[0];

          const spans = await page.$$('tr.calTitolo span');
          const calendarTitle = await page.evaluate((e) => e.textContent, spans[0]);
          const { month, year } = getCalendarDate(calendarTitle);
          const day = await page.evaluate((e) => e.getAttribute('value'), openDayElm);

          const m = moment();
          m.set('day', parseInt(day, 10));
          m.set('month', month);
          m.set('year', year);

          const dateStr = m.format('MMMM DD, YYYY');
          logger.info(`found open day at ${dateStr}`);

          // open slot is too far in advance. wait for five minutes before rechecking server
          if (m >= MINIMUM_ACCEPTABLE_DATE) {
            smtpClient.notifyMeOnSlotFound(dateStr);

            logger.info('slot is too far away. trying again after sleep');
            sleepForCalendarChange = true;
            return;
          }

          await Promise.all([
            openDayElm.click(),
            page.waitForNavigation({ waitUntil: 'networkidle2' }),
          ]);

          const confirmButtons = await page.$$('[value="Confirm"]');
          await Promise.all([
            confirmButtons[0].click(),
            page.waitForNavigation({ waitUntil: 'networkidle2' }),
          ]);

          logger.info('at final captcha screen');

          let confirmCaptchaSuccess = false;
          while (!confirmCaptchaSuccess) {
            captchaSolver.page = page;
            captchaSolver.path = CAPTCHA_CONFIRM_PATH;
            const confirmCaptchaText = await captchaSolver.solveCaptcha('#ctl00_ContentPlaceHolder1_confCaptcha');

            await page.waitForSelector('#ctl00_ContentPlaceHolder1_captchaConf');
            await page.type('#ctl00_ContentPlaceHolder1_captchaConf', confirmCaptchaText);

            // click confirm appt
            await Promise.all([
              page.click('#ctl00_ContentPlaceHolder1_btnFinalConf'),
              page.waitForNavigation({ waitUntil: 'networkidle2' }),
            ]);

            try {
              // if captcha element remains, we must have entered wrong solution
              await page.waitForSelector('#ctl00_ContentPlaceHolder1_captchaConf', { timeout: 2000 });
            } catch (error) {
              // no captcha element found; must be on next screen
              confirmCaptchaSuccess = true;
            }
          }

          await page.screenshot({ path: `./tmp/${pid}_confirmed.png` });
          smtpClient.notifyMeOnConfirmation(dateStr);
          success = true;
        } else {
          await Promise.all([
            page.click('#ctl00_ContentPlaceHolder1_lnkBack'),
            page.waitForNavigation({ waitUntil: 'networkidle2' }),
          ]);

          logger.info('back at citizenship page');

          await page.waitFor(REFRESH_PERIOD);

          await Promise.all([
            page.click('#ctl00_ContentPlaceHolder1_acc_datiAddizionali1_btnContinua'),
            page.waitForNavigation({ waitUntil: 'networkidle2' }),
          ]);

          logger.info('back at calendar page');
        }
      }
    } catch (err) {
      consecutiveErrors.push(err);
      logger.log('error', err);
    } finally {
      await browser.close();

      if (!success) {
        if (accountBlocked) {
          setTimeout(() => monitorOffice(office, true), SLEEP_ERR_PERIOD);
        } else {
          const atErrorLimit = consecutiveErrors.length >= CONSECUTIVE_ERROR_LIMIT;
          if (consecutiveErrors.length >= CONSECUTIVE_ERROR_LIMIT) {
            consecutiveErrors.length = 0;
            logger.info('error limit reached');
          }

          logger.info('process unsuccessful; trying again after waiting period');

          const period = atErrorLimit ? SLEEP_ERR_PERIOD
            : sleepForCalendarChange ? SLEEP_CALENDAR_PERIOD : REFRESH_PERIOD;

          setTimeout(() => monitorOffice(office, account), period);
        }
      }
    }
  });
};

monitorOffice(offices.SF, true);
