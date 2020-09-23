require('dotenv').config();

const _ = require('lodash');

const getLoginPage = (cid) => `${process.env.LOGIN_PAGE}?cidsede=${cid}&returnUrl=//`;

const chromeOptions = {
  headless: false,
  defaultViewport: null,
  slowMo: 10,
  args: ['--no-sandbox', '--disable-setuid-sandbox'],
};

const sleep = (ms) => new Promise((resolve) => {
  setTimeout(resolve, ms);
});

const getRandomDelay = (base) => _.random(base / 2, base * 2);

const getRandomProfession = () => _.shuffle([
  'accountant',
  'actor',
  'actress',
  'air traffic controller',
  'architect',
  'artist',
  'attorney',
  'banker',
  'bartender',
  'barber',
  'bookkeeper',
  'builder',
  'businessman',
  'businesswoman',
  'businessperson',
  'butcher',
  'carpenter',
  'cashier',
  'chef',
  'coach',
  'dental hygienist',
  'dentist',
  'designer',
  'developer',
  'dietician',
  'doctor',
  'economist',
  'editor',
  'electrician',
  'engineer'])[0];

const getRandomAlphaNumericStr = (length) => _.sampleSize('ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789', length).join('');

/**
 * >8 chars, upper + lower + numbers
 */
const getPassword = () => _.shuffle(_.sampleSize('ABCDEFGHIJKLMNOPQRSTUVWXYZ', 3)
  .concat(_.sampleSize('abcdefghijklmnopqrstuvwxyz', 3)
    .concat(_.sampleSize('0123456789', 3)))).join('');

module.exports = {
  sleep,
  getLoginPage,
  chromeOptions,
  getRandomDelay,
  getRandomProfession,
  getRandomAlphaNumericStr,
  getPassword,
};
