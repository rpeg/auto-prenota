/* eslint-disable no-await-in-loop */
/* eslint-disable no-undef */

const puppeteer = require('puppeteer-extra');
const base64Img = require('base64-img');
const captchaSolver = require('2captcha-node');
const moment = require('moment');
const nodemailer = require('nodemailer');
const xoauth2 = require('xoauth2');

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
  headless: false,
  defaultViewport: null,
  slowMo: 10,
};

const getLoginPage = (cid) => `https://prenotaonline.esteri.it/login.aspx?cidsede=${cid}&returnUrl=//`;

const sleep = (ms) => new Promise((resolve) => {
  setTimeout(resolve, ms);
});

const screenshotDOMElm = async (page, selector, path) => {
  // eslint-disable-next-line no-shadow
  const rect = await page.evaluate((selector) => {
    // eslint-disable-next-line no-undef
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

const isSessionTimeout = (page) => page.evaluate(() => window.find('Session timeout'));

const getCalendarDate = (calendarTitle) => {
  const match = calendarTitle.match(/(\w+), (\d+)/);
  return {
    month: months.indexOf(match[1]),
    year: parseInt(match[2], 10),
  };
};

const getOpenDay = (page) => {

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
      console.log(err);
    } else {
      console.log(info);
    }
  });
};

const monitorOffice = async (office) => {
  let success = false;

  puppeteer.launch(chromeOptions).then(async (browser) => {
    console.log(`launching monitor process at ${new Date().toISOString()}} for ${office.cid}`);

    try {
      const page = await browser.newPage();
      const tabs = [page];

      page.setViewport({ width: 1920, height: 1080, deviceScaleFactor: 2 });

      await page.goto(getLoginPage(office.cid));
      await page.click('#BtnLogin');
      await sleep(1500);

      console.log('login page');

      await screenshotDOMElm(page, '#captchaLogin', CAPTCHA_PATH);

      console.log('captcha screenshotted');

      const base64 = await convertCaptchaToBase64();

      console.log('captcha converted to base64');

      const captcha = await solver.solve({
        image: base64.toString(),
        maxAttempts: 10,
      });

      if (!captcha || !captcha.text) throw new Error('captcha solve failed');

      console.log(`captcha solved: ${captcha.text}`);

      await page.waitForSelector('#loginCaptcha');
      await page.type('#loginCaptcha', captcha.text);

      await page.waitForSelector('#UserName');
      await page.type('#UserName', office.username);

      await page.waitForSelector('#Password');
      await page.type('#Password', office.password);

      await page.click('#BtnConfermaL');

      await sleep(1000);

      console.log('logged in');
      await page.screenshot({ path: './output/Reservation.png', fullPage: true });
      await page.click('#ctl00_repFunzioni_ctl00_btnMenuItem');
      await sleep(1000);

      console.log('at citizenship page');
      await page.screenshot({ path: './output/Citizenship.png', fullPage: true });
      await page.click('#ctl00_ContentPlaceHolder1_rpServizi_ctl05_btnNomeServizio');
      await page.click('#ctl00_ContentPlaceHolder1_acc_datiAddizionali1_btnContinua');
      await sleep(1000);

      console.log('at calendar page');
      await page.screenshot({ path: './output/Calendar.png', fullPage: true });

      const d = new Date();

      const calendarHeaderElm = await page.$('.calTitolo');
      const calendarTitle = calendarHeaderElm.children[1].children[0].textContent;
      console.log(`calendar title: ${calendarTitle}`);

      const { month, year } = getCalendarDate(calendarTitle);
      const numMonthsAheadOfCurrent = month >= d.getMonth()
        ? ((year - d.year()) * 12) + month - d.getMonth()
        : (Math.ceil(0, year - 1 - d.year()) * 12) + (11 - d.getMonth()) + month;

      console.log(`booking is ${numMonthsAheadOfCurrent} months ahead`);

      // open prev months in new tabs, until we reach current month
      for (let i = 0; i < numMonthsAheadOfCurrent; i += 1) {
        const newPagePromise = new Promise((x) => browser.once('targetcreated', (target) => x(target.page())));
        const prevButton = await page.$('[value="<"]');
        await prevButton.click({ button: 'middle' }); // new tab
        const newPage = await newPagePromise;

        if (isSessionTimeout(newPage)) throw new Error(`session timeout at ${new Date().toISOString()}`);

        tabs.push(newPage);
      }

      console.log('tabs created');

      // monitor each tab for DOM mutations periodically
      tabs.forEach((t, i) => {
        while (!success) {
          const openDay = getOpenDay();
          if (openDay) {
            const m = moment();
            m.subtract('months', i);
            m.set('day', openDay);

            const dateStr = m.format('MMMM Do YYYY');

            const foundStatement = `open slot found in ${office.name} on ${dateStr}`;
            console.log(foundStatement);

            notifyMe(office.name, dateStr);

            success = true;
          }
        }
      });
    } catch (err) {
      console.log(err);
    } finally {
      await browser.close();
      // monitorOffice(office);
    }
  });
};

monitorOffice(offices.LA);
