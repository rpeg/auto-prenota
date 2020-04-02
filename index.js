/* eslint-disable no-console */
const forever = require('forever-monitor');

const child = new (forever.Monitor)('monitor.js', {
  silent: false,
  killTree: true,
  args: [],
});

child.on('exit:code', (code) => {
  console.error(`Forever detected script exited with code ${code}`);
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
