const fs = require('fs');
const os = require('os');
const path = require('path');
const spawn = require('child_process').spawn;
const util = require('util');

const RED_COLOR = '\x1b[31m';
const GREEN_COLOR = '\x1b[32m';
const YELLOW_COLOR = '\x1b[33m';
const RESET_COLOR = '\x1b[0m';

class DataBranch {
  static async initialize(githubRepository, branch, checkoutPath) {
    await fs.promises.rmdir(checkoutPath, {recursive: true});
    let url = `https://github.com/${githubRepository}.git`;
    // Use github authentication if we have access to it.
    if (process.env.GITHUB_ACTOR && process.env.GITHUB_TOKEN)
      url = `https://${process.env.GITHUB_ACTOR}:${process.env.GITHUB_TOKEN}@github.com/${githubRepository}.git`;

    await fs.promises.mkdir(checkoutPath, {recursive: true}); 
    // Check existance of a remote branch for this bot.
    const {stdout} = await spawnAsync('git', 'ls-remote', '--heads', url, branch);
    // If there is no remote branch for this bot - create one.
    if (!stdout.includes(branch)) {
      await spawnAsyncOrDie('git', 'clone', '--no-checkout', '--depth=1', url, checkoutPath);

      await spawnAsyncOrDie('git', 'checkout', '--orphan', branch, {cwd: checkoutPath});
      await spawnAsyncOrDie('git', 'reset', '--hard', {cwd: checkoutPath});
    } else {
      await spawnAsyncOrDie('git', 'clone', '--single-branch', '--branch', `${branch}`, '--depth=1', url, checkoutPath);
    }
    await spawnAsyncOrDie('git', 'config', 'user.email', `"github-actions@github.com"`, {cwd: checkoutPath});
    await spawnAsyncOrDie('git', 'config', 'user.name', `"github-actions"`, {cwd: checkoutPath});
    return new DataBranch(checkoutPath, branch);
  }

  constructor(checkoutPath, branch) {
    this._checkoutPath = checkoutPath;
    this._branch = branch;
  }

  async upload(message) {
    await spawnAsyncOrDie('git', 'add', '.', {cwd: this._checkoutPath});
    await spawnAsyncOrDie('git', 'commit', '-m', `${message}`, '--author', '"github-actions <github-actions@github.com>"', {cwd: this._checkoutPath});
    const {code} = await spawnAsync('git', 'push', 'origin', this._branch, {cwd: this._checkoutPath});
    return code === 0;
  }
}

(async () => {
  const dataBranch = await DataBranch.initialize('aslushnikov/devops.aslushnikov.com', 'test-data-branch', './data');
  await fs.promises.writeFile(path.join(__dirname, 'data', 'test.txt'), '' + Date.now());
  console.log(await dataBranch.upload('update data!'));
})();

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
  return {code, stdout, stderr};
}

async function spawnAsyncOrDie(command, ...args) {
  const {code, stdout, stderr} = await spawnAsync(command, ...args);
  if (code !== 0)
    throw new Error(`Failed to executed: "${command} ${args.join(' ')}".\n\n=== STDOUT ===\n${stdout}\n\n\n=== STDERR ===\n${stderr}`);
  return {stdout, stderr};
}
