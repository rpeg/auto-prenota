/* eslint-disable no-shadow */
/* eslint-disable no-undef */
const CaptchaNode = require('2captcha-node');
const base64Img = require('base64-img');

class CaptchaSolver {
  constructor(logger) {
    this.page = null;
    this.logger = logger;
    this.path = null;
    this.solver = CaptchaNode.default(process.env.CAPTCHA_KEY);
  }

  async screenshotDOMElm(selector) {
    await this.page.waitForSelector(selector);
    const rect = await this.page.evaluate((selector) => {
      const element = document.querySelector(selector);
      const {
        x, y, width, height,
      } = element.getBoundingClientRect();
      return {
        left: x, top: y, width, height, id: element.id,
      };
    }, selector);

    return this.page.screenshot({
      path: this.path,
      clip: {
        x: rect.left,
        y: rect.top,
        width: rect.width,
        height: rect.height,
      },
    });
  }

  convertCaptchaToBase64() {
    return new Promise((resolve, reject) => {
      base64Img.base64(this.path, (err, data) => {
        if (err) reject(err);
        resolve(data);
      });
    });
  }

  async solveCaptcha(elmId) {
    try {
      await this.screenshotDOMElm(elmId)
    } catch (e) {
      this.logger.error(e);
      return '';
    }

    this.logger.info('captcha screencapped');

    const base64 = await this.convertCaptchaToBase64();

    this.logger.info('captcha converted to base64');

    try {
      const captcha = await this.solver.solve({
        image: base64.toString(),
        maxAttempts: parseInt(process.env.MAX_CAPTCHA_ATTEMPTS, 10) || 20,
      });
      
      return captcha.text;
    } catch (e) {
      this.logger.error(e);

      if (e.message.toLowerCase().includes('balance')) {
        this.logger.warn('CHECK CAPTCHA BALANCE');
      }

      return '';
    }
  }
}

module.exports = CaptchaSolver;
