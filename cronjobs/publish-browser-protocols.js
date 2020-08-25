const {DataBranch} = require('./common/databranch.js');
const {Playwright} = require('./common/playwright.js');
const misc = require('./common/misc.js');

const BRANCH_NAME = 'browser-protocols-data';

(async () => {
  const cleanupHooks = misc.setupProcessHooks();
  const dataBranch = await DataBranch.initialize(BRANCH_NAME, cleanupHooks);
  const pw = await Playwright.clone(cleanupHooks);

  {
    // Write Firefox protocol.js file
    await dataBranch.writeFile('firefox_protocol.js', await pw.firefoxProtocol());
    await dataBranch.writeJSON('firefox_protocol_version', await pw.ffBuildNumber());
  }

  {
    // Write WebKit protocol.json file
    await pw.prepareBrowserCheckout('webkit');
    await dataBranch.writeFile('webkit_protocol.json', await pw.webkitProtocol());
    await dataBranch.writeJSON('webkit_protocol_version', await pw.wkBuildNumber());
  }

  console.log(await dataBranch.upload('update firefox & webkit protocols'));
})();

