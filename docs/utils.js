// Copyright (c) Microsoft Corporation.
// Licensed under the MIT license.

export function onDOMEvent(target, event, handler, capturing = false) {
  target.addEventListener(event, handler, capturing);
  return () => target.removeEventListener(event, handler, capturing);
}

const listenersSymbol = Symbol('listeners');

export function createEvent() {
  const listeners = new Set();
  const subscribeFunction = listener => {
    listeners.add(listener);
    return subscribeFunction.removeListener.bind(subscribeFunction, listener);
  }
  subscribeFunction[listenersSymbol] = listeners;
  subscribeFunction.addListener = subscribeFunction;
  subscribeFunction.removeListener = (listener) => listeners.delete(listener);;
  return subscribeFunction;
}

export function emitEvent(event, ...args) {
  let listeners = event[listenersSymbol];
  if (!listeners || !listeners.size)
    return;
  listeners = new Set(listeners);
  for (const listener of listeners)
    listener.call(null, ...args);
}

export function disposeAll(disposables) {
  for (const d of disposables)
    d.call(null);
  disposables.splice(0);
}

export function consumeDOMEvent(event) {
  event.stopPropagation();
  event.preventDefault();
}

export function preventTextSelectionOnDBLClick(element) {
  // Prevent text selection on dblclick.
  element.addEventListener('mousedown', event => {
    if (event.detail > 1)
      consumeDOMEvent(event);
  }, true);
}

export function scrollIntoViewIfNeeded(element) {
  window.scrollIntoView(element, {
    block: 'center',
    behavior: 'instant',
    scrollMode: 'if-needed',
  });
}


/**
 * Serializing async operations one-by-one.
 */
export class CriticalSection {
  static wrap(func) {
    const section = new CriticalSection();
    return (...args) => section.run('', () => func(...args));
  }

  constructor() {
    this._rollingPromises = new Map();
  }

  async run(key, operation) {
    const rollingPromise = this._rollingPromises.get(key) || Promise.resolve();
    const resultPromise = rollingPromise.then(() => operation());
    const newRollingPromise = resultPromise.finally(() => {
      if (this._rollingPromises.get(key) === newRollingPromise)
        this._rollingPromises.delete(key);
    }).catch(e => {/* swallow error */});
    this._rollingPromises.set(key, newRollingPromise);
    return resultPromise;
  }
}

export class Throttler {
  static wrap(func, timeout = 0) {
    const throttler = new Throttler(timeout);
    return () => throttler.schedule(func);
  }

  constructor(timeout = 0) {
    this._pendingOperation = null;
    this._runningOperation = null;
    this._abortController = null;
    this._timeout = timeout;
  }

  schedule(operation) {
    this._pendingOperation = operation;
    this._maybeRun();
  }

  isScheduled() {
    return !!this._pendingOperation;
  }

  reset() {
    this.schedule(null);
  }

  _maybeRun() {
    if (this._runningOperation || !this._pendingOperation) {
      if (this._abortController)
        this._abortController.abort();
      return;
    }
    const operation = this._pendingOperation;
    this._pendingOperation = null;
    this._abortController = new AbortController();
    this._runningOperation = Promise.resolve()
        .then(() => operation.call(null, {signal: this._abortController.signal}))
        .catch(e => console.error(e))
        .then(() => this._timeout ? new Promise(x => setTimeout(x, this._timeout)) : undefined)
        .then(() => {
          this._runningOperation = null;
          this._abortController = null;
          this._maybeRun();
        });
  }
}

export class Table {
  constructor(nesting) {
    if (nesting < 2)
      throw new Error(`ERROR: nesting must be >= 2, ${nesting} received`);
    this._nesting = nesting;
    this._data = new Map();
  }

  get(...args) {
    if (args.length !== this._nesting - 1)
      throw new Error(`not enough arguments! expected ${this._nesting}`);
    let data = this._data;
    for (const arg of args) {
      data = data.get(arg);
      if (!data)
        return [];
    }
    return [...data];
  }

  delete(...args) {
    const key = args.pop();
    let data = this._data;
    for (const arg of args) {
      data = data.get(arg);
      if (!data)
        return;
    }
    data.delete(key);
  }

  set(...args) {
    if (args.length !== this._nesting)
      throw new Error(`not enough arguments! expected ${this._nesting}`);
    let data = this._data;
    const value = args.pop();
    const key = args.pop();
    for (const arg of args) {
      let map = data.get(arg);
      if (!map) {
        map = new Map();
        data.set(arg, map);
      }
      data = map;
    }
    let set = data.get(key);
    if (!set) {
      set = new Set();
      data.set(key, set);
    }
    set.add(value);
  }
}

export function observable(value, callback) {
  const event = createEvent();
  const result = {
    get() { return value; },
    set(newValue) {
      if (newValue === value)
        return;
      value = newValue;
      emitEvent(event, value);
    },
    observe: listener => {
      const unobserve = event.addListener(listener);
      listener(value);
      return unobserve;
    },
    unobserve: listener => {
      event.removeListener(listener);
    },
  };
  if (callback)
    result.observe(callback);
  return result;
}

export class ZWidget extends HTMLElement {
  connectedCallback() {
    if (this.onconnected)
      this.onconnected(this);
  }
  disconnectedCallback() { if (this.ondisconnected) this.ondisconnected(this); }
}
customElements.define('z-widget', ZWidget);
