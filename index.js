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

const CAPTCHA_PATH = './output/captcha.jpeg';
const REFRESH_PERIOD = 20000;

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

const convertCaptchaToBase64 = () => new Promise((resolve, reject) => {
  base64Img.base64(CAPTCHA_PATH, (err, data) => {
    if (err) reject(err);
    resolve(data);
  });
});

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

const notifyMe = (officeName, dateStr) => {
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
      const tabs = [page];

      page.setViewport({ width: 1920, height: 1080, deviceScaleFactor: 2 });

      await page.goto(getLoginPage(office.cid));
      await page.click('#BtnLogin');
      await page.waitFor(1000);

      logger.info('at login page');

      await screenshotDOMElm(page, '#captchaLogin', CAPTCHA_PATH);

      logger.info('captcha screencapped');

      const base64 = await convertCaptchaToBase64();

      logger.info('captcha converted to base64');

      const captcha = await solver.solve({
        image: base64.toString(),
        maxAttempts: 10,
      });

      if (!captcha || !captcha.text) throw new Error('captcha solve failed');

      logger.info(`captcha solved: ${captcha.text}`);

      await page.waitForSelector('#loginCaptcha');
      await page.type('#loginCaptcha', captcha.text);
      await page.waitForSelector('#UserName');
      await page.type('#UserName', office.username);
      await page.waitForSelector('#Password');
      await page.type('#Password', office.password);
      await page.click('#BtnConfermaL');
      await page.waitFor(1000);

      logger.info('logged in');

      await page.click('#ctl00_repFunzioni_ctl00_btnMenuItem');
      await page.waitFor(1000);

      logger.info('at citizenship page');

      await page.click('#ctl00_ContentPlaceHolder1_rpServizi_ctl05_btnNomeServizio');
      await page.click('#ctl00_ContentPlaceHolder1_acc_datiAddizionali1_btnContinua');
      await page.waitFor(1000);

      logger.info('at calendar page');

      const span = await page.$$('tr.calTitolo span');
      const calendarTitle = await page.evaluate((e) => e.textContent, span[0]);
      const { month, year } = getCalendarDate(calendarTitle);

      const d = moment();

      const numMonthsAheadOfCurrent = month >= d.month()
        ? ((year - d.year()) * 12) + month - d.month()
        : (Math.ceil(0, year - 1 - d.year()) * 12) + (11 - d.month()) + month;

      d.add(numMonthsAheadOfCurrent, 'month');

      logger.info(`start date: ${month + 1}/${year} (${numMonthsAheadOfCurrent} months ahead)`);

      // open prev months in new tabs, until we reach current month
      for (let i = 0; i < numMonthsAheadOfCurrent; i += 1) {
        const currentTab = tabs.slice(-1)[0];

        const newPagePromise = new Promise((resolve, reject) => {
          const tId = setTimeout(() => reject(new Error('timeout on new calendar tab')), REFRESH_PERIOD);

          browser.once('targetcreated', (target) => {
            clearTimeout(tId);
            resolve(target.page());
          });
        });

        const prevButton = await currentTab.$$('[value="<"]');

        // open in new tab
        await page.keyboard.down('MetaLeft');
        await prevButton[0].click();
        await page.keyboard.up('MetaLeft');

        d.subtract(1, 'month');
        logger.info(`tab opening for ${d.format('MMMM YYYY')}`);

        const newPage = await newPagePromise;

        await newPage.screenshot({ path: `./output/${pid}_${d.format('MMMM')}_${d.format('YYYY')}.png`, fullPage: true });

        await checkForSessionTimeout(newPage);

        tabs.push(newPage);
      }

      logger.info('tabs created');

      // monitor each tab for open slots
      tabs.forEach(async (tab, i) => {
        const openDayElms = [];

        while (!success) {
          openDayElms.push(...getOpenDayElms(tab));

          if (openDayElms.length) {
            const m = moment();
            m.subtract(i, 'mon');

            const dateStr = m.format('MMMM YYYY');

            const foundStatement = `open slot found in ${office.name}, ${dateStr}`;
            logger.info(foundStatement);

            notifyMe(office.name, dateStr);

            success = true;
          } else {
            await tab.waitFor(REFRESH_PERIOD);
            await tab.reload({ waitUntil: ['networkidle0', 'domcontentloaded'] }); // refresh
            await checkForSessionTimeout(tab);
          }
        }

        // try to capture page after clicking open day
        await openDayElms[0].click();
        await tab.waitFor(1500);
        await checkForSessionTimeout(tab);
        const html = await tab.content();
        fs.writeFileSync('./output/open-day.html', html);
        tab.screenshot({ path: `./output/${pid}_after_date_click.png`, fullPage: true });
      });
    } catch (err) {
      logger.log('error', err);
    } finally {
      await browser.close();
      if (!success) {
        logger.info('process unsuccessful; trying again after waiting period');
        setTimeout(() => monitorOffice(office), REFRESH_PERIOD);
      }
    }
  });
};

monitorOffice(offices.LA);
