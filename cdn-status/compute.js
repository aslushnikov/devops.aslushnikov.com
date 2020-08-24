const path = require('path');
const fs = require('fs');
const {URL} = require('url');
const {DataBranch} = require('../databranch.js');
const {clonePlaywrightRepo, spawnAsyncOrDie, headRequest} = require('../misc.js');

const DATA_DIR = path.join(__dirname, 'data');

const BRANCH_NAME = 'cdn-status-data';
const HOST = 'https://playwright.azureedge.net';

const BLOB_NAMES = {
  webkit: [
    'webkit-mac-10.14',
    'webkit-mac-10.15',
    'webkit-win64',
    'minibrowser-gtk-wpe',
    'minibrowser-mac-10.14',
    'minibrowser-mac-10.15',
    'minibrowser-win64',
  ],
  firefox: [
    'firefox-linux',
    'firefox-mac',
    'firefox-win32',
    'firefox-win64',
    'firefox-ubuntu-18.04',
    'firefox-mac-10.14',
  ],
};

async function collectRevisionInfo(rev, urls) {
  const statuses = await Promise.all(urls.map(url => headRequest(url)));
  return {
    rev,
    urls: urls.filter((url, index) => statuses[index]),
  };
}

async function updateCDNStatus(browserName, buildNumber, dataPath) {
  // Try to read last saved status and default to 'no status'
  const cdnData = await fs.promises.readFile(dataPath, 'utf8').catch(e => []);

  // Build a list of all missing status data.
  const revisionToInfo = new Map();
  for (const entry of cdnData)
    revisionToInfo.set(entry.rev, entry);

  const revisionsToFetch = new Set();
  // Fetch all revisions we don't have info about.
  for (let i = 1000; i <= buildNumber; ++i) {
    if (!revisionToInfo.has(i))
      revisionsToFetch.add(i);
  }
  // Also re-fetch information about 5 last revisions - since it changes.
  for (let i = buildNumber - 4; i <= buildNumber; ++i)
    revisionsToFetch.add(i);

  // Limit run to maximum of 50 missing revisions.
  // Cronjob will fill all missing over time.
  const allRevisionsToFetch = [...revisionsToFetch].sort().reverse().slice(0, 50);

  for (const rev of allRevisionsToFetch) {
    const label = `Fetching ${browserName} ${rev}`;
    console.time(label);
    const urls = [];
    for (const blobName of BLOB_NAMES[browserName]) {
      for (const ext of ['.zip', '.log.gz'])
        urls.push(`${HOST}/builds/${browserName}/${rev}/${blobName}${ext}`);
    }
    revisionToInfo.set(rev, await collectRevisionInfo(rev, urls));
    console.timeEnd(label);
  }

  await fs.promises.writeFile(dataPath, JSON.stringify([...revisionToInfo.values()]));
}

(async () => {
  const dataBranch = await DataBranch.initialize(BRANCH_NAME, DATA_DIR);
  const pwPath = await clonePlaywrightRepo();
  const wkBuildNumber = parseInt((await fs.promises.readFile(path.join(pwPath, 'browser_patches', 'webkit', 'BUILD_NUMBER'), 'utf8')).split('\n')[0], 10);
  const ffBuildNumber = parseInt((await fs.promises.readFile(path.join(pwPath, 'browser_patches', 'firefox', 'BUILD_NUMBER'), 'utf8')).split('\n')[0], 10);
  await fs.promises.rmdir(pwPath, {recursive: true});

  await updateCDNStatus('webkit', wkBuildNumber, path.join(DATA_DIR, 'webkit.json'));
  await updateCDNStatus('firefox', ffBuildNumber, path.join(DATA_DIR, 'firefox.json'));

  console.log(await dataBranch.upload('update cdn-status'));
})();

