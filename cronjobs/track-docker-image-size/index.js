const {DataBranch} = require('../databranch.js');
const {Playwright} = require('../playwright.js');
const misc = require('../misc.js');

const BRANCH_NAME = 'docker-image-size-data';

const FORMAT_VERSION = 1;

(async () => {
  const cleanupHooks = misc.setupProcessHooks();
  const dataBranch = await DataBranch.initialize(BRANCH_NAME, cleanupHooks);

  const defaultData = {
    version: FORMAT_VERSION,
    infos: [],
  };

  let data = await dataBranch.readJSON('./data.json').catch(e => defaultData);
  if (data.version !== FORMAT_VERSION)
    data = defaultData;

  const shaToInfo = new Map();
  for (const info of data.infos)
    shaToInfo.set(info.sha, info);

  const pw = await Playwright.clone(cleanupHooks);
  await pw.installDependencies();
  await pw.buildProject();
  const commits = await pw.commitHistory('docs/docker/Dockerfile.bionic');
  const missingCommits = commits.filter(commit => !shaToInfo.has(commit.sha));

  const workdir = await misc.makeTempDir('workdir-for-docker-size-', cleanupHooks);
  for (const commit of missingCommits) {
    await pw.checkoutRevision(commit.sha);
    // build.sh may and may not exist.
    console.log(`* building docker file`);
    if (await pw.exists('./docs/docker/build.sh')) {
      const buildFilePath = pw.filepath('./docs/docker/build.sh');
      await misc.spawnAsyncOrDie('bash', buildFilePath, {
        cwd: pw.filepath('./docs/docker'),
      });
    } else {
      await misc.spawnAsyncOrDie('docker', 'build', '-it', 'playwright:localbuild', '-f', 'Dockerfile.bionic', '.', {
        cwd: pw.filepath('./docs/docker'),
      });
    }

    console.log(`* extracting imager`);
    // This command is expected to produce `dockerimage.tar` and `dockerimage.tar.gz`
    await misc.spawnAsyncOrDie('bash', 'docker-image-size.sh', workdir, {cwd: __dirname});
    // The only output in stdout is the compressed image.
    const rawStat = await fs.promises.stat(path.join(workdir, 'dockerimage.tar'));
    const zipStat = await fs.promises.stat(path.join(workdir, 'dockerimage.tar.gz'));
    shaToInfo.set(commit.sha, {
      ...commit,
      rawSize: rawStat.size,
      zipSize: zipStat.size,
    });

    data.infos = [...shaToInfo.values()];
    await dataBranch.writeJSON('./data.json', data);
    await dataBranch.upload();
  }
})();

