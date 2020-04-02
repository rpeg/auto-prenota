/* eslint-disable no-await-in-loop */
const OfficeMonitor = require('./lib/OfficeMonitor');

const offices = {
  SF: {
    cid: 100012,
    name: 'SF',
    citizenship: true,
  },
};

const officeMonitor = new OfficeMonitor(offices.SF);

(async () => { await officeMonitor.launch(); })();
