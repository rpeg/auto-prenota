const AwaitEventEmitter = require('await-event-emitter');
const WebSocket = require('ws');

const DROPMAIL_WSS = 'wss://dropmail.me/websocket';

class DropMailClient extends AwaitEventEmitter {
  constructor(logger) {
    super();
    this.address = null;
    this.logger = logger;
    this.ws = new WebSocket(DROPMAIL_WSS, {});
    this.readyEmitted = false;
    this.messages = [];

    this.setup();
  }

  setup() {
    this.logger.info('setting up dropmail socket');

    this.ws.on('open', () => this.logger.info('connected to dropmail'));
    this.ws.on('message', (msg) => {
      this.logger.info(msg);

      if (msg[0] === 'A') this.emit('address', msg.split(':')[0].substr(1));
      else if (msg[0] === 'I') this.emit('email', msg.substr(1));
    });
    this.ws.on('error', (e) => this.emit('error', e));
    this.ws.on('close', (e) => this.emit('close', e));
  }

  close() {
    this.ws.terminate();
  }
}

module.exports = DropMailClient;
