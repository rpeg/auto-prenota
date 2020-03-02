
const puppeteer = require('puppeteer-extra');
const base64Img = require('base64-img');
const fs = require('fs');
const axios = require('axios');
const captchaSolver = require('2captcha-node');

require('dotenv').config();

const sleep = require('./utils');

const CAPTCHA_PATH = './output/captcha.jpeg';

const solver = captchaSolver.default(process.env.KEY);

const offices = {
  LA: {
    cid: 100034,
    username: process.env.PRENOTA_LA_LOGIN,
    password: process.env.PRENOTA_LA_PW,
  },
  SF: {
    cid: 100012,
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

const downloadFile = (url, dest) => axios({
  url,
  responseType: 'stream',
}).then(
  (res) => new Promise((resolve, reject) => {
    res.data
      .pipe(fs.createWriteStream(dest))
      .on('finish', () => resolve(true))
      .on('error', (e) => reject(e));
  }),
);

const convertCaptchaToBase64 = () => new Promise((resolve, reject) => {
  base64Img.base64(CAPTCHA_PATH, (err, data) => {
    if (err) reject(err);
    resolve(data);
  });
});

const monitorOffice = async (office) => {
  puppeteer.launch(chromeOptions).then(async (browser) => {
    console.log(`launching monitor process at ${new Date().toISOString()}} for ${office.cid}`);

    try {
      const page = await browser.newPage();

      await page.goto(getLoginPage(office.cid));
      await page.click('#BtnLogin');

      await sleep(2000);

      console.log('login page');

      const captchaElmSrc = await page.$eval('#captchaLogin', (el) => el.getAttribute('src'));
      const captchaUrl = `https://prenotaonline.esteri.it/${captchaElmSrc}.jpeg`;

      const downloadSuccess = await downloadFile(captchaUrl, CAPTCHA_PATH);

      if (!downloadSuccess) throw new Error('captcha download failed');

      console.log('captcha downloaded');

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

      // Make Your Reservation
      await page.screenshot({ path: './output/Reservation.png', fullPage: true });
      await page.click('#ctl00_repFunzioni_ctl00_btnMenuItem');
      await sleep(1000);

      // Citizenship
      console.log('at citizenship page');
      await page.screenshot({ path: './output/Citizenship.png', fullPage: true });
      await page.click('ctl00_ContentPlaceHolder1_rpServizi_ctl05_btnNomeServizio');
      await page.click('ctl00_ContentPlaceHolder1_acc_datiAddizionali1_btnContinua');
      await sleep(1000);

      // Calendar
      console.log('at calendar page');
      await page.screenshot({ path: './output/Calendar.png', fullPage: true });
    //   });
    } catch (err) {
      console.log(err);
    } finally {
      await browser.close();
      // monitorOffice(office);
    }
  });
};

monitorOffice(offices.LA);
