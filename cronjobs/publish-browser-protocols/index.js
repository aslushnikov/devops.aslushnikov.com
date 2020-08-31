const {DataStore} = require('../datastore.js');
const {Playwright} = require('../playwright.js');
const misc = require('../misc.js');

(async () => {
  misc.setupProcessHooks();
  const datastore = await DataStore.clone(__dirname);
  const pw = await Playwright.clone(__dirname);

  {
    // Write Firefox protocol.js file
    await datastore.writeFile('firefox_protocol.js', await pw.firefoxProtocol());
    await datastore.writeJSON('firefox_protocol_version', await pw.ffBuildNumber());
  }

  {
    // WebKit protocol requires webkit checkout.
    const webkit = pw.webkitCheckout();
    await webkit.prepareCheckout();

    await datastore.writeFile('webkit_protocol.json', await pw.webkitProtocol());
    await datastore.writeJSON('webkit_protocol_version', await pw.wkBuildNumber());
  }

  console.log(await datastore.upload('update firefox & webkit protocols'));
})();

