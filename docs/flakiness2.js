import {html, svg} from './zhtml.js';
import {humanReadableDate, browserLogoURL, browserLogo, commitURL, highlightANSIText} from './misc.js';
import {SortButton, ExpandButton, FilterConjunctionGroup, Popover} from './widgets.js';
import {SMap} from './smap.js';

const MIDDLE_DOT = '·';

const COLOR_YELLOW = '#ffcc80';
const COLOR_GREEN = '#a5d6a7';
const COLOR_RED = '#ef9a9a';
const COLOR_VIOLET = '#ce93d8';
const COLOR_GREY = '#eeeeee';

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
        commit: this._commits.get({sha}),
      }));
      const lastCoordinate = commitCoordinates.reduce((last, coord) => last.commit.timestamp < coord.commit.timestamp ? coord : last);
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
          name: getTestName(test),
          browserName: test.parameters.browserName,
          platform: test.parameters.platform,
          parameters: test.parameters,
          annotations: test.annotations,
          runs: test.runs,
          expectedStatus: test.expectedStatus,
          category: getTestCategory(test),
        });
      }
    }
    this._tests = new SMap(tests);

    console.timeEnd('Parsing data');
    console.log(`commits: ${this._commits.size}`);
    console.log(`specs: ${this._specs.size}`);
    console.log(`tests: ${this._tests.size}`);

    this.element = html`<section class=flakiness></section>`;

    this._lastCommits = 20;
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

    const filenames = specs.uniqueValues('file');
    console.timeEnd('filtering');

    console.time('rendering');
    this.element.textContent = '';
    this.element.append(html`
      ${this._lastCommitsSelect}
      ${filenames.map(filename => html`
        <div>${filename}</div>
        ${specs.getAll({file: filename}).map(spec => html`
          <hbox style="margin-left:1em;">
            ${renderSpecTitle(spec)}
            ${renderSpecAnnotations(spec)}
            ${commits.map(commit => renderSpecCommit(spec, commit))}
          </hbox>
        `)}
      `)}
    `);
    console.timeEnd('rendering');

    function renderSpecTitle(spec) {
      return html`
        <div style="
          width: 400px;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        ">${spec.lastCoordinate.line}:${spec.title}</div>
      `;
    }

    function renderSpecAnnotations(spec) {
      const annotations = tests.getAll({specId: spec.specId}).map(test => test.annotations).flat();
      const types = new SMap(annotations).uniqueValues('type').sort();
      return html`
        <div style="
          width: 120px;
        ">
          ${types.map(renderAnnotation)}
        </div>
      `;
    }

    function renderAnnotation(annotationType) {
      const bgcolors = {
        'slow': 'grey',
        'flaky': COLOR_VIOLET,
        'fail': COLOR_RED,
        'fixme': 'black',
        'skip': COLOR_YELLOW,
      };
      const colors = {
        'skip': 'black',
        'fail': 'black',
      };
      return html`
        <span style="
            background-color: ${bgcolors[annotationType] || 'blue'};
            color: ${colors[annotationType] || 'white'};
            display: inline-flex;
            align-items: center;
            justify-content: center;
            border-radius: 2px;
            font-size: 8px;
            margin: 0 2px;
            width: 5ch;
            box-sizing: content-box;
            text-align: center;
            flex: none;
          ">${annotationType}</span>
      `;
    }

    function renderSpecCommit(spec, commit) {
      const categories = new Set(tests.getAll({specId: spec.specId, sha: commit.sha}).map(test => test.category));
      let color = COLOR_GREY;
      if (categories.has('bad'))
        color = COLOR_RED;
      else if (categories.has('flaky'))
        color = COLOR_VIOLET;
      else if (categories.size || spec.commitCoordinates.has({sha: commit.sha}))
        color = COLOR_GREEN;

      return svg`
        <svg style="margin: 1px; " width="14px" height="14px" viewbox="0 0 14 14">
          <rect x=0 y=0 width=14 height=14 fill="${color}"/>
        </svg>
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
  if (!test.annotations.some(annotation => annotation.type === 'flaky'))
    return false;
  return test.runs.some(run => run.status === test.expectedStatus);
}

function getTestCategory(test) {
  const hasGoodRun = test.runs.some(run => run.status === test.expectedStatus);
  const hasBadRun = test.runs.some(run => run.status !== test.expectedStatus);
  const hasFlakyAnnotation = test.annotations.some(annotation => annotation.type === 'flaky');
  if (hasFlakyAnnotation && hasGoodRun && hasBadRun)
    return 'flaky';
  if (hasBadRun)
    return 'bad';
  return 'good';
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

