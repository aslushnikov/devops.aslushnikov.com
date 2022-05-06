import { html, svg } from './zhtml.js';
import { stripAnsi, humanReadableTimeIntervalShort } from './misc.js';
import { Throttler, consumeDOMEvent, preventTextSelectionOnDBLClick, observable } from './utils.js';
import { URLState, newURL, amendURL } from './urlstate.js';
import { Popover } from './widgets.js';

const urlState = new URLState();
const CHAR_ELLIPSIS = '…';
const CHAR_LONG_DASH = '—';
const CHAR_ARROW_RIGHT = '►';
const CHAR_ARROW_LEFT = '◀';
const CHAR_ARROW_BOTTOM = '▼';
const CHAR_WARN = '⚠';
const CHAR_QUESTION = '�'
const ICON_WARN = (width = 24, height = 24, fill = 'black') => svg`<svg fill=${fill} xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="${width}" height="${height}"><path fill-rule="evenodd" d="M1 12C1 5.925 5.925 1 12 1s11 4.925 11 11-4.925 11-11 11S1 18.075 1 12zm8.036-4.024a.75.75 0 00-1.06 1.06L10.939 12l-2.963 2.963a.75.75 0 101.06 1.06L12 13.06l2.963 2.964a.75.75 0 001.061-1.06L13.061 12l2.963-2.964a.75.75 0 10-1.06-1.06L12 10.939 9.036 7.976z"></path></svg>`;
const ICON_EXCLAMATION = (width = 24, height = 24, fill = 'black') => svg`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="${width}" height="${height}" fill=${fill}><path d="M12 7a.75.75 0 01.75.75v4.5a.75.75 0 01-1.5 0v-4.5A.75.75 0 0112 7zm0 10a1 1 0 100-2 1 1 0 000 2z"></path><path fill-rule="evenodd" d="M7.328 1.47a.75.75 0 01.53-.22h8.284a.75.75 0 01.53.22l5.858 5.858c.141.14.22.33.22.53v8.284a.75.75 0 01-.22.53l-5.858 5.858a.75.75 0 01-.53.22H7.858a.75.75 0 01-.53-.22L1.47 16.672a.75.75 0 01-.22-.53V7.858a.75.75 0 01.22-.53L7.328 1.47zm.84 1.28L2.75 8.169v7.662l5.419 5.419h7.662l5.419-5.418V8.168L15.832 2.75H8.168z"></path></svg>`;

const popover = new Popover(document.body);
document.documentElement.addEventListener('click', event => {
  if (!popover.isShown())
    return;
  if (popover.element().contains(event.target))
    return;
  consumeDOMEvent(event);
  popover.hide();
}, true);

window.addEventListener('DOMContentLoaded', async () => {

  const pwlog = new PWLog();
  document.body.append(html`
    ${pwlog.element}
  `);

  urlState.startListening(Throttler.wrap(async () => {
    const state = urlState.state();
    pwlog.filter.set(state.filter || '');
  }));
}, false);

class PWLog {
  constructor() {
    this.render = Throttler.wrap(this._doRender.bind(this));

    this.log = observable(localStorage.getItem('log') || '');
    this.filter = observable('', () => this.render());

    this._messages = [];

    this.element = html`
      <vbox style='min-height: 100%; min-width: fit-content;'>
        <hbox style='
            padding: 4px 1em;
            position: sticky;
            top: 0;
            background-color: #f5f5f5;
            border-bottom: 1px solid #333;
        '>
          <h4 style='
                margin: 0 1em 0 0;
                color: var(--link-color);
              '
          >PWLog</h4>
          <button
            onclick=${() => this.log.set('')}
            onzrender=${node => this.log.observe(log => node.disabled = !log)}
          >Clear</button>
          <hbox style='margin-left: 1em;'>
            <input
              type=text
              placeholder="filter.."
              onzrender=${e => this.filter.observe(value => e.value = value)}
              oninput=${e => urlState.amend({ filter: e.target.value })}
            >
          </hbox>
        </hbox>
        <vbox onzrender=${e => this._logContainer = e}></vbox>
      </vbox>
    `;
    window.addEventListener('paste', e => {
      if (this._messages.length)
        return;
      const log = e.clipboardData.getData('text/plain');
      this.log.set(log);
    }, false);

    this.log.observe(log => this._setLog(log));
  }

