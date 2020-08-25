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

  async prepareBrowserCheckout(browserName) {
    await misc.spawnAsyncOrDie(this.filepath('browser_patches/prepare_checkout.sh'), browserName, {cwd: this._checkoutPath});
  }

  async webkitProtocol() {
    const {stdout} = await misc.spawnAsyncOrDie('node', this.filepath('browser_patches/webkit/concat_protocol.js'), {cwd: this._checkoutPath});
    return stdout;
  }

  async firefoxProtocol() {
    return await fs.promises.readFile(this.filepath('browser_patches/firefox/juggler/protocol/Protocol.js'), 'utf8');
  }

  async wkBuildNumber() {
    return parseInt((await fs.promises.readFile(this.filepath('browser_patches/webkit/BUILD_NUMBER'), 'utf8')).split('\n')[0], 10);
  }

  async ffBuildNumber() {
    return parseInt((await fs.promises.readFile(this.filepath('browser_patches/firefox/BUILD_NUMBER'), 'utf8')).split('\n')[0], 10);
  }

  async commitHistory(gitpath) {
    const {stdout} = await misc.spawnAsyncOrDie('git', 'log', '--follow', '--format=oneline', gitpath);
    return stdout.trim().split('\n').map(line => {
      line = line.trim();
      const spaceIndex = line.indexOf(' ');
      const sha = line.substring(0, spaceIndex);
      const message = line.substring(spaceIndex + 1);
      return {sha, message};
    });
  }
}

module.exports = {Playwright};
