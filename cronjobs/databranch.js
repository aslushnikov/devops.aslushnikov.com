const fs = require('fs');
const path = require('path');

const misc = require('./misc.js');

const GITHUB_REPOSITORY = 'aslushnikov/devops.aslushnikov.com';

class DataBranch {
  static async initialize(branch, cleanupHooks = []) {
    const checkoutPath = await misc.makeTempDir('devops-data-dir-tmp-folder-', cleanupHooks);
    console.log(`[databranch] initializing at ${checkoutPath}`);
    let url = `https://github.com/${GITHUB_REPOSITORY}.git`;
    // Use github authentication if we have access to it.
    if (process.env.GITHUB_ACTOR && process.env.GITHUB_TOKEN)
      url = `https://${process.env.GITHUB_ACTOR}:${process.env.GITHUB_TOKEN}@github.com/${GITHUB_REPOSITORY}.git`;

    await fs.promises.mkdir(checkoutPath, {recursive: true});
    // Check existance of a remote branch for this bot.
    const {stdout} = await misc.spawn('git', 'ls-remote', '--heads', url, branch);
    // If there is no remote branch for this bot - create one.
    if (!stdout.includes(branch)) {
      await misc.spawnOrDie('git', 'clone', '--no-checkout', '--depth=1', url, checkoutPath);

      await misc.spawnOrDie('git', 'checkout', '--orphan', branch, {cwd: checkoutPath});
      await misc.spawnOrDie('git', 'reset', '--hard', {cwd: checkoutPath});
    } else {
      await misc.spawnOrDie('git', 'clone', '--single-branch', '--branch', `${branch}`, '--depth=1', url, checkoutPath);
    }
    await misc.spawnOrDie('git', 'config', 'user.email', `"github-actions@github.com"`, {cwd: checkoutPath});
    await misc.spawnOrDie('git', 'config', 'user.name', `"github-actions"`, {cwd: checkoutPath});
    return new DataBranch(checkoutPath, branch);
  }

  constructor(checkoutPath, branch) {
    this._checkoutPath = checkoutPath;
    // We don't want to expose that our data store is backed with git,
    // so aggregate here instead of inheriting.
    this._git = new misc.GitRepo(checkoutPath);
    this._branch = branch;
  }

  async readJSON(filepath) {
    return JSON.parse(await this.readFile(filepath));
  }

  async readFile(filepath) {
    return await fs.promises.readFile(path.join(this._checkoutPath, filepath), 'utf8');
  }

  async writeFile(filepath, content) {
    return await fs.promises.writeFile(path.join(this._checkoutPath, filepath), content, 'utf8');
  }

  async writeJSON(filepath, content) {
    return await this.writeFile(filepath, JSON.stringify(content));
  }

  async upload(message = 'update data') {
    // Check if there's anything to update.
    if (!(await this.isDirty())) {
      console.log('[databranch] FYI: no changes, nothing to upload');
      return;
    }
    console.log(`[databranch] Uploading data with message "${message}"`);
    await misc.spawnOrDie('git', 'add', '.', {cwd: this._checkoutPath});
    await misc.spawnOrDie('git', 'commit', '-m', message, '--author', '"github-actions <github-actions@github.com>"', {cwd: this._checkoutPath});
    await misc.spawnOrDie('git', 'push', 'origin', this._branch, {cwd: this._checkoutPath});
  }
}

module.exports = {DataBranch};
