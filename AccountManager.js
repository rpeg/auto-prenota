/* eslint-disable no-undef */
/* eslint-disable no-loop-func */
/* eslint-disable no-await-in-loop */
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const faker = require('faker');
const _ = require('lodash');

const DropMailClient = require('./DropMailClient');
const CaptchaSolver = require('./CaptchaSolver');
const {
  getLoginPage, chromeOptions, getRandomAlphaNumericStr, getPassword,
} = require('./utils');

puppeteer.use(StealthPlugin());

const CAPTCHA_REGIS_PATH = './tmp/captcha_regis.jpeg';

class AccountManager {
  constructor(office, logger) {
    this.office = office;
    this.logger = logger;
    this.account = {};
    this.dropMail = new DropMailClient(this.logger);
  }

  destroy() {
    this.dropMail.close();
  }

  async initializeDropMail() {
    return new Promise((resolve, reject) => {
      this.dropMail.on('address', (address) => {
        this.logger.info(`dropmail: ${address}`);

        this.account.email = address;

        resolve();
      });
      this.dropMail.on('error', () => reject());
    });
  }

  async registerAccount() {
    puppeteer.launch(chromeOptions).then(async (browser) => {
      this.logger.info('creating new account');

      try {
        const page = await browser.newPage();

        page.setViewport({ width: 1920, height: 2500, deviceScaleFactor: 2 });

        await page.goto(getLoginPage(this.office.cid));

        await Promise.all([
          page.click('#BtnRegistrati'),
          page.waitForNavigation({ waitUntil: 'networkidle2' }),
        ]);

        this.logger.info('at registration page');

        this.account.password = getPassword();

        await page.waitForSelector('#txtNome');
        await page.click('#txtNome');
        await page.keyboard.type(faker.name.firstName());
        await page.waitForSelector('#txtCognome');
        await page.click('#txtCognome');
        await page.keyboard.type(faker.name.lastName());
        await page.waitForSelector('#ddlsesso');
        await page.select('#ddlsesso', _.sample(['m', 'f']));
        await page.waitForSelector('#ddlPref');
        await page.select('#ddlPref', '001');
        await page.waitForSelector('#txtTelefono');
        await page.click('#txtTelefono');
        await page.keyboard.type(faker.phone.phoneNumberFormat().replace(/-/g, ''));
        await page.waitForSelector('#txtEmail');
        await page.click('#txtEmail');
        await page.keyboard.type(this.account.email);
        await page.waitForSelector('#txtEmail2');
        await page.click('#txtEmail2');
        await page.keyboard.type(this.account.email);
        await page.waitForSelector('#ddlGiorno');
        await page.select('#ddlGiorno', _.padStart(_.random(1, 28).toString(), 2, '0'));
        await page.waitForSelector('#ddlMese');
        await page.select('#ddlMese', _.padStart(_.random(1, 12).toString(), 2, '0'));
        await page.waitForSelector('#ddlAnno');
        await page.select('#ddlAnno', _.random(1965, 2000).toString());
        await page.waitForSelector('#ddlNazNasc');
        await page.select('#ddlNazNasc', 'USA');
        await page.waitForSelector('#txtLuogo');
        await page.click('#txtLuogo');
        await page.keyboard.type(faker.address.state());
        await page.waitForSelector('#ddlNazRes');
        await page.select('#ddlNazRes', 'USA');
        await page.waitForSelector('#txtResidenza');
        await page.click('#txtResidenza');
        await page.keyboard.type(faker.address.state());
        await page.click('#txtCittadinanza');
        await page.keyboard.type('USA');
        await page.waitForSelector('#ddlDoc1');
        await page.select('#ddlDoc1', '1');
        await page.waitForSelector('#txtCifreDoc');
        await page.click('#txtCifreDoc');
        await page.keyboard.type(getRandomAlphaNumericStr(5));
        await page.waitForSelector('#chkTermini');
        await page.click('#chkTermini');
        await page.waitForSelector('#chkPrivacy');
        await page.click('#chkPrivacy');

        let registrationCaptchaSolved = false;
        while (!registrationCaptchaSolved) {
          await page.waitForSelector('#txtPwd');
          await page.click('#txtPwd');
          await page.keyboard.type(this.account.password);
          await page.waitForSelector('#txtPwd2');
          await page.click('#txtPwd2');
          await page.keyboard.type(this.account.password);

          const captchaSolver = new CaptchaSolver(this.logger);
          captchaSolver.path = CAPTCHA_REGIS_PATH;
          captchaSolver.page = page;

          await page.waitForSelector('#captchaReg');
          const captchaText = await captchaSolver.solveCaptcha('#captchaReg');

          if (!captchaText) throw new Error('captcha failed');

          await page.waitForSelector('#codice');

          // clear input
          await page.click('#codice', { clickCount: 3 });
          await page.keyboard.press('Backspace');

          await page.keyboard.type(captchaText);

          await page.screenshot({ path: './tmp/account_creation.png' });

          await page.waitForSelector('#btnConfermaR');
          await Promise.all([
            page.click('#btnConfermaR'),
            page.waitForNavigation({ waitUntil: 'networkidle2' }),
          ]);

          const success = await page.evaluate(() => window.find('registration was successful'));
          await page.screenshot({ path: './tmp/account_creation_clicked.png' });

          if (success) {
            this.logger.info('activation email sent');
            registrationCaptchaSolved = true;
          } else {
            this.logger.info('captcha solution was wrong. trying again.');

            await Promise.all([
              page.click('#BtnLoginKo'),
              page.waitForNavigation({ waitUntil: 'networkidle2' }),
            ]);
          }
        }

        await this.activateAccount(page);
      } catch (e) {
        this.logger.error(e);
      }
    });
  }

  async activateAccount(page) {
    await this.dropMail.on('email', async (email) => {
      await page.goto([email.match(/https:\/\/.*Default.aspx/)]);
      this.logger.info('account activated');
      this.account.activated = true;
    });
  }

  async create() {
    try {
      await this.initializeDropMail();
    } catch (e) {
      this.logger.error('dropmail failed');
    }

    await this.registerAccount();

    this.destroy();

    return this.account;
  }
}

module.exports = AccountManager;
