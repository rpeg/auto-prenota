/* eslint-disable no-console */
const forever = require('forever-monitor');

const SmtpClient = require('./lib/SmtpClient');

const child = new (forever.Monitor)('monitor.js', {
  silent: false,
  killTree: true,
  args: [],
});

child.on('exit:code', (code) => {
  console.error(`Forever detected script exited with code ${code}`);
  const client = new SmtpClient('');
  client.notifyMe('Forever detected script exited');
  child.restart();
});

child.on('restart', () => {
  console.info('Target script restarted');
});

child.on('error', () => {
  console.info('Target script returned error');
  child.restart();
});

child.start();