  _doRender() {
    this._logContainer.textContent = '';
    if (!this._messages.length) {
      this._logContainer.append(html`
        <vbox style="justify-content: center; align-items: center; flex: auto;">
          <h3>Paste pw:protocol text</h3>
        </vbox>
      `);
      return;
    }

    const logElement = html`<section id=grid style='
        display: grid;
        grid-template-columns:
            [sendicon] fit-content(200px)
            [sendmsg] 1fr
            [recvicon] fit-content(200px)
            [recvmsg] 1fr
          ;
      '></section>
    `;
    this._logContainer.append(logElement);

    const sendMessages = new Map();
    const recvMessages = new Map();
    const allMessages = new Set();
    for (const msg of this._messages) {
      allMessages.add(msg);
      if (!msg.id())
        continue;
      if (msg.type() === msgTypes.SEND)
        sendMessages.set(msg.id(), msg);
      else if (msg.type() === msgTypes.RECV)
        recvMessages.set(msg.id(), msg);
    }

    const domainToColor = {
      '': 'transparent',
      'Page': '#fff9c4',
      'Target': '#ede7f6',
      'Network': '#e3f2fd',
      'Runtime': '#fff3e0',
      'Browser': '#eceff1',
      'Input': '#f1f8e9',
      'Log': '#e0e0e0',
      'Emulation': '#fbe9e7',
      'DOM': '#e1f5fe'
    };

    const renderMessage = (msg, bgColor = 'transparent') => html`
      <div text_overflow style='
          grid-column: ${msg.type() === msgTypes.SEND ? 'sendmsg' : 'recvmsg'};
          white-space: nowrap;
          padding-left: 5px;
          background-color: ${bgColor};
          border-bottom: 1px solid #ddd;
        '>${msg.element}</div>
    `;

    for (const msg of allMessages) {
      if (!msg.raw().toLowerCase().includes(this.filter.get().toLowerCase()))
        continue;
      if (msg.type() === msgTypes.STDOUT)
        continue;
      const rowWrapper = html`<div hoverable style="display: contents;"></div>`;
      logElement.append(rowWrapper);

      const command = msg.type() === msgTypes.SEND ? msg : undefined;
      const response = command ? recvMessages.get(msg.id()) : undefined;
      const event = msg.type() === msgTypes.RECV && !msg.id() ? msg : undefined;

      if (command) {
        rowWrapper.append(renderMessage(command, domainToColor[command.domain()]));
        if (response) {
          rowWrapper.append(renderMessage(response, domainToColor[command.domain()]));
          allMessages.delete(response);
        } else {
          rowWrapper.append(html`
            <div style='
                grid-column: recvmsg;
                color: red;
              '>NO REPONSE FOUND</div>
          `);
        }
      } else {
        rowWrapper.append(renderMessage(msg, domainToColor[msg.domain() || '']));
      }
    }
  }

  _setLog(log) {
    localStorage.setItem('log', log);
    if (!log) {
      this._messages = [];
      this.render();
      return;
    }
    const lines = stripAnsi(log).split('\n');
    const parsedLines = [];
    let lastParsed = undefined;
    for (const line of lines) {
      const parsed = LogMessage.parse(line);
      if (parsed.type === msgTypes.STDOUT && lastParsed?.type === msgTypes.STDOUT && !parsed.parseError) {
        lastParsed.raw += '\n' + parsed.raw;
      } else {
        parsedLines.push(parsed);
        lastParsed = parsed;
      }
    }
    this._messages = [];
    let currentTimestamp = 0;
    let firstTimestamp = undefined;
    for (const parsedLine of parsedLines) {
      let timestamp = undefined;
      if (parsedLine.msDelta !== undefined) {
        currentTimestamp += parsedLine.msDelta;
        timestamp = currentTimestamp;
      } else if (parsedLine.timestamp) {
        if (!firstTimestamp)
          firstTimestamp = parsedLine.timestamp;
        timestamp = parsedLine.timestamp - firstTimestamp;
      }

      this._messages.push(new LogMessage({
        ...parsedLine,
        timestamp,
      }));
    }
    this.render();
  }
}

const MSG_REGEX = /([\w:]+)\s+(SEND ►|◀ RECV)\s+({.*})\s+(\+\d+\w+)\s*/;
const MSG_REGEX_2 = /(\d\d\d\d-\d\d-\d\dT\d\d:\d\d:\d\d\.\d\d\dZ)\s+([\w:]+)\s+(SEND ►|◀ RECV)\s+({.*})/;

