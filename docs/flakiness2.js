import {html, svg} from './zhtml.js';
import {humanReadableDate, browserLogoURL, browserLogo, commitURL, highlightANSIText} from './misc.js';
import {SortButton, ExpandButton, FilterConjunctionGroup, Popover} from './widgets.js';
import {SMap} from './smap.js';

const MIDDLE_DOT = '·';

export async function fetchFlakiness() {
  // return fetch('https://folioflakinessdashboard.blob.core.windows.net/dashboards/main_v2.json').then(r => r.json()).then(json => {
  return fetch('/main_v2_filtered.json').then(r => r.json()).then(data => {
    //TODO: default data should filter out tests that are SKIP-only.
    // Since we don't do it up there, we filter it on our side.
    for (const spec of data.specs) {
      // Filter out tests that were skipped.
      spec.problematicTests = spec.problematicTests.filter(({sha, test}) => test.annotations.length !== 1 || test.annotations[0].type !== 'skip');
      // Filter out tests that have a single run with status - these didn't run because they were sharded away.
      spec.problematicTests = spec.problematicTests.filter(({sha, test}) => test.runs.length !== 1 || !!test.runs[0].status);
    }
    data.specs = data.specs.filter(spec => spec.problematicTests.length);
    return data;
  });
}

const popover = new Popover(document);
document.documentElement.addEventListener('click', () => popover.hide(), false);

export function renderFlakiness(data) {
  const dashboard = new FlakinessDashboard(data);
  return dashboard.element;
}

class FlakinessDashboard {
  constructor(data) {
    console.time('Parsing data');
    // All commits are sorted from newest to oldest.
    this._commits = new SMap(data.commits.map(({author, email, message, sha, timestamp}) => ({
      author,
      email,
      message,
      sha,
      //TODO: convert timestamp to number upstream.
      timestamp: +timestamp,
    })).sort((c1, c2) => c2.timestamp - c1.timestamp));

    // All specs are sorted by filename/line/column location.
    this._specs = new SMap(data.specs.map(({file, specId, title, commitCoordinates}) => {
      commitCoordinates = commitCoordinates.map(({line, column, sha}) => ({
        line,
        column,
        sha,
        timestamp: this._commits.get({sha}).timestamp,
      }));
      const lastCoordinate = commitCoordinates.reduce((last, coord) => last.timestamp < coord.timestamp ? coord : last);
      return {
        specId,
        file,
        title,
        lastCoordinate,
        commitCoordinates: new SMap(commitCoordinates),
      };
    }).sort((s1, s2) => {
      if (s1.file !== s2.file)
        return s1.file < s2.file ? -1 : 1;
      return s1.lastCoordinate.line - s2.lastCoordinate.line || s1.lastCoordinate.column - s2.lastCoordinate.column;
    }));

    let tests = [];
    for (const {specId, problematicTests} of data.specs) {
      for (const {sha, test} of problematicTests) {
        tests.push({
          sha,
          commit: this._commits.get({sha}),
          specId,
          spec: this._specs.get({specId}),
          browserName: test.parameters.browserName,
          platform: test.parameters.platform,
          test,
        });
      }
    }
    this._tests = new SMap(tests);

    console.timeEnd('Parsing data');
    console.log(`commits: ${this._commits.size}`);
    console.log(`specs: ${this._specs.size}`);
    console.log(`tests: ${this._tests.size}`);

    this.element = html`<section class=flakiness></section>`;

    this._lastCommits = 10;
    this._lastCommitsSelect = html`
      <div>
        Show Last <select oninput=${e => {
          this._lastCommits = parseInt(e.target.value, 10);
          this._render();
        }}>
          ${[...Array(8)].map((_, index) => html`
            <option>${index + 2}</option>
          `)}
          <option>10</option>
          <option>15</option>
          <option selected>20</option>
          <option>30</option>
          <option>50</option>
        </select> Commits
      </div>
    `;
    /*
    this._filterGroup = new FilterConjunctionGroup(this._allParameters);
    this._filterGroup.events.onchange(() => this._render());
    */

    this._render();
  }


  _render() {
    console.time('filtering');

    const commits = new SMap(this._commits.slice(0, this._lastCommits));
    const tests = new SMap(this._tests.filter(test => commits.has({sha: test.sha})));
    const specs = new SMap(this._specs.filter(spec => tests.has({specId: spec.specId})));

    const filenames = [...new Set(specs.map(spec => spec.file))];

    console.timeEnd('filtering');
    this.element.textContent = '';
    this.element.append(html`
      ${this._lastCommitsSelect}
      ${filenames.map(filename => html`
        <div>${filename}</div>
        ${specs.getAll({file: filename}).map(spec => html`
          <div style="margin-left:1em;">${spec.title}:${spec.lastCoordinate.line}</div>
          <hbox>
          </hbox>
        `)}
      `)}
    `);

    function renderSpecCommit(specId, sha) {
      for (const test of tests.getAll({specId, sha})) {
        
      }
      return svg`
        <svg width="12px" height="12px"
      `;
    }
  }
}

function isHealthyTest(test) {
  if (test.runs.length !== 1)
    return false;
  const run = test.runs[0];
  return !run.status || run.status === 'skipped' || run.status === 'passed';
}

function getTestsSummary(tests) {
  const allRuns = [];
  for (const test of tests)
    allRuns.push(...test.runs);
  const runs = allRuns.filter(run => run.status && run.status !== 'skipped');
  return [...new Set(runs.map(run => run.status))];
}

function isFlakyTest(test) {
  if (test.runs.length === 1)
    return false;
  return test.runs.some(run => run.status === test.expectedStatus);
}

function getTestName(test) {
  return Object.entries(test.parameters).filter(([key, value]) => !!value).map(([key, value]) => {
    if (typeof value === 'string')
      return value;
    if (typeof value === 'boolean')
      return key;
    return `${key}=${value}`;
  }).join(' / ');
}

function isFailingTest(test) {
  return !test.runs.some(run => run.status === 'skipped' || run.status === test.expectedStatus);
}
