const OfficeMonitor = require('./lib/OfficeMonitor');

const offices = {
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

new OfficeMonitor(offices.SF).launch();
// new OfficeMonitor(offices.LA).launch();