const msgTypes = {
  SEND: 'SEND ►',
  RECV: '◀ RECV',
  STDOUT: 'STDOUT',
};

class LogMessage {
  static parse(raw) {
    let match, type, namespace, jsonText, msDelta, timestamp;
    if (match = raw.match(MSG_REGEX)) {
      namespace = match[1];
      type = match[2];
      jsonText = match[3];
      const deltaText = match[4];
      msDelta = 0;
      if (deltaText.endsWith('ms'))
        msDelta = Number.parseInt(deltaText);
      else if (deltaText.endsWith('s'))
        msDelta = Number.parseInt(deltaText) * 1000;
      else if (deltaText.endsWith('m'))
        msDelta = Number.parseInt(deltaText) * 1000 * 60;
      else
        return { raw, type: msgTypes.STDOUT, parseError: 'Failed to parse timestamp' };
    } else if (match = raw.match(MSG_REGEX_2)) {
      timestamp = +(new Date(match[1]));
      namespace = match[2];
      type = match[3];
      jsonText = match[4];
    } else {
      return { raw, type: msgTypes.STDOUT };
    }
    try {
      const json = JSON.parse(jsonText);
      return { raw, type, namespace, msDelta, json, timestamp };
    } catch(error) {
      return { raw, type: msgTypes.STDOUT, namespace, msDelta, timestamp, parseError: error };
    }
  }

  constructor({ raw, type, namespace, json, parseError, timestamp }) {
    this._raw = raw;
    this._rawLines = raw.trim().split('\n');
    this._type = type;
    this._namespace = namespace;
    this._json = json;
    this._timestamp = timestamp;
    this._parseError = parseError;

    let icon = undefined;
    if (this._type === msgTypes.SEND)
      icon = html`<span class="msg-type-send log-row-icon">SEND ${CHAR_ARROW_RIGHT}</span>`;
    else if (this._type === msgTypes.RECV && json?.id)
      icon = html`<span class="msg-type-recv log-row-icon">${CHAR_ARROW_LEFT} ACK</span>`;
    else
      icon = html`<span class="msg-type-event log-row-icon">${CHAR_ARROW_LEFT} EVENT</span>`;

    let firstLineElement = undefined;
    let secondLineElement = undefined;
    if (json?.method) {
      if (json.params) {
        const jsonView = new JSONView(json.params, html`<hbox>${icon}${json.method}(</hbox>`, ')');
        firstLineElement = jsonView.preview;
        secondLineElement = jsonView.expanded;
      } else {
        firstLineElement = html`<hbox>${icon}${json.method}()</hbox>`;
      }
    } else if (json?.id) {
      if (Object.keys(json.result ?? {}).length) {
        const jsonView = new JSONView(json.result ?? {}, html`<hbox>${icon}</hbox>`);
        firstLineElement = jsonView.preview;
        secondLineElement = jsonView.expanded;
      } else {
        firstLineElement = html`<hbox>${icon}{}</hbox>`;
      }
    } else {
      firstLineElement = html`${this._rawLines[0] ?? ''}`;
      secondLineElement = html`<div style='white-space: pre;'>${this._rawLines.slice(1).join('\n')}</div>`;
    }

    this.element = html`
      <vbox>
        ${firstLineElement}
        ${secondLineElement}
      </vbox>
    `;
  }

  timestamp() { return this._timestamp; }

  domain() { return this._json?.method?.split('.')[0]; }
  id() { return this._json?.id; }
  json() { return this._json; }
  isAck() { return this._json && !this._json.method; }
  parseError() { return this._parseError; }
  type() { return this._type; }
  raw() { return this._raw; }
}

function renderJSONValue(value, maxValueSize = Infinity) {
  if (value === undefined)
    return html`<span style="color: #9e9e9e">undefined</span>`;
  if (value === null)
    return html`<span style="color: red">null</span>`;
  let text = value + '';
  if (text.length > maxValueSize) {
    const N = text.length, k = (maxValueSize / 2) | 0;
    text = text.substring(0, k) + CHAR_ELLIPSIS + text.substring(N - k);
  }
  if (Number.isNaN(value) || (typeof value === 'number'))
    return html`<span style="color: blue">${text}</span>`;
  if (typeof value === 'boolean')
    return html`<span style="color: blue">${text}</span>`;
  if (typeof value === 'string')
    return html`<span style="color: #333">"</span><span style="color: red">${text}</span><span style="color: #333">"</span>`;
  return html`<span>${text}</span>`;
}

