const OfficeMonitor = require('./lib/OfficeMonitor');

const offices = {
  SF: {
    cid: 100012,
    name: 'SF',
    citizenship: true,
  },
};

new OfficeMonitor(offices.SF).launch();
