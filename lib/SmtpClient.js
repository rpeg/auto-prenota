/* eslint-disable no-console */
const nodemailer = require('nodemailer');

require('dotenv').config();

class SmtpClient {
  constructor(officeName) {
    this.officeName = officeName;
    this.transport = nodemailer.createTransport({
      service: process.env.SMTP_SERVICE,
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PW,
      },
    });
  }

  notifyMe(text) {
    const message = {
      from: process.env.SMTP_USER,
      to: process.env.SMTP_TO,
      subject: text,
      text,
    };

    this.transport.sendMail(message, (err, info) => {
      if (err) {
        console.error(err);
      } else {
        console.log(info);
      }
    });
  }

  notifyMeOnSlotFound(dateStr) {
    this.notifyMe(`SLOT FOUND IN ${this.officeName} ON ${dateStr}`);
  }

  notifyMeOnConfirmation(dateStr) {
    this.notifyMe(`APPOINTMENT BOOKED IN ${this.officeName} ON ${dateStr}`);
  }
}

module.exports = SmtpClient;
