const path = require('path');
const fs = require('fs');
const https = require('https');
const {URL} = require('url');
const {DataBranch} = require('../databranch.js');
const {clonePlaywrightRepo, spawnAsyncOrDie} = require('../misc.js');

const DATA_PATH = path.join(__dirname, 'data', 'cdn-status.json');

(async () => {
  const dataBranch = await DataBranch.initialize('aslushnikov/devops.aslushnikov.com', 'cdn-status-data', path.dirname(DATA_PATH));

  const pwPath = await clonePlaywrightRepo();
  const WEBKIT_BUILD_NUMBER = parseInt(await fs.promises.readFile(path.join(pwPath, 'browser_patches', 'webkit', 'BUILD_NUMBER'), 'utf8'), 10);
  // Try to read last saved status and default to 'no status'
  const cdnData = await fs.promises.readFile(DATA_PATH, 'utf8').catch(e => []);

  // Build a list of all missing status data.
  const revisionToInfo = new Map();
  for (const entry of cdnData)
    revisionToInfo.set(entry.rev, entry);

  const revisionsToFetch = new Set();
  // Fetch all revisions we don't have info about.
  for (let i = 1000; i <= WEBKIT_BUILD_NUMBER; ++i) {
    if (!revisionToInfo.has(i))
      revisionsToFetch.add(i);
  }
  // Also re-fetch information about 3 last revisions.
  for (let i = WEBKIT_BUILD_NUMBER - 2; i <= WEBKIT_BUILD_NUMBER; ++i)
    revisionsToFetch.add(i);

  for (const rev of revisionsToFetch) {
    const label = `Fetching WebKit ${rev}`;
    console.time(label);
    revisionToInfo.set(rev, await collectRevisionInfo(rev, webkitURLs(rev)));
    console.timeEnd(label);
  }

  await fs.promises.writeFile(DATA_PATH, JSON.stringify([...revisionToInfo.values()]));
  console.log(await dataBranch.upload('update cdn-status'));
  await fs.promises.rmdir(pwPath, {recursive: true});
})();

const WEBKIT_BLOB_NAMES = [
  'webkit-mac-10.14',
  'webkit-mac-10.15',
  'webkit-win64',
  'minibrowser-gtk-wpe',
  'minibrowser-mac-10.14',
  'minibrowser-mac-10.15',
  'minibrowser-win64',
];

const HOST = 'https://playwright.azureedge.net';

function webkitURLs(rev) {
  const urls = [];
  for (const blobName of WEBKIT_BLOB_NAMES) {
    for (const ext of ['.zip', '.log.gz'])
      urls.push(`${HOST}/builds/webkit/${rev}/${blobName}${ext}`);
  }
  return urls;
}

async function collectRevisionInfo(rev, urls) {
  const statuses = await Promise.all(urls.map(url => headRequest(url)));
  return {
    rev,
    urls: urls.filter((url, index) => statuses[index]),
  };
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
