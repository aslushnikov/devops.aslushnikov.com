import {html} from './zhtml.js';
import {humanReadableTimeInterval, browserLogo, commitURL} from './misc.js';

const DATA_URLS = {
  firefox: 'https://raw.githubusercontent.com/aslushnikov/devops.aslushnikov.com/datastore--autoroll-firefox/rolls.json',
  webkit: 'https://raw.githubusercontent.com/aslushnikov/devops.aslushnikov.com/datastore--autoroll-webkit/rolls.json',
  chromium: 'https://raw.githubusercontent.com/aslushnikov/devops.aslushnikov.com/datastore--autoroll-chromium/rolls.json',
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

function renderUpstreamCommit(browserName, roll) {
  let sha, shortSHA, cls;
  // All but chromium have upstream commit, whereas chromium has `chromiumRevision`.
  if (roll.upstreamCommit) {
    sha = roll.upstreamCommit.sha;
    shortSHA = sha.substring(0, 7);
    cls = 'sha';
  } else {
    sha = roll.chromiumRevision;
    shortSHA = 'r' + sha;
    cls = '';
  }
  return html`
    <span class=commit>
      ${browserName}:
      <a class=${cls} href="${commitURL(browserName, sha)}">${shortSHA}</a>
    </span>
  `;
}

export function renderAutorollDataPreview({firefox, webkit, chromium}) {
  const rows = [
    {name: 'Chromium', roll: chromium.rolls[0]},
    {name: 'Firefox', roll: firefox.rolls[0]},
    {name: 'WebKit', roll: webkit.rolls[0]},
  ];
  return html`
    <section class=autoroll-data>
      <hbox class=header>
        <h2>Autoroll</h2>
        <spacer></spacer>
        <div>(attempted daily at 4AM PST)</div>
      </hbox>
      <section>
        ${rows.map(({name, roll}) => html`
          <hbox class=row>
            <a href="${roll.runURL}">${renderDate(roll.timestamp)}</a>
            ${renderUpstreamCommit(name, roll)}
            <span class=commit>
              Playwright:
              <a class=sha href="${commitURL('playwright', roll.playwrightCommit.sha)}">${roll.playwrightCommit.sha.substring(0, 7)}</a>
            </span>
            <spacer></spacer>
            ${renderSteps(roll)}
          </hbox>
        `)}
      </section>
      <footer>
        Full log: ${rows.map(({name}) => html`
          <a class="" href="/autoroll-${name.toLowerCase()}.html">[${name}] </a>
        `)}
      </footer>
    </section>
  `;
}

export function renderAutorollDataFull(autorollData) {
  const browserName = autorollData.browserName;
  let data = autorollData.rolls;
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
            ${renderUpstreamCommit(browserName, d)}
            <spacer></spacer>
            ${renderSteps(d)}
          </hbox>
        `)}
      </section>
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
    'N/A': 'neutral',
    'ok': 'good',
    'fail': 'bad',
  };
  return html`
    <hbox>
      ${d.steps.rebase && html`
        <a href="${d.runURL}" class="step ${statusToClass[d.steps.rebase]}">rebase</a>
      `}
      ${d.steps.find_revision && html`
        <a href="${d.runURL}" class="step ${statusToClass[d.steps.find_revision]}">findrev</a>
      `}
      <a href="${d.runURL}" class="step ${statusToClass[d.steps.build]}">build</a>
      <a href="${d.runURL}" class="step ${statusToClass[d.steps.test]}">test</a>
    </hbox>
  `;
}
