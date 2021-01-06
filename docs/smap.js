export class SMap {
  constructor(entries) {
    this._entries = entries;
    this._indexes = new Map();
    this[Symbol.iterator] = () => this._entries[Symbol.iterator]();
  }

  map(callback) {
    return this._entries.map(callback);
  }

  get(selector) {
    const entries = this.getAll(selector);
    return entries.length ? entries[0] : null;
  }

  getAll(selector) {
    const keys = Object.keys(selector).sort();
    const indexId = JSON.stringify(keys);
    let index = this._indexes.get(indexId);
    if (!index) {
      index = new Index(this._entries, keys);
      this._indexes.set(indexId, index);
    }
    return index.getAll(selector);
  }
}

class Index {
  constructor(entries, keys) {
    this._keys = keys.slice();
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
        throw new Error(`no computed index for selector - selector is missing key "${key}"`);
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

