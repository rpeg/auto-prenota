/* eslint-disable no-console */
const forever = require('forever-monitor');
const shell = require('shelljs');

const child = new (forever.Monitor)('monitor.js', {
  silent: false,
  killTree: true,
});

child.on('exit:code', (code) => {
  console.error(`Forever detected script exited with code ${code}`);
  child.restart();
});

child.on('start', () => {
  console.info('Target script start');
});

child.on('restart', () => {
  console.info('Target script restarted');
  shell.exec('pkill chrome'); // prune zombie browser processes
});

child.on('error', () => {
  console.info('Target script returned error');
  child.restart();
});

child.start();
