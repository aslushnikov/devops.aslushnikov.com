const {DataStore} = require('../datastore.js');
const {Playwright} = require('../playwright.js');
const misc = require('../misc.js');

(async () => {
  misc.setupProcessHooks();
  const datastore = await DataStore.cloneWithoutHistory(__dirname);
  const pw = await Playwright.cloneWithoutHistory(__dirname);

  {
    // Write Firefox protocol.js file
    await datastore.writeFile('firefox_protocol.js', await pw.firefoxProtocol());
    await datastore.writeJSON('firefox_protocol_version', await pw.buildNumber('firefox'));
  }

  {
    // WebKit protocol requires webkit checkout.
    const webkit = pw.webkitCheckout();
    await webkit.prepareCheckout();

    await datastore.writeFile('webkit_protocol.json', await pw.webkitProtocol());
    await datastore.writeJSON('webkit_protocol_version', await pw.buildNumber('webkit'));
  }

  console.log(await datastore.upload('update firefox & webkit protocols'));
})();

