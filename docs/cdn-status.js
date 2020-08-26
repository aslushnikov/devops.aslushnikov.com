import {html} from './zhtml.js';
import {humanReadableTimeInterval} from './misc.js';

const CHECKMARK_EMOJI = '✅';
const CROSS_EMOJI = '❌';

export async function fetchCDNStatus() {
  return fetch('https://raw.githubusercontent.com/aslushnikov/devops.aslushnikov.com/cdn-status-data/status.json').then(r => r.json()).then(json => {
    json.webkit.sort((a, b) => b.rev - a.rev);
    json.firefox.sort((a, b) => b.rev - a.rev);
    return json;
  });
}

export function renderWebkitCDNStatus(cdnData, preview = false) {
  return renderBrowserStatus('WebKit', '/wk.svg', cdnData.webkit, cdnData.timestamp, preview);
}

export function renderFirefoxCDNStatus(cdnData, preview = false) {
  return renderBrowserStatus('Firefox', '/ff.svg', cdnData.firefox, cdnData.timestamp, preview);
}

function badge() {
  return html`
    <a href='https://github.com/aslushnikov/devops.aslushnikov.com/blob/master/.github/workflows/cdn-status.yml'>
      <img title="cronjob status (green is good, red - broken!)" src='https://github.com/aslushnikov/devops.aslushnikov.com/workflows/update%20CDN%20status/badge.svg'>
    </a>
  `;
}

function renderBrowserStatus(browserName, logoUrl, infos, updateTimestamp, preview) {
  let footer, header;

  if (preview) {
    const RECENT_RUNS = 5;
    infos = infos.slice(0, RECENT_RUNS);
    footer = html`
      <footer>
        <div>
          Showing ${RECENT_RUNS} most recent builds. <a href="/full-${browserName.toLowerCase()}-cdn-status.html">See all</a>
        </div>
        ${badge()}
      </footer>
    `;
    header = html`
      <header>
        <div>
          <h2>${browserName} CDN status</h2>
          <div>(updated ${humanReadableTimeInterval(Date.now() - updateTimestamp)} ago)</div>
        </div>
        <img width=30px height=30px src="${logoUrl}">
      </header>
    `;

  } else {
    footer = html`
      <footer>
        ${badge()}
      </footer>
    `;
    header = html`
      <header>
        <div>
          <h2>${browserName} CDN status</h2>
          <div>(updated ${humanReadableTimeInterval(Date.now() - updateTimestamp)} ago)</div>
        </div>
        ${badge()}
      </header>
    `;
  }
  return html`
    <cdn-status>
      ${header}
      <section class=grid>
        <div class="cell header"></div>
        <div class="cell header">Linux</div>
        <div class="cell header">Mac</div>
        <div class="cell header">Win</div>
        ${infos.map(info => html`
          <div class="cell revision">r${info.rev}</div>
          <div class="cell">${renderLinuxURLs(info.urls)}</div>
          <div class="cell">${renderMacURLs(info.urls)}</div>
          <div class="cell">${renderWinURLs(info.urls)}</div>
        `)}
      </section>
      ${footer}
    </cdn-status>
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
