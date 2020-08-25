const fs = require('fs');
const path = require('path');

const misc = require('./misc.js');

const GITHUB_REPOSITORY = 'microsoft/playwright';

class Playwright {
  static async clone(cleanupHooks, options = {}) {
    const {
      fullHistory = false,
    } = options;
    const checkoutPath = await misc.makeTempDir('devops-playwright-checkout-', cleanupHooks);
    console.log(`[playwright] cloning Playwright at ${checkoutPath}`);
    const cloneOptions = [
      '--single-branch',
      '--branch', 'master',
    ];
    if (!fullHistory)
      cloneOptions.push('--depth=1');
    await misc.spawnAsyncOrDie('git', 'clone', ...cloneOptions, 'https://github.com/microsoft/playwright.git', checkoutPath);
    return new Playwright(checkoutPath);
  }

  constructor(checkoutPath) {
    this._checkoutPath = checkoutPath;
  }

  filepath(gitpath) {
    return path.join(this._checkoutPath, gitpath);
  }

  async prepareBrowserCheckout(browserName) {
    console.log(`[playwright] preparing ${browserName} checkout`);
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

  async installDependencies() {
    console.log(`[playwright] installing dependencies`);
    await misc.spawnAsyncOrDie('npm', 'install', {
      cwd: this._checkoutPath,
    });
  }

  async buildProject() {
    console.log(`[playwright] building project`);
    await misc.spawnAsyncOrDie('npm', 'run', 'build', {
      cwd: this._checkoutPath,
    });
  }

  async commitHistory(gitpath) {
    const {stdout} = await misc.spawnAsyncOrDie('git', 'log', '--follow', '--format=%H %ct %s', gitpath, {cwd: this._checkoutPath});
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
    console.log(`[playwright] checking out revision ${sha}`);
    await misc.spawnAsyncOrDie('git', 'checkout', sha, {cwd: this._checkoutPath});
  }
}

module.exports = {Playwright};
