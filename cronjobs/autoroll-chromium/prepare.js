const {DataStore} = require('../datastore.js');
const {Playwright} = require('../playwright.js');
const misc = require('../misc.js');

(async () => {
  const cleanupHooks = misc.setupProcessHooks();

  const pw = await Playwright.cloneWithoutHistory(__dirname);
  await pw.installDependencies();
  await pw.build();

  const roll = {
    timestamp: Date.now(),
    playwrightCommit: await pw.getCommit('HEAD'),
    chromiumRevision: '<N/A>',
    steps: {
      find_revision: 'N/A',
      build: 'N/A',
      test: 'N/A',
    },
    runURL: `https://github.com/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}`,
  };

  const datastore = await DataStore.cloneWithoutHistory(__dirname);
  let rolls = await datastore.readJSON('./rolls.json').catch(e => ([]));
  rolls.push(roll);
  await datastore.writeJSON('./rolls.json', rolls);
  await datastore.upload('update roll data');
})();

