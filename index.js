/* eslint-disable no-shadow */
/* eslint-disable no-await-in-loop */
/* eslint-disable no-undef */

const puppeteer = require('puppeteer-extra');
const base64Img = require('base64-img');
const captchaSolver = require('2captcha-node');
const moment = require('moment');
const nodemailer = require('nodemailer');
const xoauth2 = require('xoauth2');
const shortid = require('shortid');
const winston = require('winston');

require('dotenv').config();

const CAPTCHA_LOGIN_PATH = './output/captcha_login.jpeg';
const CAPTCHA_CONFIRM_PATH = './output/captcha_confirm.jpeg';
const REFRESH_PERIOD = 20000;
const CONSECUTIVE_ERROR_LIMIT = 8;

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
  },
  SF: {
    cid: 100012,
    name: 'SF',
    username: process.env.PRENOTA_SF_LOGIN,
    password: process.env.PRENOTA_SF_PW,
  },
};

const chromeOptions = {
  headless: true,
  defaultViewport: null,
  slowMo: 10,
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

const solveCaptcha = async (page, elmId, path) => {
  await screenshotDOMElm(page, elmId, path);

  logger.info('captcha at login screencapped');

  const base64 = await convertCaptchaToBase64();

  logger.info('captcha converted to base64');

  const captcha = await solver.solve({
    image: base64.toString(),
    maxAttempts: 10,
  });

  return captcha.text;
};

const checkForSessionTimeout = async (page) => {
  if (await page.evaluate(() => window.find('Session timeout'))) {
    throw new Error(`session timeout at ${new Date().toISOString()}`);
  }
};

const getCalendarDate = (calendarTitle) => {
  const match = calendarTitle.match(/(\w+), (\d+)/);
  return {
    month: months.indexOf(match[1]),
    year: parseInt(match[2], 10),
  };
};

const getOpenDayElms = async (page) => {
  const openElms = await page.$$('.calendarCellOpen input');
  const medElms = await page.$$('.calendarCellMed input');
  const allElms = [...openElms, ...medElms];

  logger.info(allElms);

  return allElms;
};

const notifyMeOnSuccess = (officeName, dateStr) => {
  const text = `PRENOTA APPOINTMENT FOUND IN ${officeName} on ${dateStr}`;

  const transport = nodemailer.createTransport({
    service: 'gmail',
    host: 'smtp.gmail.com',
    secure: 'true',
    port: '465',
    auth: {
      type: 'OAuth2', // Authentication type
      user: 'your_email@service.com', // For example, xyz@gmail.com
      clientId: 'Your_ClientID',
      clientSecret: 'Client_Secret',
      refreshToken: 'Refresh_Token',
    },
  });

  const message = {
    from: 'elonmusk@tesla.com', // Sender address
    to: 'to@email.com', // List of recipients
    subject: text,
    text,
  };

  transport.sendMail(message, (err, info) => {
    if (err) {
      logger.log('error', err);
    } else {
      logger.info(info);
    }
  });
};

// Track consecutive errors so we don't waste cycles
const consecutiveErrors = [];

const monitorOffice = async (office) => {
  let success = false;

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

      const captchaText = await solveCaptcha(page, '#captchaLogin', CAPTCHA_LOGIN_PATH);

      logger.info(`captcha solved: ${captchaText}`);

      await page.waitForSelector('#loginCaptcha');
      await page.type('#loginCaptcha', captchaText);
      await page.waitForSelector('#UserName');
      await page.type('#UserName', office.username);
      await page.waitForSelector('#Password');
      await page.type('#Password', office.password);

      await Promise.all([
        page.click('#BtnConfermaL'),
        page.waitForNavigation({ waitUntil: 'networkidle2' }),
      ]);

      logger.info('clicked login');

      await Promise.all([
        page.click('#ctl00_repFunzioni_ctl00_btnMenuItem'),
        page.waitForNavigation({ waitUntil: 'networkidle2' }),
      ]);

      logger.info('at citizenship page');

      await Promise.all([
        page.click('#ctl00_ContentPlaceHolder1_rpServizi_ctl05_btnNomeServizio'),
        page.waitForNavigation({ waitUntil: 'networkidle2' }),
      ]);

      await Promise.all([
        page.click('#ctl00_ContentPlaceHolder1_acc_datiAddizionali1_btnContinua'),
        page.waitForNavigation({ waitUntil: 'networkidle2' }),
      ]);

      logger.info('at calendar page');

      // if slot is open, calendar will start at the corresponding month
      // so we can just nav back and forth to calendar until we find a slot
      while (!success) {
        const openDayElms = getOpenDayElms(page);

        if (openDayElms.length) {
          const spans = await page.$$('tr.calTitolo span');
          const calendarTitle = await page.evaluate((e) => e.textContent, spans[0]);
          const { month, year } = getCalendarDate(calendarTitle);

          const m = moment();
          m.set('month', month);
          m.set('year', year);

          const dateStr = m.format('MMMM YYYY');
          logger.info(`found open day at ${dateStr}`);

          await Promise.all([
            openDayElms[0].click(),
            page.waitForNavigation({ waitUntil: 'networkidle2' }),
          ]);

          const confirmButtons = await page.$$('[value="Confirm"]');
          await Promise.all([
            confirmButtons[0].click(),
            page.waitForNavigation({ waitUntil: 'networkidle2' }),
          ]);

          logger.info('at final captcha screen');

          const confirmCaptchaText = await solveCaptcha(
            page,
            'ctl00_ContentPlaceHolder1_confCaptcha',
            CAPTCHA_CONFIRM_PATH,
          );

          await page.waitForSelector('#ctl00_ContentPlaceHolder1_captchaConf');
          await page.type('#ctl00_ContentPlaceHolder1_captchaConf', confirmCaptchaText);

          await Promise.all([
            page.click('ctl00_ContentPlaceHolder1_btnFinalConf'),
            page.waitForNavigation({ waitUntil: 'networkidle2' }),
          ]);

          await checkForSessionTimeout(page);

          success = true;
        } else {
          await Promise.all([
            page.click('#ctl00_ContentPlaceHolder1_lnkBack'),
            page.waitForNavigation({ waitUntil: 'networkidle2' }),
          ]);
          await checkForSessionTimeout(page);
          logger.info('back at citizenship page');
          await page.waitFor(REFRESH_PERIOD);
          await Promise.all([
            page.click('#ctl00_ContentPlaceHolder1_acc_datiAddizionali1_btnContinua'),
            page.waitForNavigation({ waitUntil: 'networkidle2' }),
          ]);
          logger.info('back at calendar page');
          await checkForSessionTimeout(page);
        }
      }
    } catch (err) {
      consecutiveErrors.push(err);
      logger.log('error', err);
    } finally {
      await browser.close();

      if (success) {
        notifyMeOnSuccess(office, dateStr);
      } else {
        const atErrorLimit = consecutiveErrors.length >= CONSECUTIVE_ERROR_LIMIT;
        if (atErrorLimit) consecutiveErrors.length = 0;

        logger.info('process unsuccessful; trying again after waiting period');

        setTimeout(() => monitorOffice(office), atErrorLimit ? 60000 : 5000);
      }
    }
  });
};

monitorOffice(offices.LA);
