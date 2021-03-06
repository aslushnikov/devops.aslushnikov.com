const fs = require('fs');
const path = require('path');

const misc = require('./misc.js');

const GITHUB_REPOSITORY = 'microsoft/playwright';

async function clone(workdirPath, options = {}) {
  const playwright = new Playwright(workdirPath);
  if (await misc.existsAsync(playwright.checkoutPath()))
    await fs.promises.rmdir(playwright.checkoutPath(), {recursive: true});
  const {
    fullHistory = false,
  } = options;
  console.log(`[playwright] cloning Playwright at ${playwright.checkoutPath()}`);
  const cloneOptions = [
    '--single-branch',
    '--branch', 'master',
  ];
  if (!fullHistory)
    cloneOptions.push('--depth=1');
  await misc.spawnWithLogOrDie('git', 'clone', ...cloneOptions, 'https://github.com/microsoft/playwright.git', playwright.checkoutPath());
  return playwright;
}

class Playwright extends misc.GitRepo {
  static async cloneWithoutHistory(workdirPath) {
    return await clone(workdirPath, {fullHistory: false});
  }

  static async cloneWithHistory(workdirPath) {
    return await clone(workdirPath, {fullHistory: true});
  }

  static async pickup(workdirPath) {
    const playwright = new Playwright(workdirPath);
    if (!(await misc.existsAsync(playwright.checkoutPath())))
      throw new Error(`ERROR: cannot initialize Playwright because ${playwright.checkoutPath()} does not exist!`);
    return playwright;
  }

  constructor(workdirPath) {
    super(path.join(workdirPath, 'workdir', 'playwright'));
  }

  async runTests(browserName, executablePath = '') {
    const testCommand = ({
      firefox: 'ftest',
      webkit: 'wtest',
      chromium: 'ctest',
    })[browserName];
    if (!testCommand)
      throw new Error('ERROR: cannot run tests for browser ' + browserName);
    const env = Object.assign({}, process.env);
    if (executablePath) {
      const envName = ({
        firefox: 'FFPATH',
        webkit: 'WKPATH',
        chromium: 'CRPATH',
      })[browserName];
      env[envName] = executablePath;
    }
    //TODO: return test-report.json
    if (process.platform == 'linux') {
      await misc.spawnWithLogOrDie('xvfb-run', '--auto-servernum', 'npm', 'run', testCommand, {
        cwd: this._checkoutPath,
        env,
      });
    } else {
      await misc.spawnWithLogOrDie('npm', 'run', testCommand, {
        cwd: this._checkoutPath,
        env,
      });
    }
  }

  firefoxCheckout() {
    return new FirefoxCheckout(this);
  }

  webkitCheckout() {
    return new WebKitCheckout(this);
  }

  async webkitProtocol() {
    const {stdout} = await misc.spawnOrDie('node', this.filepath('browser_patches/webkit/concat_protocol.js'), {cwd: this._checkoutPath});
    return stdout;
  }

  async firefoxProtocol() {
    return await fs.promises.readFile(this.filepath('browser_patches/firefox/juggler/protocol/Protocol.js'), 'utf8');
  }

  async buildNumber(appName) {
    return parseInt((await fs.promises.readFile(this.filepath(`browser_patches/${appName}/BUILD_NUMBER`), 'utf8')).split('\n')[0], 10);
  }

  async installDependencies() {
    console.log(`[playwright] installing dependencies`);
    await misc.spawnWithLogOrDie('npm', 'ci', {
      cwd: this._checkoutPath,
    });
  }

  async build() {
    console.log(`[playwright] building project`);
    await misc.spawnWithLogOrDie('npm', 'run', 'build', {
      cwd: this._checkoutPath,
    });
  }
}

class FirefoxCheckout extends misc.GitRepo {
  constructor(playwright) {
    super(playwright.filepath('browser_patches/firefox/checkout'));
    this._playwright = playwright;
    this._browserUpstreamRef = 'browser_upstream/beta';
  }

  browserUpstreamRef() { return 'browser_upstream/beta'; }

  executablePath() {
    return this.filepath(`obj-build-playwright/dist/bin/firefox`);
  }

  async prepareCheckout() {
    await misc.spawnWithLogOrDie(this._playwright.filepath('browser_patches/prepare_checkout.sh'), 'firefox', {cwd: this._playwright.checkoutPath()});
  }

  async build() {
    await misc.spawnWithLogOrDie('./mach', 'bootstrap', '--no-interactive', '--application-choice=Firefox for Desktop', {
      cwd: this.checkoutPath(),
      env: Object.assign({}, process.env, {SHELL: '/bin/bash'}),
    });
    await misc.spawnWithLogOrDie(`browser_patches/firefox/build.sh`, {
      cwd: this._playwright.checkoutPath(),
      env: Object.assign({}, process.env, {SHELL: '/bin/bash'}),
    });
  }

}

class WebKitCheckout extends misc.GitRepo {
  constructor(playwright) {
    super(playwright.filepath('browser_patches/webkit/checkout'));
    this._playwright = playwright;
  }

  browserUpstreamRef() {
    return 'browser_upstream/master';
  }

  async prepareCheckout() {
    await misc.spawnWithLogOrDie(this._playwright.filepath('browser_patches/prepare_checkout.sh'), 'webkit', {cwd: this._playwright.checkoutPath()});
  }

  async build() {
    await misc.spawnWithLogOrDie(`browser_patches/webkit/build.sh`, '--full', {
      cwd: this._playwright.checkoutPath(),
      env: Object.assign({}, process.env, {SHELL: '/bin/bash'}),
    });
  }

  executablePath() {
    return this._playwright.filepath(`browser_patches/webkit/pw_run.sh`);
  }
}

module.exports = {Playwright};
