const child_process = require('child_process');
const os = require('os');
const path = require('path');
const fs = require('fs');
const https = require('https');

const RED_COLOR = '\x1b[31m';
const GREEN_COLOR = '\x1b[32m';
const YELLOW_COLOR = '\x1b[33m';
const RESET_COLOR = '\x1b[0m';

function extractSpawnOptions(args) {
  let options = {};
  if (args.length && args[args.length - 1].constructor.name !== 'String')
    options = args.pop();
  return options;
}

async function spawn(command, ...args) {
  const options = extractSpawnOptions(args);
  const cmd = child_process.spawn(command, args, options);
  let stdout = '';
  let stderr = '';
  if (cmd.stdout)
    cmd.stdout.on('data', data => stdout += data);
  if (cmd.stderr)
    cmd.stderr.on('data', data => stderr += data);
  const code = await new Promise(x => cmd.once('close', x));
  return {code, stdout, stderr};
}

async function makeTempDir(prefix, cleanupHooks = []) {
  const TMP_FOLDER = path.join(os.tmpdir(), prefix);
  const tmp = await fs.promises.mkdtemp(TMP_FOLDER);
  cleanupHooks.push(() => fs.rmdirSync(tmp, {recursive: true}));
  return tmp;
}

async function spawnOrDie(command, ...args) {
  const {code, stdout, stderr} = await spawn(command, ...args);
  if (code !== 0)
    throw new Error(`Failed to executed: "${command} ${args.join(' ')}".\n\n=== STDOUT ===\n${stdout}\n\n\n=== STDERR ===\n${stderr}`);
  return {stdout, stderr};
}

async function spawnWithLog(command, ...args) {
  const options = extractSpawnOptions(args);
  options.stdio = 'inherit';
  const {code} = await spawn(command, ...args, options);
  return {code};
}

async function spawnWithLogOrDie(command, ...args) {
  const options = extractSpawnOptions(args);
  options.stdio = 'inherit';
  await spawnOrDie(command, ...args, options);
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

class GitRepo {
  constructor(checkoutPath) {
    this._checkoutPath = checkoutPath;
  }

  filepath(gitpath) {
    return path.join(this._checkoutPath, gitpath);
  }

  async commitHistory(gitpath) {
    const {stdout} = await spawnOrDie('git', 'log', '--follow', '--format=%H %ct %s', gitpath, {cwd: this._checkoutPath});
    return stdout.trim().split('\n').map(parseCommitString);
  }

  async exists(gitpath) {
    return await fs.promises.stat(this.filepath(gitpath)).then(() => true).catch(e => false);
  }

  async checkoutRevision(sha) {
    await spawnOrDie('git', 'checkout', sha, {cwd: this._checkoutPath});
  }

  async rebase(sha) {
    await spawnOrDie('git', 'rebase', sha, {cwd: this._checkoutPath});
  }

  async getCommit(ref) {
    const {stdout} = await spawnOrDie('git', 'show', '-s', '--format=%H %ct %s', ref, {cwd: this._checkoutPath});
    return parseCommitString(stdout.trim());
  }

  async isDirty() {
    const {stdout} = await spawnOrDie('git', 'status', '-s', '--untracked-files=all', {cwd: this._checkoutPath});
    return !!stdout.trim();
  }
}

function parseCommitString(line) {
  line = line.trim();
  const tokens = line.split(' ');
  const sha = tokens.shift();
  const timestamp = tokens.shift();
  const message = tokens.join(' ');
  return {sha, timestamp, message};
}

module.exports = { GitRepo, setupProcessHooks, spawn, spawnOrDie, spawnWithLog, spawnWithLogOrDie, headRequest, makeTempDir};
