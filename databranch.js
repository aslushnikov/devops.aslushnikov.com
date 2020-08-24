const fs = require('fs');

const {spawnAsync, spawnAsyncOrDie} = require('./misc.js');

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

module.exports = {DataBranch};
