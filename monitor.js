/* eslint-disable no-shadow */
/* eslint-disable no-nested-ternary */
/* eslint-disable no-loop-func */
/* eslint-disable no-await-in-loop */
/* eslint-disable no-undef */

const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const base64Img = require('base64-img');
const captchaSolver = require('2captcha-node');
const moment = require('moment');
const shortid = require('shortid');
const winston = require('winston');

const { notifyMeOnConfirmation, notifyMeOnSlotFound } = require('./smtp');
require('dotenv').config();

puppeteer.use(StealthPlugin());

const CAPTCHA_LOGIN_PATH = './tmp/captcha_login.jpeg';
const CAPTCHA_CONFIRM_PATH = './tmp/captcha_confirm.jpeg';
const REFRESH_PERIOD = 10000;
const SLEEP_ERR_PERIOD = 60000;
const SLEEP_CALENDAR_PERIOD = 30000;
const CONSECUTIVE_ERROR_LIMIT = 8;
const MINIMUM_ACCEPTABLE_DATE = moment('04/04/2022', 'DD/MM/YYYY');

const solver = captchaSolver.default(process.env.KEY);

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
  LA: {
    cid: 100034,
    name: 'LA',
    username: process.env.PRENOTA_LA_LOGIN,
    password: process.env.PRENOTA_LA_PW,
    citizenshipElmId: '#ctl00_ContentPlaceHolder1_rpServizi_ctl05_btnNomeServizio',
  },
  SF: {
    cid: 100012,
    name: 'SF',
    username: process.env.PRENOTA_SF_LOGIN,
    password: process.env.PRENOTA_SF_PW,
    citizenshipElmId: '#ctl00_ContentPlaceHolder1_rpServizi_ctl02_btnNomeServizio',
    citizenship: {
      passport: process.env.PASSPORT,
      marital: process.env.MARITAL,
      citizenship: process.env.CITIZENSHIP,
      address: process.env.ADDRESS,
      profession: process.env.PROFESSION,
      guidelines: 'Yes',
    },
  },
};

const chromeOptions = {
  headless: true,
  defaultViewport: null,
  slowMo: 10,
  args: ['--no-sandbox', '--disable-setuid-sandbox'],
};

const getLoginPage = (cid) => `https://prenotaonline.esteri.it/login.aspx?cidsede=${cid}&returnUrl=//`;

const screenshotDOMElm = async (page, selector, path) => {
  const rect = await page.evaluate((selector) => {
    const element = document.querySelector(selector);
    const {
      x, y, width, height,
    } = element.getBoundingClientRect();
    return {
      left: x, top: y, width, height, id: element.id,
    };
  }, selector);

  return page.screenshot({
    path,
    clip: {
      x: rect.left,
      y: rect.top,
      width: rect.width,
      height: rect.height,
    },
  });
};

const convertCaptchaToBase64 = (path) => new Promise((resolve, reject) => {
  base64Img.base64(path, (err, data) => {
    if (err) reject(err);
    resolve(data);
  });
});

const solveCaptcha = async (page, logger, elmId, path) => {
  await screenshotDOMElm(page, elmId, path);

  logger.info('captcha at login screencapped');

  const base64 = await convertCaptchaToBase64(path);

  logger.info('captcha converted to base64');

  const captcha = await solver.solve({
    image: base64.toString(),
    maxAttempts: 10,
  });

  return captcha.text;
};

const getCalendarDate = (calendarTitle) => {
  const match = calendarTitle.match(/(\w+), (\d+)/);
  return {
    month: months.indexOf(match[1]),
    year: parseInt(match[2], 10),
  };
};

const monitorOffice = async (office) => {
  let success = false;
  let sleepForCalendarChange = false;

  const consecutiveErrors = []; // track consecutive errors so we don't waste cycles
  const pid = shortid();

  const logger = winston.createLogger({
    format: winston.format.printf((info) => `[${pid}] ${info.message}`),
    transports: [
      new winston.transports.Console(),
    ],
  });

  puppeteer.launch(chromeOptions).then(async (browser) => {
    logger.info(`launching monitor process at ${new Date().toISOString()} for ${office.name}`);

    try {
      const page = await browser.newPage();

      page.setViewport({ width: 1920, height: 1080, deviceScaleFactor: 2 });

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
        const loginCaptchaText = await solveCaptcha(
          page,
          logger,
          '#captchaLogin',
          CAPTCHA_LOGIN_PATH,
        );

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
          logger.info('login captcha failed. trying again');
          page.waitFor(5000);
        }
      }

      logger.info('at citizenship page');

      await Promise.all([
        page.click(office.citizenshipElmId),
        page.waitForNavigation({ waitUntil: 'networkidle2' }),
      ]);

      // fill out citizenship info (only req. for some offices e.g. SF)
      if (office.citizenship) {
        const controlId = '#ctl00_ContentPlaceHolder1_acc_datiAddizionali1_mycontrol';

        await page.click(`${controlId}1`);
        await page.keyboard.type(office.citizenship.passport);
        await page.select(`${controlId}2`, office.citizenship.marital);
        await page.click(`${controlId}3`);
        await page.keyboard.type(office.citizenship.citizenship);
        await page.click(`${controlId}4`);
        await page.keyboard.type(office.citizenship.address);
        await page.click(`${controlId}5`);
        await page.keyboard.type(office.citizenship.profession);
        await page.click(`${controlId}6`);
        await page.keyboard.type(office.citizenship.guidelines);
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
            notifyMeOnSlotFound(office.name, dateStr);

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
            const confirmCaptchaText = await solveCaptcha(
              page,
              logger,
              '#ctl00_ContentPlaceHolder1_confCaptcha',
              CAPTCHA_CONFIRM_PATH,
            );

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
          notifyMeOnConfirmation(office.name, dateStr);
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
        const atErrorLimit = consecutiveErrors.length >= CONSECUTIVE_ERROR_LIMIT;
        if (atErrorLimit) {
          consecutiveErrors.length = 0;
          logger.info('error limit reached');
        }

        logger.info('process unsuccessful; trying again after waiting period');

        const period = atErrorLimit ? SLEEP_ERR_PERIOD
          : sleepForCalendarChange ? SLEEP_CALENDAR_PERIOD : REFRESH_PERIOD;

        setTimeout(() => monitorOffice(office), period);
      }
    }
  });
};

monitorOffice(offices.SF);
