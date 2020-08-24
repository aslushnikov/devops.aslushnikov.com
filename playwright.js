const fs = require('fs');
const path = require('path');
const os = require('os');

const misc = require('./misc.js');

const GITHUB_REPOSITORY = 'microsoft/playwright';
const TMP_FOLDER = path.join(os.tmpdir(), 'devops-playwright-checkout-');

class Playwright {
  static async clone(cleanupHooks = []) {
    const checkoutPath = await fs.promises.mkdtemp(TMP_FOLDER);
    await misc.spawnAsyncOrDie('git', 'clone', '--single-branch', '--branch', `master`, '--depth=1', 'https://github.com/microsoft/playwright.git', checkoutPath);
    cleanupHooks.push(() => fs.rmdirSync(checkoutPath, {recursive: true}));
    return new Playwright(checkoutPath);
  }

  constructor(checkoutPath) {
    this._checkoutPath = checkoutPath;
  }

  filepath(gitpath) {
    return path.join(this._checkoutPath, gitpath);
  }

  async wkBuildNumber() {
    return parseInt((await fs.promises.readFile(this.filepath('browser_patches/webkit/BUILD_NUMBER'), 'utf8')).split('\n')[0], 10);
  }

  async ffBuildNumber() {
    return parseInt((await fs.promises.readFile(this.filepath('browser_patches/firefox/BUILD_NUMBER'), 'utf8')).split('\n')[0], 10);
  }
}

module.exports = {Playwright};
