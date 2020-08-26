const {DataBranch} = require('../databranch.js');
const {Playwright} = require('../playwright.js');
const misc = require('../misc.js');

const BRANCH_NAME = 'autoroll-firefox-data';

(async () => {
  const cleanupHooks = misc.setupProcessHooks();

  const pw = await Playwright.clone(cleanupHooks);
  const ff = await pw.prepareBrowserCheckout('firefox');

  const upstreamCommit = await ff.getCommit(ff.browserUpstreamRef());
  console.log(JSON.stringify(upstreamCommit, null, 2));

  await ff.rebase(upstreamCommit.sha);
  await ff.buildBrowser();


  // const dataBranch = await DataBranch.initialize(BRANCH_NAME, cleanupHooks);
  // await dataBranch.writeJSON('./status.json', status);
  // await dataBranch.upload('update cdn-status');
})();

