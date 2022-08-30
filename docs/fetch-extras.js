// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

import {CriticalSection} from './utils.js';
import {Store as IDBStore, get as idbGet, set as idbSet, keys as idbKeys, del as idbDel, clear as idbClear} from './third-party/idb-keyval.mjs';

// Bump version number whenever cache format changes.
const RATE_LIMITED_FETCHER_VERSION = 1;

class RateLimitedFetcher {
  static async create() {
    const fetcher = new RateLimitedFetcher(await isFirefoxPrivateBrowsingMode());
    const version = await fetcher._cache.get('RATE_LIMITED_FETCHER_VERSION');
    if (!version || version !== RATE_LIMITED_FETCHER_VERSION) {
      console.warn('Clearing RateLimitedFetcher cache');
      await fetcher._cache.clear();
      await fetcher._cache.set('RATE_LIMITED_FETCHER_VERSION', RATE_LIMITED_FETCHER_VERSION);
    }
    // Sweep outdated cache items.
    const keys = (await fetcher._cache.keys()).filter(key => key !== 'RATE_LIMITED_FETCHER_VERSION');
    const now = Date.now();
    const isKeyOutdated = await Promise.all(keys.map(key => fetcher._cache.get(key).then(data => now - data.timestamp > data.maxAge)));
    const toBeRemoved = keys.filter((key, index) => isKeyOutdated[index]);
    await Promise.all(toBeRemoved.map(key => fetcher._cache.delete(key)));
    return fetcher;
  }

  constructor(useLocalStorage) {
    this._cache = {};
    this._criticalSection = new CriticalSection();
    if (useLocalStorage) {
      const LOCALSTORAGE_KEY_PREFIX = 'rate-limited-fetcher-';
      this._cache.set = async (key, value) => localStorage.setItem(LOCALSTORAGE_KEY_PREFIX + key, JSON.stringify(value));
      this._cache.get = async (key) => JSON.parse(localStorage.getItem( + key));
      this._cache.delete = async (key) => localStorage.removeItem(LOCALSTORAGE_KEY_PREFIX + key);
      this._cache.keys = async () => Object.keys(localStorage).filter(key => key.startsWith(LOCALSTORAGE_KEY_PREFIX)).map(key => key.substr(LOCALSTORAGE_KEY_PREFIX.length));
      this._cache.clear = async () => Object.keys(localStorage).filter(key => key.startsWith(LOCALSTORAGE_KEY_PREFIX)).forEach(key => localStorage.removeItem(key));
    } else {
      const store = new IDBStore('rate-limited-fetcher', 'request-cache')
      this._cache.set = async (key, value) => idbSet(key, value, store);
      this._cache.get = async (key) => idbGet(key, store);
      this._cache.delete = async (key) => idbDel(key, store);
      this._cache.keys = async () => idbKeys(store);
      this._cache.clear = async () => idbClear(store);
    }
  }

  async get(url, options, maxAge = 15 * 60 * 1000 /* 15 minutes */) {
    options = { ...options, method: 'get' };
    const CACHE_KEY = JSON.stringify({...options, url});
    return await this._criticalSection.run(CACHE_KEY, async () => {
      const data = await this._cache.get(CACHE_KEY);
      if (data && Date.now() - data.timestamp < data.maxAge)
        return data.text;
      const response = await fetch(url, options);
      if (!response.ok) {
        // Save result as `null` and cache it for the next 10 minutes.
        // Otherwise we might keep flooding GH API and might eventually run out of quota.
        await this._cache.set(CACHE_KEY, {timestamp: Date.now(), maxAge: 10 * 60 * 1000, text: null});
        return null;
      }
      const text = await response.text();
      await this._cache.set(CACHE_KEY, {timestamp: Date.now(), maxAge, text});
      return text;
    });
  }
}

let rlfetcherPromise = null;

export function rateLimitedFetch(url, options, maxAge) {
  if (!rlfetcherPromise)
    rlfetcherPromise = RateLimitedFetcher.create();
  return rlfetcherPromise.then(fetcher => fetcher.get(url, options, maxAge));
}

// This is based on https://javascript.info/fetch-progress
export async function fetchProgress(url, progressCallback = () => {}) {
  const safeCallback = (...args) => {
    try {
      progressCallback(...args);
    } catch (e) {
      // Log error, but keep download.
      console.error(e);
    }
  };
  // Step 1: start the fetch and obtain a reader
  let response = await fetch(url);
  if (!response.ok)
    throw new Error('Fetch failed: ' + response.status);

  const reader = response.body.getReader();

  // Step 2: get total length
  const contentLength = +response.headers.get('Content-Length');
  safeCallback(0, contentLength, false);

  // Step 3: read the data
  let receivedLength = 0; // received that many bytes at the moment
  let chunks = []; // array of received binary chunks (comprises the body)
  while(true) {
    const {done, value} = await reader.read();

    if (done) {
      break;
    }

    chunks.push(value);
    receivedLength += value.byteLength;
    safeCallback(receivedLength, contentLength, false);
  }
  safeCallback(receivedLength, contentLength, true);

  // Step 4: concatenate chunks into single Uint8Array
  let chunksAll = new Uint8Array(receivedLength); // (4.1)
  let position = 0;
  for(let chunk of chunks) {
    chunksAll.set(chunk, position); // (4.2)
    position += chunk.length;
  }

  // Step 5: decode into a string
  return new TextDecoder("utf-8").decode(chunksAll);
}

// See Firefox bug: https://bugzilla.mozilla.org/show_bug.cgi?id=781982
// And pptr.dev bug: https://github.com/GoogleChromeLabs/pptr.dev/issues/3
function isFirefoxPrivateBrowsingMode() {
  if (!('MozAppearance' in document.documentElement.style))
    return Promise.resolve(false);

  const db = indexedDB.open('test');
  return new Promise(resolve => {
    db.onerror = resolve.bind(null, true);
    db.onsuccess = resolve.bind(null, false);
  });
}


