const {DataStore} = require('../datastore.js');
const {Playwright} = require('../playwright.js');
const misc = require('../misc.js');
const fs = require('fs');
const path = require('path');

const FORMAT_VERSION = 1;

(async () => {
  const cleanupHooks = misc.setupProcessHooks();
  const datastore = await DataStore.cloneWithoutHistory(__dirname);

  const defaultData = {
    version: FORMAT_VERSION,
    infos: [],
  };

  let data = await datastore.readJSON('./data.json').catch(e => defaultData);
  if (data.version !== FORMAT_VERSION)
    data = defaultData;

  const shaToInfo = new Map();
  for (const info of data.infos)
    shaToInfo.set(info.sha, info);

  // Clone Playwright with history so that we can use commitHistory command.
  const pw = await Playwright.cloneWithHistory(__dirname);
  await pw.installDependencies();
  await pw.build();
  const commits = await pw.commitHistory('docs/docker/Dockerfile.bionic');
  const missingCommits = commits.filter(commit => !shaToInfo.has(commit.sha));

  const workdir = await misc.makeTempDir('workdir-for-docker-size-', cleanupHooks);
  for (const commit of missingCommits) {
    await pw.checkoutRevision(commit.sha);
    // build.sh may and may not exist.
    console.log(`* building docker file`);
    if (await pw.exists('./docs/docker/build.sh')) {
      const buildFilePath = pw.filepath('./docs/docker/build.sh');
      await misc.spawnWithLogOrDie('bash', buildFilePath, {
        cwd: pw.filepath('./docs/docker'),
      });
    } else {
      await misc.spawnWithLogOrDie('docker', 'build', '-t', 'playwright:localbuild', '-f', 'Dockerfile.bionic', '.', {
        cwd: pw.filepath('./docs/docker'),
      });
    }

    console.log(`* extracting image`);
    // This command is expected to produce `dockerimage.tar` and `dockerimage.tar.gz`
    await misc.spawnOrDie('bash', path.join(__dirname, 'export-docker-image.sh'), {cwd: workdir});
    // The only output in stdout is the compressed image.
    const rawStat = await fs.promises.stat(path.join(workdir, 'dockerimage.tar'));
    await misc.spawnOrDie('gzip', 'dockerimage.tar', {cwd: workdir});
    const zipStat = await fs.promises.stat(path.join(workdir, 'dockerimage.tar.gz'));
    await fs.promises.unlink(path.join(workdir, 'dockerimage.tar.gz'));
    shaToInfo.set(commit.sha, {
      ...commit,
      rawSize: rawStat.size,
      zipSize: zipStat.size,
    });

    data.infos = [...shaToInfo.values()];
    await datastore.writeJSON('./data.json', data);
    await datastore.upload();
  }
})();

