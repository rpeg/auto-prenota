/* eslint-disable no-console */
const forever = require('forever-monitor');

const SmtpClient = require('./lib/SmtpClient');

const child = new (forever.Monitor)('./monitor.js', {
  silent: false,
  killTree: true,
  args: [],
});

child.on('exit', (code) => {
  console.error(`Forever detected script exited with code ${code}`);
  const client = new SmtpClient('');
  client.notifyMe('Forever detected script exited');
});

child.start();
