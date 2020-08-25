const fs = require('fs');
const path = require('path');

const misc = require('./misc.js');

const GITHUB_REPOSITORY = 'microsoft/playwright';

class Playwright {
  static async clone(cleanupHooks = []) {
    const checkoutPath = await misc.makeTempDir('devops-playwright-checkout-', cleanupHooks);
    await misc.spawnAsyncOrDie('git', 'clone', '--single-branch', '--branch', `master`, '--depth=1', 'https://github.com/microsoft/playwright.git', checkoutPath);
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
    const {stdout} = await misc.spawnAsyncOrDie('git', 'log', '--follow', '--format="%H %ct %s"', gitpath, {cwd: this._checkoutPath});
    return stdout.trim().split('\n').map(line => {
      line = line.trim();
      const tokens = line.split(' ');
      const sha = tokens.shift();
      const timestamp = tokens.shift();
      const message = tokens.join(' ');
      return {sha, timestamp, message};
    });
  }

  async exists(gitpath) {
    return await fs.promises.stat(this.filepath(gitpath)).then(() => true).catch(e => false);
  }

  async checkoutRevision(sha) {
    await misc.spawnAsyncOrDie('git', 'checkout', sha, {cwd: this._checkoutPath});
  }
}

module.exports = {Playwright};
