const STORE_NAME = 'key-value';

export class IDBStore {
  constructor(dbName) {
    this._databasePromise = safariFix().then(() => {
      const request = indexedDB.open('idb-store-' + dbName);
      request.onupgradeneeded = () => request.result.createObjectStore(STORE_NAME);
      return idbPromise(request);
    });
  }

  async _transactionStore(mode) {
    const db = await this._databasePromise;
    return db.transaction(STORE_NAME, mode).objectStore(STORE_NAME);
  }

  async get(key) {
    const store = await this._transactionStore('readonly');
    const value = await idbPromise(store.get(key));
    return value;
  }

  async set(key, value) {
    const store = await this._transactionStore('readwrite');
    store.put(value, key);
    await idbPromise(store.transaction);
  }

  async delete(key) {
    const store = await this._transactionStore('readwrite');
    store.delete(key);
    await idbPromise(store.transaction);
  }
}

function idbPromise(request) {
  return new Promise((resolve, reject) => {
    request.oncomplete = request.onsuccess = () => resolve(request.result);
    request.onabort = request.onerror = () => reject(request.error);
  });
}

