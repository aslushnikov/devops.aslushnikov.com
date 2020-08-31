const {DataStore} = require('../datastore.js');
const {Playwright} = require('../playwright.js');
const misc = require('../misc.js');

(async () => {
  const cleanupHooks = misc.setupProcessHooks();

  const pw = await Playwright.pickup(__dirname);
  const webkit = pw.webkitCheckout();

  const datastore = await DataStore.pickup(__dirname);
  const rolls = await datastore.readJSON('./rolls.json').catch(e => ([]));
  const roll = rolls[rolls.length - 1];

  try {
    await webkit.rebase(roll.upstreamCommit.sha);
    roll.steps.rebase = 'ok';
  } catch (e) {
    roll.steps.rebase = 'fail';
    console.error(e);
    process.exitCode = 1;
  }

  await datastore.writeJSON('./rolls.json', rolls);
  await datastore.upload('update roll data');
})();

