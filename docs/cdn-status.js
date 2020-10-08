import {html} from './zhtml.js';
import {humanReadableTimeInterval, browserLogo} from './misc.js';

const CHECKMARK_EMOJI = '✅';
const CROSS_EMOJI = '❌';

export async function fetchCDNStatus() {
  return fetch('https://raw.githubusercontent.com/aslushnikov/devops.aslushnikov.com/datastore--cdn-status/status.json').then(r => r.json()).then(json => {
    json.webkit.sort((a, b) => b.rev - a.rev);
    json.firefox.sort((a, b) => b.rev - a.rev);
    json.chromium.sort((a, b) => b.rev - a.rev);
    json.winldd.sort((a, b) => b.rev - a.rev);
    json.ffmpeg.sort((a, b) => b.rev - a.rev);
    return json;
  });
}

export function renderCDNStatusPreview(cdnData) {
  const rows = [
    { name: 'Webkit', info: cdnData.webkit[0], },
    { name: 'Firefox', info: cdnData.firefox[0], },
    { name: 'Chromium', info: cdnData.chromium[0], },
    { name: 'FFMPEG', info: cdnData.ffmpeg[0], },
    { name: 'winldd', info: cdnData.winldd[0], },
  ];
  return html`
    <section class=cdn-status>
      <hbox class=header>
        <div>
          <h2>CDN status</h2>
          <div>(updated ${humanReadableTimeInterval(Date.now() - cdnData.timestamp)} ago)</div>
        </div>
        <spacer></spacer>
      </hbox>
      <section class=grid>
        <vbox class="cell header"></vbox>
        <vbox class="cell header">Linux</vbox>
        <vbox class="cell header">Mac</vbox>
        <vbox class="cell header">Win</vbox>
        ${rows.map(({name, info}) => html`
          <hbox class="cell revision">
            ${name} r${info.rev}
          </hbox>
          <vbox class="cell">${renderLinuxURLs(info.urls)}</vbox>
          <vbox class="cell">${renderMacURLs(info.urls)}</vbox>
          <vbox class="cell">${renderWinURLs(info.urls)}</vbox>
        `)}
      </section>
      <footer>
        Full CDN status: ${rows.map(({name}) => html`
          <a class="" href="/cdn-status-${name.toLowerCase()}.html">[${name}] </a>
        `)}
      </footer>
    </section>
  `;
}

export function renderCDNStatusFull(cdnData, appName) {
  const infos = cdnData[appName.toLowerCase()];
  return html`
    <section class=cdn-status>
      <hbox class=header>
        <div>
          <h2>${appName} CDN status</h2>
          <div>(updated ${humanReadableTimeInterval(Date.now() - cdnData.timestamp)} ago)</div>
        </div>
        <spacer></spacer>
      </hbox>
      <section class=grid>
        <vbox class="cell header"></vbox>
        <vbox class="cell header">Linux</vbox>
        <vbox class="cell header">Mac</vbox>
        <vbox class="cell header">Win</vbox>
        ${infos.map(info => html`
          <vbox class="cell revision">r${info.rev}</vbox>
          <vbox class="cell">${renderLinuxURLs(info.urls)}</vbox>
          <vbox class="cell">${renderMacURLs(info.urls)}</vbox>
          <vbox class="cell">${renderWinURLs(info.urls)}</vbox>
        `)}
      </section>
    </section>
  `;
}

function renderLinuxURLs(urls) {
  return urls.filter(url => url.includes('-ubuntu') || url.includes('-linux') || url.includes('-wpe') || url.includes('-gtk')).map(renderURL);
}

function renderMacURLs(urls) {
  return urls.filter(url => url.includes('-mac')).map(renderURL);
}

function renderWinURLs(urls) {
  return urls.filter(url => url.includes('-win')).map(renderURL);
}

function renderURL(url) {
  const name = url.split('/').pop();
  const isBad = url.endsWith('.log.gz'); // logs are only uploaded for failed builds.
  return html`<div>${isBad ? CROSS_EMOJI : CHECKMARK_EMOJI} <a class=${isBad ? 'failed' : ''} href="${url}">${name}</a></div>`;
}
