/* eslint-disable no-console */
const forever = require('forever-monitor');

const { notifyMe } = require('./smtp');

const child = new (forever.Monitor)('./monitor.js', {
  silent: false,
  killTree: true,
  args: [],
});

child.on('exit', (code) => {
  console.error(`Forever detected script exited with code ${code}`);
  notifyMe('Forever detected script exited');
});

child.start();
