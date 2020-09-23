const OfficeMonitor = require('./lib/OfficeMonitor');

const OFFICES = {
  SF: {
    cid: 100012,
    name: 'SF',
    citizenship: true,
  },
  LA: {
    cid: 100034,
    name: 'LA',
    citizenship: false,
  },
};

const office = process.env.OFFICE || 'SF';

new OfficeMonitor(OFFICES[office]).launch();