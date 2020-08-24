const spawn = require('child_process').spawn;
const os = require('os');
const path = require('path');
const fs = require('fs');
const https = require('https');

const RED_COLOR = '\x1b[31m';
const GREEN_COLOR = '\x1b[32m';
const YELLOW_COLOR = '\x1b[33m';
const RESET_COLOR = '\x1b[0m';

async function spawnAsync(command, ...args) {
  let options = {};
  if (args.length && args[args.length - 1].constructor.name !== 'String')
    options = args.pop();
  const cmd = spawn(command, args, options);
  let stdout = '';
  let stderr = '';
  cmd.stdout.on('data', data => stdout += data);
  cmd.stderr.on('data', data => stderr += data);
  const code = await new Promise(x => cmd.once('close', x));
  /*
  console.log(command, ...args);
  console.log('------ stdout --------');
  console.log(stdout);
  console.log('------ stderr --------');
  console.log(stderr);
  */
  return {code, stdout, stderr};
}

async function spawnAsyncOrDie(command, ...args) {
  const {code, stdout, stderr} = await spawnAsync(command, ...args);
  if (code !== 0)
    throw new Error(`Failed to executed: "${command} ${args.join(' ')}".\n\n=== STDOUT ===\n${stdout}\n\n\n=== STDERR ===\n${stderr}`);
  return {stdout, stderr};
}

async function clonePlaywrightRepo(cleanupHooks = []) {
  const tmpFolder = path.join(os.tmpdir(), 'playwright-tmp-folder-');
  const checkoutPath = await fs.promises.mkdtemp(tmpFolder);
  await spawnAsyncOrDie('git', 'clone', '--single-branch', '--branch', `master`, '--depth=1', 'https://github.com/microsoft/playwright.git', checkoutPath);
  cleanupHooks.push(() => fs.rmdirSync(checkoutPath, {recursive: true}));
  return checkoutPath;
}

async function webkitBuildNumber(playwrightPath) {
  return parseInt((await fs.promises.readFile(path.join(playwrightPath, 'browser_patches', 'webkit', 'BUILD_NUMBER'), 'utf8')).split('\n')[0], 10);
}

async function firefoxBuildNumber(playwrightPath) {
  return parseInt((await fs.promises.readFile(path.join(playwrightPath, 'browser_patches', 'firefox', 'BUILD_NUMBER'), 'utf8')).split('\n')[0], 10);
}

async function headRequest(url) {
  return new Promise(resolve => {
    let options = new URL(url);
    options.method = 'HEAD';
    const request = https.request(options, res => resolve(res.statusCode === 200));
    request.on('error', error => resolve(false));
    request.end();
  });
}

// Process hooks are important so that github workflow actually crashes
// if there's an error in node.js process.
function setupProcessHooks() {
  const cleanupHooks = [];
  process.on('exit', () => {
    for (const cleanup of cleanupHooks) {
      try {
        cleanup();
      } catch (e) {
        console.error(e);
      }
    }
  });
  process.on('SIGINT', () => process.exit(2));
  process.on('SIGHUP', () => process.exit(3));
  process.on('SIGTERM', () => process.exit(4));
  process.on('uncaughtException', error => {
    console.error(error);
    process.exit(5);
  });
  process.on('unhandledRejection', error => {
    console.error(error);
    process.exit(6);
  });
  return cleanupHooks;
}

module.exports = { setupProcessHooks, spawnAsync, spawnAsyncOrDie, clonePlaywrightRepo, headRequest, webkitBuildNumber, firefoxBuildNumber };
