import {onDOMEvent, disposeAll} from './utils.js';

export function newURL(state) {
  const params = new URLSearchParams(Object.entries(state));
  return '#' + params.toString();
}

export function amendURL(changes) {
  const params = new URLSearchParams(window.location.hash.substring(1));
  const state = Object.fromEntries(params.entries());
  const newParams = new URLSearchParams(Object.entries({...state, ...changes}).filter(([key, value]) => value !== undefined));
  return '#' + newParams.toString();
}

export class URLState {
  constructor() {
    this._currentStateURL = null;
    this._handler = null;
    this._eventListeners = [];
  }

  startListening(handler) {
    if (this._handler)
      throw new Error('already listening! is this called second time?');
    this._handler = handler;
    this._eventListeners = [
      onDOMEvent(window, 'popstate', () => this._checkStateChanged()),
    ];
    this._checkStateChanged();
  }

  stopListening() {
    this._handler = null;
    disposeAll(this._eventListeners);
  }

  amend(changes) {
    window.history.pushState({}, '', amendURL(changes));
    this._checkStateChanged();
  }

  goto(state) {
    window.history.pushState({}, '', newURL(state));
    this._checkStateChanged();
  }

  state() {
    const params = new URLSearchParams(window.location.hash.substring(1));
    return Object.fromEntries(params.entries());
  }

  _checkStateChanged() {
    if (!this._handler)
      return;
    const params = new URLSearchParams(window.location.hash.substring(1));
    const currentStateURL = params.toString();
    if (currentStateURL === this._currentStateURL)
      return;
    this._currentStateURL = currentStateURL;
    this._handler.call(null, Object.fromEntries(params.entries()));
  }
}
