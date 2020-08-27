import {html} from './zhtml.js';
import {humanReadableTimeInterval, browserLogo} from './misc.js';

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
  return renderBrowserStatus('WebKit', cdnData.webkit, cdnData.timestamp, preview);
}

export function renderFirefoxCDNStatus(cdnData, preview = false) {
  return renderBrowserStatus('Firefox', cdnData.firefox, cdnData.timestamp, preview);
}

function renderBrowserStatus(browserName, infos, updateTimestamp, preview) {
  const RECENT_RUNS = 3;
  if (preview)
    infos = infos.slice(0, RECENT_RUNS);

  return html`
    <section class=cdn-status>
      <hbox class=header>
        <div>
          <h2>${browserName} CDN status</h2>
          <div>(updated ${humanReadableTimeInterval(Date.now() - updateTimestamp)} ago)</div>
        </div>
        <spacer></spacer>
        ${preview && browserLogo(browserName)}
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
      ${preview && html`
        <footer>
          Showing ${RECENT_RUNS} most recent builds. <a href="/full-${browserName.toLowerCase()}-cdn-status.html">See all</a>
        </footer>
      `}
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
