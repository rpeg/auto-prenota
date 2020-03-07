/* eslint-disable no-console */
const nodemailer = require('nodemailer');

require('dotenv').config();

const notifyMe = (text) => {
  const transport = nodemailer.createTransport({
    service: process.env.SMTP_SERVICE,
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PW,
    },
  });

  const message = {
    from: process.env.SMTP_USER,
    to: process.env.SMTP_TO,
    subject: text,
    text,
  };

  transport.sendMail(message, (err, info) => {
    if (err) {
      console.error(err);
    } else {
      console.log(info);
    }
  });
};

const notifyMeOnSlotFound = (officeName, dateStr) => {
  const text = `PRENOTA SLOT FOUND IN ${officeName} ON ${dateStr}`;
  notifyMe(text);
};

const notifyMeOnConfirmation = (officeName, dateStr) => {
  const text = `PRENOTA APPOINTMENT BOOKED IN ${officeName} ON ${dateStr}`;
  notifyMe(text);
};

module.exports = { notifyMe, notifyMeOnConfirmation, notifyMeOnSlotFound };
