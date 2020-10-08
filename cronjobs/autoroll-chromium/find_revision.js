const assert = require('assert');
const https = require('https');
const util = require('util');
const URL = require('url');

const {DataStore} = require('../datastore.js');
const {Playwright} = require('../playwright.js');
const misc = require('../misc.js');

const SUPPORTER_PLATFORMS = ['linux', 'mac', 'win32', 'win64'];


(async () => {
  const cleanupHooks = misc.setupProcessHooks();

  const pw = await Playwright.pickup(__dirname);
  const webkit = pw.webkitCheckout();

  const datastore = await DataStore.pickup(__dirname);
  const rolls = await datastore.readJSON('./rolls.json').catch(e => ([]));
  const roll = rolls[rolls.length - 1];

  try {
    roll.chromiumRevision = await findChromiumRevision();
    roll.steps.find_revision = 'ok';
  } catch (e) {
    roll.steps.find_revision = 'fail';
    console.error(e);
    process.exitCode = 1;
  }

  await datastore.writeJSON('./rolls.json', rolls);
  await datastore.upload('update roll data');
})();

async function findChromiumRevision() {
  const lastchanged = (await Promise.all([
    fetch('https://storage.googleapis.com/chromium-browser-snapshots/Mac/LAST_CHANGE'),
    fetch('https://storage.googleapis.com/chromium-browser-snapshots/Linux_x64/LAST_CHANGE'),
    fetch('https://storage.googleapis.com/chromium-browser-snapshots/Win/LAST_CHANGE'),
    fetch('https://storage.googleapis.com/chromium-browser-snapshots/Win_x64/LAST_CHANGE'),
  ])).map(s => parseInt(s, 10));
  const fromRevision = Math.max(...lastchanged);
  const toRevision = 0;
  for (let revision = fromRevision; revision > fromRevision - 2000; --revision) {
    let allAvailable = true;
    for (const platform of SUPPORTER_PLATFORMS) {
      if (!(await canDownloadChromium(revision, platform))) {
        allAvailable = false;
        break;
      }
    }
    if (allAvailable)
      return revision;
  }
  throw new Error('Failed to find chromium revision');
}

async function canDownloadChromium(revision, platform) {
  const serverHost = 'https://storage.googleapis.com';
  const urlTemplate = new Map([
    ['linux', '%s/chromium-browser-snapshots/Linux_x64/%d/chrome-linux.zip'],
    ['mac', '%s/chromium-browser-snapshots/Mac/%d/chrome-mac.zip'],
    ['win32', '%s/chromium-browser-snapshots/Win/%d/chrome-win.zip'],
    ['win64', '%s/chromium-browser-snapshots/Win_x64/%d/chrome-win.zip'],
  ]).get(platform);
  const url = util.format(urlTemplate, serverHost, revision);
  return await headRequest(url);
}

/**
 * @param {string} url
 * @return {!Promise<?string>}
 */
function fetch(url) {
  let resolve;
  const promise = new Promise(x => resolve = x);
  https.get(url, response => {
    if (response.statusCode !== 200) {
      resolve(null);
      return;
    }
    let body = '';
    response.on('data', function(chunk){
      body += chunk;
    });
    response.on('end', function(){
      resolve(body);
    });
  }).on('error', function(e){
    console.error('Error fetching json: ' + e);
    resolve(null);
  });
  return promise;
}

async function headRequest(url) {
  return new Promise(resolve => {
    let options = URL.parse(url);
    options['method'] = 'HEAD';
    const request = https.request(options, res => resolve(res.statusCode === 200));
    request.on('error', error => resolve(false));
    request.end();
  });
}

