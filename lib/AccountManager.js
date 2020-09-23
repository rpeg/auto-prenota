/* eslint-disable class-methods-use-this */
/* eslint-disable no-undef */
/* eslint-disable no-loop-func */
/* eslint-disable no-await-in-loop */
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const faker = require('faker');
const fs = require('fs');
const path = require('path');
const _ = require('lodash');

const TempMailClient = require('./TempMailClient');
const CaptchaSolver = require('./CaptchaSolver');
const {
  sleep, getLoginPage, chromeOptions, getRandomAlphaNumericStr, getPassword,
} = require('./utils');

puppeteer.use(StealthPlugin());

require('dotenv').config();

const CAPTCHA_REGIS_PATH = path.join(__dirname, '..', 'tmp', 'captcha_regis.jpeg');
const ACCOUNT_PATH = path.join(__dirname, '..', 'tmp', 'account.json');

class AccountManager {
  constructor(office, logger) {
    this.page = null;
    this.browser = null;

    this.office = office;
    this.logger = logger;
    this.account = {};
    this.tempMail = new TempMailClient(this.logger);
  }

  async fillOutForm() {
    await this.page.waitForSelector('#txtNome');
    await this.page.click('#txtNome');
    await this.page.keyboard.type(this.account.firstName);
    await this.page.waitForSelector('#txtCognome');
    await this.page.click('#txtCognome');
    await this.page.keyboard.type(this.account.lastName);
    await this.page.waitForSelector('#ddlsesso');
    await this.page.select('#ddlsesso', _.sample(['m', 'f']));
    await this.page.waitForSelector('#ddlPref');
    await this.page.select('#ddlPref', '001');
    await this.page.waitForSelector('#txtTelefono');
    await this.page.click('#txtTelefono');
    await this.page.keyboard.type(faker.phone.phoneNumberFormat().replace(/-/g, ''));
    await this.page.waitForSelector('#txtEmail');
    await this.page.click('#txtEmail');
    await this.page.keyboard.type(this.account.email);
    await this.page.waitForSelector('#txtEmail2');
    await this.page.click('#txtEmail2');
    await this.page.keyboard.type(this.account.email);
    await this.page.waitForSelector('#ddlGiorno');
    await this.page.select('#ddlGiorno', _.padStart(_.random(1, 28).toString(), 2, '0'));
    await this.page.waitForSelector('#ddlMese');
    await this.page.select('#ddlMese', _.padStart(_.random(1, 12).toString(), 2, '0'));
    await this.page.waitForSelector('#ddlAnno');
    await this.page.select('#ddlAnno', _.random(1965, 2000).toString());
    await this.page.waitForSelector('#ddlNazNasc');
    await this.page.select('#ddlNazNasc', 'USA');
    await this.page.waitForSelector('#txtLuogo');
    await this.page.click('#txtLuogo');
    await this.page.keyboard.type(faker.address.state());
    await this.page.waitForSelector('#ddlNazRes');
    await this.page.select('#ddlNazRes', 'USA');
    await this.page.waitForSelector('#txtResidenza');
    await this.page.click('#txtResidenza');
    await this.page.keyboard.type(faker.address.state());
    await this.page.click('#txtCittadinanza');
    await this.page.keyboard.type('USA');
    await this.page.waitForSelector('#ddlDoc1');
    await this.page.select('#ddlDoc1', '1');
    await this.page.waitForSelector('#txtCifreDoc');
    await this.page.click('#txtCifreDoc');
    await this.page.keyboard.type(getRandomAlphaNumericStr(5));
    await this.page.waitForSelector('#chkTermini');
    await this.page.click('#chkTermini');
    await this.page.waitForSelector('#chkPrivacy');
    await this.page.click('#chkPrivacy');
  }

