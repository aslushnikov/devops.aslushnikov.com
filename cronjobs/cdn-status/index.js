const {DataStore} = require('../datastore.js');
const {Playwright} = require('../playwright.js');
const misc = require('../misc.js');

const HOST = 'https://playwright.azureedge.net';

const BLOB_NAMES = {
  chromium: [
    'chromium-linux',
    'chromium-mac',
    'chromium-win32',
    'chromium-win64',
  ],
  ffmpeg: [
    'ffmpeg-linux',
    'ffmpeg-mac',
    'ffmpeg-win32',
    'ffmpeg-win64',
  ],
  winldd: [
    'winldd-win64',
  ],
  webkit: [
    'webkit-ubuntu-18.04',
    'webkit-ubuntu-20.04',
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
  const statuses = await Promise.all(urls.map(url => misc.headRequest(url)));
  return {
    rev,
    urls: urls.filter((url, index) => statuses[index]),
  };
}

async function updateCDNStatus(pw, browserName, cdnData) {
  const buildNumber = await pw.buildNumber(browserName);
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
  const result = [...revisionToInfo.values()];
  result.sort((a, b) => a.rev - b.rev);
  return result;
}

const FORMAT_VERSION = 2;

(async () => {
  misc.setupProcessHooks();
  const datastore = await DataStore.clone(__dirname);
  const pw = await Playwright.clone(__dirname);
  // Try to read last saved status and default to 'no status'
  const defaultData = {
    version: FORMAT_VERSION,
    timestamp: Date.now(),
    webkit: [],
    firefox: [],
    chromium: [],
    winldd: [],
    ffmpeg: [],
  };
  let status = await datastore.readJSON('./status.json').catch(e => defaultData);
  if (status.version !== FORMAT_VERSION)
    status = defaultData;

  const newWebKit = await updateCDNStatus(pw, 'webkit', status.webkit || []);
  const newFirefox = await updateCDNStatus(pw, 'firefox', status.firefox || []);
  const newChromium = await updateCDNStatus(pw, 'chromium', status.chromium || []);
  const newFfmpeg = await updateCDNStatus(pw, 'ffmpeg', status.ffmpeg || []);
  const newWinldd = await updateCDNStatus(pw, 'winldd', status.winldd || []);

  if (JSON.stringify(newWebKit) === JSON.stringify(status.webkit) &&
      JSON.stringify(newFirefox) === JSON.stringify(status.firefox) &&
      JSON.stringify(newChromium) === JSON.stringify(status.chromium) &&
      JSON.stringify(newFfmpeg) === JSON.stringify(status.ffmpeg) &&
      JSON.stringify(newWinldd) === JSON.stringify(status.winldd)) {
    console.log('FYI: CDN status did not change - do nothing.');
    return;
  }

  status.webkit = newWebKit;
  status.firefox = newFirefox;
  status.chromium = newChromium;
  status.winldd = newWinldd;
  status.ffmpeg = newFfmpeg;
  status.timestamp = Date.now();

  await datastore.writeJSON('./status.json', status);
  await datastore.upload('update cdn-status');
})();

