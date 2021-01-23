const {DataStore} = require('../datastore.js');
const {Playwright} = require('../playwright.js');
const misc = require('../misc.js');
const fs = require('fs');

(async () => {
  const cleanupHooks = misc.setupProcessHooks();

  const pw = await Playwright.pickup(__dirname);
  const webkit = pw.webkitCheckout();

  const datastore = await DataStore.pickup(__dirname);
  const rolls = await datastore.readJSON('./rolls.json').catch(e => ([]));
  const roll = rolls[rolls.length - 1];

  try {
    await fs.promises.writeFile(pw.filepath('browser_patches/chromium/BUILD_NUMBER'), '' + roll.chromiumRevision);
    await misc.spawnWithLogOrDie('browser_patches/chromium/build.sh', '--mirror', { cwd: pw.checkoutPath() });
    roll.steps.build = 'ok';
  } catch (e) {
    roll.steps.build = 'fail';
    console.error(e);
    process.exitCode = 1;
  }

  await datastore.writeJSON('./rolls.json', rolls);
  await datastore.upload('update roll data');
})();

