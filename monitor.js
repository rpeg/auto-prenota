/* eslint-disable no-unused-expressions */
const OfficeMonitor = require('./lib/OfficeMonitor');

const offices = {
  SF: {
    cid: 100012,
    name: 'SF',
    citizenship: true,
  },
};

const officeMonitor = new OfficeMonitor(offices.SF);

officeMonitor.launch()
  .then(() => { if (!officeMonitor.success) officeMonitor.launch(); })
  .catch(() => { officeMonitor.launch(); });
