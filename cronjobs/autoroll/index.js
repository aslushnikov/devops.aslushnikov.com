const {DataBranch} = require('../databranch.js');
const {Playwright} = require('../playwright.js');
const misc = require('../misc.js');

if (process.argv.length !== 3) {
  console.error('ERROR: pass "firefox" or "webkit" as a parameter');
  process.exit(1);
}

const BROWSER_NAME = process.argv[2];
if (BROWSER_NAME !== 'firefox' && BROWSER_NAME !== 'webkit') {
  console.error(`ERROR: unknown browser "${BROWSER_NAME}". Only 'firefox' or 'webkit' are supported`);
  process.exit(1);
}

const BRANCH_NAME = `autoroll-${BROWSER_NAME}-data`;

(async () => {
  const cleanupHooks = misc.setupProcessHooks();

  const pw = await Playwright.clone(cleanupHooks);
  const browserCheckout = await pw.prepareBrowserCheckout(BROWSER_NAME);

  const playwrightCommit = await pw.getCommit('HEAD');
  const upstreamCommit = await browserCheckout.getCommit(browserCheckout.browserUpstreamRef());
  const timestamp = Date.now();
  const runURL = `https://github.com/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}`;

  console.log('timestamp: ' + timestamp);
  console.log(`Run URL: ` + runURL);
  console.log(JSON.stringify(playwrightCommit, null, 2));
  console.log(JSON.stringify(upstreamCommit, null, 2));

  const steps = {
    rebase: 'N/A',
    build: 'N/A',
    test: 'N/A',
  };

  await rebaselineBrowser(pw, browserCheckout, upstreamCommit, steps).catch(e => {
    console.error(e);
  });

  const dataBranch = await DataBranch.initialize(BRANCH_NAME, cleanupHooks);
  const rolls = await dataBranch.readJSON('./rolls.json').catch(e => ([]));
  rolls.push({
    timestamp: Date.now(),
    playwrightCommit,
    upstreamCommit,
    steps,
    runURL,
  });
  // Sliding window with data for the last 60 rolls.
  rolls = rolls.slice(rolls.length - 60);
  await dataBranch.writeJSON('./rolls.json', rolls);
  await dataBranch.upload('update roll data');
})();

async function rebaselineBrowser(playwrightCheckout, browserCheckout, upstreamCommit, steps) {
  steps.rebase = 'fail';
  await browserCheckout.rebase(upstreamCommit.sha);
  steps.rebase = 'ok';

  steps.build = 'fail';
  await browserCheckout.buildBrowser();
  steps.build = 'ok';

  steps.test = 'fail';
  await playwrightCheckout.runTests(browserCheckout.name(), browserCheckout.executablePath());
  steps.test = 'ok';
}

