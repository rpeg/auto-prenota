const axios = require('axios');
const crypto = require('crypto');
const faker = require('faker');
const _ = require('lodash');

require('dotenv').config();

const RAPID_API_URL = 'https://privatix-temp-mail-v1.p.rapidapi.com';

class TempMailClient {
  constructor(logger) {
    this.logger = logger;
    this.md5 = null;
  }

  async generateEmail(firstName, lastName) {
    this.logger.info('setting up temp mail');

    const validDomain = await new Promise((resolve, reject) => axios({
      method: 'GET',
      url: `${RAPID_API_URL}/request/domains/`,
      headers: {
        'content-type': 'application/octet-stream',
        'x-rapidapi-host': process.env.MAIL_HOST,
        'x-rapidapi-key': process.env.MAIL_KEY,
      },
    })
      .then((res) => {
        resolve(_.shuffle(res.data)[0]);
      })
      .catch((err) => {
        this.logger.error(err);
        reject(err);
      }));

    const username = faker.internet.email(firstName, lastName).split('@')[0].toLowerCase();
    const address = username + validDomain;
    this.md5 = crypto.createHash('md5').update(address).digest('hex');
    this.logger.info(`email: ${address}, md5: ${this.md5}`);

    return address;
  }

  async fetchActivationEmail() {
    return new Promise((resolve, reject) => axios({
      method: 'GET',
      url: `${RAPID_API_URL}/request/mail/id/${this.md5}/`,
      headers: {
        'content-type': 'application/octet-stream',
        'x-rapidapi-host': process.env.MAIL_HOST,
        'x-rapidapi-key': process.env.MAIL_KEY,
      },
    }).then((res) => {
      if (res && res.data && res.data.length && res.data[0].mail_text) {
        const subject = res.data[0].mail_subject;
        if (/Consolato/.test(subject)) {
          const text = res.data[0].mail_text;
          resolve(text);
        } else {
          reject(new Error('no activation email'));
        }
      } else {
        reject(new Error('no activation email'));
      }
    }).catch((e) => reject(e)));
  }
}

module.exports = TempMailClient;