function renderJSONKey(key) {
  return html`<span style="color: #757575">${key}</span>`;
}

function renderJSONPreview(json, maxValueSize = 30) {
  const element = html`<span text_overflow style="
      display: inline-flex;
      align-items: center;
    "></span>`;
  if (typeof json !== 'object') {
    element.append(renderJSONValue(json, maxValueSize));
    return element;
  }

  const punct = (text, marginLeft = 0, marginRight = 0) => html`<span style='margin: 0 ${marginRight} 0 ${marginLeft};'>${text}</span>`;

  const isArray = Array.isArray(json);
  const entries = Object.entries(json || {});

  element.append(punct(isArray ? '[' : '{', 0, entries.length ? '1ex' : 0));
  // We'd like middle part to shrink, so it's a text_overflow container.
  const shrinkable = html`<span text_overflow></span>`;
  element.append(shrinkable);
  for (let i = 0; i < entries.length; ++i) {
    const [key, value] = entries[i];
    if (i > 0)
      shrinkable.append(punct(', ', 0, '1ex'));
    // Do not render keys for arrays.
    if (!isArray) {
      shrinkable.append(renderJSONKey(key));
      shrinkable.append(punct(': ', 0, '1ex'));
    }
    if (typeof value === 'object') {
      if (Array.isArray(value))
        shrinkable.append(html`[${CHAR_ELLIPSIS}]`);
      else
        shrinkable.append(html`{${CHAR_ELLIPSIS}}`);
    } else {
      shrinkable.append(renderJSONValue(value, maxValueSize));
    }
  }
  element.append(punct(isArray ? ']' : '}', entries.length ? '1ex' : 0, 0));
  return element;
}

class JSONView {
  constructor(json, prefix = '', suffix = '', nesting = 0) {
    this._json = json;
    this._prefix = prefix;
    this._suffix = suffix;
    this._nesting = nesting;
    this._isExpanded = false;
    this.preview = html`<hbox text_overflow></hbox>`;
    this.expanded = html`<vbox text_overflow></vbox>`;
    this.collapse();

    if (this.isExpandable()) {
      this.preview.style.setProperty('cursor', 'pointer');
      preventTextSelectionOnDBLClick(this.preview);
      this.preview.addEventListener('click', event => {
        if (window.getSelection().type === 'Range')
          return;
        if (this._isExpanded)
          this.collapse();
        else
          this.expand();
        consumeDOMEvent(event);
      }, false);
    }
  }

  isExpandable() {
    return typeof this._json === 'object';
  }

  _renderExpandIcon() {
    return html`<span style='
        font-size: 80%;
        position: absolute;
        color: ${this.isExpandable() ? '#aaa' : 'transparent'};
      '>${this._isExpanded ? CHAR_ARROW_BOTTOM : CHAR_ARROW_RIGHT}</span>
    `;
  }

  collapse() {
    this._isExpanded = false;
    this.preview.textContent = '';
    // this.preview.append(this._renderExpandIcon());
    this.preview.append(this._prefix);
    this.preview.append(renderJSONPreview(this._json, 30));
    this.preview.append(this._suffix);
    this.expanded.textContent = '';
  }

  expand() {
    if (!this.isExpandable())
      return;
    this._isExpanded = true;
    const isArray = Array.isArray(this._json);
    this.preview.textContent = '';
    // this.preview.append(this._renderExpandIcon());
    this.preview.append(this._prefix);
    this.preview.append(isArray ? '[' : '{');

    this.expanded.textContent = '';
    const entries = Object.entries(this._json);
    for (const [key, value] of Object.entries(this._json)) {
      const jsonRow = html`<span text_overflow style='padding-left: ${this._nesting * 2 + 2}ch;'></span>`;
      const prefix = !isArray ? html`
        <span>
          ${renderJSONKey(key)}
          <span style='margin-right: 1ex'>:</span>
        </span>
      ` : '';
      if (typeof value === 'object') {
        const jsonView = new JSONView(value, prefix, '', this._nesting + 1);
        jsonRow.append(jsonView.preview);
        this.expanded.append(jsonRow);
        this.expanded.append(jsonView.expanded);
      } else {
        jsonRow.append(prefix);
        jsonRow.append(renderJSONValue(value, 100));
        this.expanded.append(jsonRow);
      }
    }
    this.expanded.append(html`<hbox style='padding-left: ${this._nesting * 2}ch'>${isArray ? ']' : '}'}${this._suffix}</hbox>`);
  }
}