  async registerAccount() {
    try {
      if (this.browser) await this.browser.close();
      this.browser = await puppeteer.launch(chromeOptions);

      this.logger.info('creating new account');

      this.page = await this.browser.newPage();

      this.page.setViewport({ width: 1920, height: 2500, deviceScaleFactor: 2 });

      await this.page.goto(getLoginPage(this.office.cid));

      await Promise.all([
        this.page.click('#BtnRegistrati'),
        this.page.waitForNavigation({ waitUntil: 'networkidle2' }),
      ]);

      this.logger.info('at registration page');

      this.account.firstName = faker.name.firstName();
      this.account.lastName = faker.name.lastName();
      this.account.email = await this.tempMail
        .generateEmail(this.account.firstName, this.account.lastName);
      this.account.password = getPassword();

      this.logger.info(`password: ${this.account.password}`);

      await this.fillOutForm();

      let registrationCaptchaSolved = false;

      while (!registrationCaptchaSolved) {
        await this.page.waitForSelector('#txtPwd');
        await this.page.click('#txtPwd');
        await this.page.keyboard.type(this.account.password);
        await this.page.waitForSelector('#txtPwd2');
        await this.page.click('#txtPwd2');
        await this.page.keyboard.type(this.account.password);

        const captchaSolver = new CaptchaSolver(this.logger);
        captchaSolver.path = CAPTCHA_REGIS_PATH;
        captchaSolver.page = this.page;

        await this.page.waitForSelector('#captchaReg');

        let captchaText = '';
        while (!captchaText) {
          captchaText = await captchaSolver.solveCaptcha('#captchaReg');
        }

        await this.page.waitForSelector('#codice');

        // clear input
        await this.page.click('#codice', { clickCount: 3 });
        await this.page.keyboard.press('Backspace');
        await this.page.keyboard.type(captchaText);
        await this.page.waitForSelector('#btnConfermaR');
        await Promise.all([
          this.page.click('#btnConfermaR'),
          this.page.waitForNavigation({ waitUntil: 'networkidle2' }),
        ]);

        const success = await this.page.evaluate(() => window.find('registration was successful'));

        if (success) {
          this.logger.info('activation email sent');
          registrationCaptchaSolved = true;
        } else if (await this.page.evaluate(() => window.find('maximum number of registrations'))) {
          throw new Error('max registrations reached');
        } else {
          this.logger.info('captcha solution was wrong. trying again.');

          await this.page.waitForSelector('#BtnLoginKo');
          await Promise.all([
            this.page.click('#BtnLoginKo'),
            this.page.waitForNavigation({ waitUntil: 'networkidle2' }),
          ]);
        }
      }

      await this.page.waitFor(10000);

      await this.activateAccount(this.page);
      this.saveAccount();
    } catch (e) {
      this.logger.error('error registering account', e);
    } finally {
      if (this.browser) await this.browser.close();
    }
  }

  async activateAccount() {
    let message = '';

    while (!message) {
      try {
        message = await this.tempMail.fetchActivationEmail();
      } catch (e) {
        this.logger.error('error fetching activation email', e);
        await sleep(10000);
      }
    }

    this.logger.info('received activation message');
    const activationUrl = message.match(/https:\/\/.+Default.aspx/)[0];
    this.logger.info(`activation url: ${activationUrl}`);
    await this.page.goto(activationUrl);
    this.account.activated = true;
    this.logger.info('account activated');
  }

  saveAccount() {
    fs.writeFileSync(ACCOUNT_PATH, JSON.stringify(this.account));
  }

  deleteSavedAccount() {
    fs.unlink(ACCOUNT_PATH, () => {});
    this.account = {};
  }

  async initAccount() {
    try {
      fs.readFile(ACCOUNT_PATH, (err, data) => {
        if (!err && data) {
          this.account = JSON.parse(data);
          this.logger.info(`loaded account in tmp: ${this.account.email}`);
        }
      });
    } catch (err) {
      this.logger.error('saved account read failed', err);
    } finally {
      while (_.isEmpty(this.account) || !this.account.activated) {
        await this.registerAccount();
      }
    }

    return this.account;
  }
}

module.exports = AccountManager;
