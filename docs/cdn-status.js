import {html} from './zhtml.js';
import {humanReadableTimeInterval} from './misc.js';

const CHECKMARK_EMOJI = '✅';
const CROSS_EMOJI = '❌';

export function renderWebkitCDNStatus(cdnData, rows = Infinity) {
  return renderBrowserStatus('WebKit', '/wk.svg', cdnData.webkit.slice(0, rows), cdnData.timestamp);
}

export function renderFirefoxCDNStatus(cdnData, rows = Infinity) {
  return renderBrowserStatus('Firefox', '/ff.svg', cdnData.firefox.slice(0, rows), cdnData.timestamp);
}

function renderBrowserStatus(browserName, logoUrl, infos, updateTimestamp) {
          // <span class=title>${browserName} CDN status</span><span> (updated ${humanReadableTimeInterval(Date.now() - updateTimestamp)} ago)</span>
  return html`
    <cdn-status class=tile>
      <tile-header>
        <div>
          <h2>${browserName} CDN status</h2>
          <div>(updated ${humanReadableTimeInterval(Date.now() - updateTimestamp)} ago)</div>
        </div>
        <img width=30px height=30px src="${logoUrl}">
      </tile-header>
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
