import {html} from './zhtml.js';
import {humanReadableTimeInterval, browserLogo, commitURL} from './misc.js';

const DATA_URLS = {
  firefox: 'https://raw.githubusercontent.com/aslushnikov/devops.aslushnikov.com/autoroll-firefox-data/rolls.json',
  webkit: 'https://raw.githubusercontent.com/aslushnikov/devops.aslushnikov.com/autoroll-webkit-data/rolls.json',
};

export async function fetchAutorollData(browserName) {
  return fetch(DATA_URLS[browserName.toLowerCase()]).then(r => r.json()).then(json => {
    json.sort((a, b) => b.timestamp - a.timestamp);
    return {
      browserName,
      rolls: json,
    };
  });
}

export function renderAutorollData(autorollData, preview = false) {
  const browserName = autorollData.browserName;
  let data = autorollData.rolls;
  let footer;
  if (preview) {
    const RECENT_RUNS = 5;
    data = data.slice(0, RECENT_RUNS);
    footer = html`
      <footer>
        Showing last ${RECENT_RUNS} rolls. <a href=#>See all</a>
      </footer>
    `;
  }
  console.log(data);
  return html`
    <section class=autoroll-data>
      <hbox class=header>
        <div>
          <h2>Autoroll ${browserName}</h2>
          <div>(attempted daily at 4AM PST)</div>
        </div>
        <spacer></spacer>
      ${browserLogo(browserName)}
      </hbox>
      <section>
        ${data.map(d => html`
          <hbox class=row>
            <a href="${d.runURL}">
              ${renderDate(d.timestamp)}
            </a>
            <span class=commit>
              Playwright:
              <a class=sha href="${commitURL('playwright', d.playwrightCommit.sha)}">${d.playwrightCommit.sha.substring(0, 7)}</a>
            </span>
            <span class=commit>
              ${browserName}:
              <a class=sha href="${commitURL(browserName, d.upstreamCommit.sha)}">${d.upstreamCommit.sha.substring(0, 7)}</a>
            </span>
            <spacer></spacer>
            ${renderSteps(d)}
          </hbox>
        `)}
      </section>
      ${footer}
    </section>
  `;
}

function renderDate(timestamp) {
  const date = new Date(timestamp);
  return html`
    <span class=date>(${date.toLocaleString('default', {month: 'short'}) + ', ' + date.getDate()})</span>
  `;
}

function renderSteps(d) {
  const statusToClass = {
    'N/A': 'not-available',
    'ok': 'success',
    'fail': 'fail',
  };
  return html`
    <hbox>
      <span class="step ${statusToClass[d.steps.rebase]}">rebase</span>
      <span class="step ${statusToClass[d.steps.build]}">build</span>
      <span class="step ${statusToClass[d.steps.test]}">test</span>
    </hbox>
  `;
}
