export class SMap {
  constructor(entries = []) {
    this._entries = entries;
    this._indexes = new Map();
    this[Symbol.iterator] = () => this._entries[Symbol.iterator]();
  }

  map(callback) { return this._entries.map(callback); }
  filter(callback) { return this._entries.filter(callback); }
  slice(from, to) { return this._entries.slice(from, to); }
  get size() { return this._entries.length; }

  has(selector) {
    const entries = this.getAll(selector);
    return entries.length > 0;
  }

  uniqueValues(key) {
    const index = this._ensureIndex([key]);
    return [...index._data.keys()];
  }

  get(selector) {
    const entries = this.getAll(selector);
    return entries.length ? entries[0] : null;
  }

  _ensureIndex(keys) {
    keys.sort();
    const indexId = JSON.stringify(keys);
    let index = this._indexes.get(indexId);
    if (!index) {
      index = new Index(this._entries, keys);
      this._indexes.set(indexId, index);
    }
    return index;
  }

  getAll(selector) {
    const keys = Object.entries(selector).filter(([key, value]) => value !== undefined).map(([key]) => key);
    return this._ensureIndex(keys).getAll(selector);
  }
}

class Index {
  constructor(entries, keys) {
    this._keys = keys;//keys.slice();
    this._lastKey = this._keys.pop();
    this._data = new Map();
    for (const entry of entries) {
      let data = this._data;
      for (const key of this._keys) {
        const value = entry[key];
        let map = data.get(value);
        if (!map) {
          map = new Map();
          data.set(value, map);
        }
        data = map;
      }
      const lastValue = entry[this._lastKey];
      let array = data.get(lastValue);
      if (!array) {
        array = [];
        data.set(lastValue, array);
      }
      array.push(entry);
    }
  }

  getAll(selector) {
    let data = this._data;
    for (const key of this._keys) {
      data = data.get(selector[key]);
      if (!data)
        return [];
    }
    return data.get(selector[this._lastKey]) || [];
  }
}

const s = new SMap([
  {name: 'andrey', lastname: 'lushnikov', age: 31},
  {name: 'anna', lastname: 'dobrolezh', age: 30},
  {name: 'anna', lastname: 'morozova', age: 30},
  {name: 'sergey', lastname: 'vasilinetc', age: 30},
  {name: 'timur', lastname: 'abishev', age: 31},
  {name: 'sergey', lastname: 'serebryakov', age: 28},
]);

