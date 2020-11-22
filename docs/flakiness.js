import {html, svg} from './zhtml.js';
import {humanReadableDate, browserLogoURL, browserLogo, commitURL} from './misc.js';
import {SortButton, ExpandButton, FilterConjunctionGroup, Popover} from './widgets.js';

export async function fetchFlakiness() {
  // return fetch('https://folioflakinessdashboard.blob.core.windows.net/dashboards/main.json').then(r => r.json()).then(json => {
  return fetch('/flakiness_data.json').then(r => r.json()).then(json => {
    return json;
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
    this.element = html`<section class=flakiness></section>`;

    this._specIdToSpec = new Map();
    this._specIdToShaToSpecInfo = new Map();
    this._shaToDetails = new Map();
    this._allParameters = new Map();
    this._commitsToBeHealthy = 20;

    for (const run of data.buildbotRuns) {
      const sha = run.metadata.commitSHA;
      this._shaToDetails.set(run.metadata.commitSHA, {
        sha,
        timestamp: run.metadata.commitTimestamp,
        message: run.metadata.commitTitle,
        author: run.metadata.commitAuthorName,
        email: run.metadata.commitAuthorEmail,
      });
      for (const spec of run.specs) {
        const specId = spec.file + ' @@@ ' + spec.title;
        this._specIdToSpec.set(specId, {
          specId,
          file: spec.file,
          line: spec.line,
          title: spec.title,
        });
        let shaToShaInfo = this._specIdToShaToSpecInfo.get(specId);
        if (!shaToShaInfo) {
          shaToShaInfo = new Map();
          this._specIdToShaToSpecInfo.set(specId, shaToShaInfo);
        }
        let specInfo = shaToShaInfo.get(sha);
        if (!specInfo) {
          specInfo = {
            line: spec.line,
            column: spec.column,
            sha,
            url: run.metadata.runURL,
            tests: [],
          };
          shaToShaInfo.set(sha, specInfo);
        }
        for (const test of spec.tests) {
          // Overwrite test platform parameter with a more specific information from
          // build run.
          test.parameters.platform = run.metadata.osName + ' ' + run.metadata.osVersion;
          if (test.parameters.platform.toUpperCase().startsWith('MINGW'))
            test.parameters.platform = 'Windows';
          // Pull test URL.
          test.url = run.metadata.runURL;
          test.name = Object.entries(test.parameters).filter(([key, value]) => !!value).map(([key, value]) => {
            if (typeof value === 'string')
              return value;
            if (typeof value === 'boolean')
              return key;
            return `${key}=${value}`;
          }).join(' / ');
          for (const [name, value] of Object.entries(test.parameters)) {
            let values = this._allParameters.get(name);
            if (!values) {
              values = new Set();
              this._allParameters.set(name, values);
            }
            values.add(value);
          }
        }
        specInfo.tests.push(...spec.tests);
      }
    }

    // Cleanup parameters: if parameter has only one value, then we can ignore it.
    for (const [key, value] of this._allParameters) {
      if (value.size === 1)
        this._allParameters.delete(key);
    }
    this._filterGroup = new FilterConjunctionGroup(this._allParameters);
    this._filterGroup.events.onchange(() => this._render());

    this._render();
  }

  _applyFilterToTest(test) {
    const orGroups = this._filterGroup.state().map(andGroup => {
      for (const state of andGroup) {
        const isSatisfied = state.eq === 'equal' ? test.parameters[state.name] === state.value : test.parameters[state.name] !== state.value;
        if (!isSatisfied)
          return false;
      }
      return true;
    });
    return !orGroups.length || orGroups.some(Boolean);
  }

  _render() {
    const allSpecs = [...this._specIdToSpec.values()].sort((spec1, spec2) => {
      if (spec1.file !== spec2.file)
        return spec1.file < spec2.file ? -1 : 1;
      return spec1.line - spec2.line;
    });

    const specIdToCommitsInfo = new Map();
    for (const spec of allSpecs) {
      const commits = [...this._specIdToShaToSpecInfo.get(spec.specId).keys()].map(sha => this._shaToDetails.get(sha)).sort((c1, c2) => c1.timestamp - c2.timestamp).slice(-this._commitsToBeHealthy);
      const commitsInfo = [];
      for (const commit of commits) {
        const specInfo = this._specIdToShaToSpecInfo.get(spec.specId).get(commit.sha);
        const tests = specInfo.tests.filter(test => this._applyFilterToTest(test));
        const flakyTests = tests.filter(isFlakyTest);
        const failingTests = tests.filter(isFailingTest);
        const runsSummary = getTestsSummary(tests);
        // Sometimes there are no runs if test was skipped.
        // Consider it passed.
        if (!runsSummary.length)
          runsSummary.push('passed');
        const runResultToImgNameMap = {
          'passed': 'ok',
          'timedOut': 'timeout',
          'failed': 'fail',
        };
        const imgName = '/images/commit-' + runsSummary.map(result => runResultToImgNameMap[result]).sort().join('-') + '.svg';
        console.log(imgName);
        let className = 'good';
        if (failingTests.length)
          className = 'bad';
        else if (flakyTests.length)
          className = 'normal';
        commitsInfo.push({
          sha: commit.sha,
          message: commit.message,
          timestamp: commit.timestamp,
          flakyTests,
          failingTests,
          className,
          imgName,
        });
      }
      commitsInfo.reverse();
      specIdToCommitsInfo.set(spec.specId, commitsInfo);
    }

    const specIdToHealthSummary = new Map();
    const fileToSpecs = new Map();
    for (const spec of allSpecs) {
      const commitsInfo = specIdToCommitsInfo.get(spec.specId);
      const badCommits = commitsInfo.filter(info => info.flakyTests.length || info.failingTests.length);
      if (!badCommits.length)
        continue;
      specIdToHealthSummary.set(spec.specId, `${Math.round((1 - badCommits.length / commitsInfo.length) * 100)}%`);
      let specs = fileToSpecs.get(spec.file);
      if (!specs) {
        specs = [];
        fileToSpecs.set(spec.file, specs);
      }
      specs.push(spec);
    }

    const COLLAPSED_CHAR = '▶';
    const EXPANDED_CHAR = '▼';
    const RIGHT_ARROW = '⟶';

    this.element.textContent = '';
    this.element.append(html`
      <filter-column>${this._filterGroup}</filter-column>
      <table-row>
        <spec-column></spec-column>
        <health-column>Health</health-column>
        <results-column>Commits: Newer ${RIGHT_ARROW} Older
        </results-column>
      </table-row>
      ${[...fileToSpecs].map(([file, specs]) => html`
        <div class=specfile>${file}</div>
        ${specs.map(spec => html`
          <table-row>
            <spec-column>
              <div class=specname>${spec.line}: ${spec.title}</div>
            </spec-column>
            <health-column>
              <div class=healthstats onclick=${popover.onClickHandler(renderSpecInfo.bind(null, spec.specId))}>${specIdToHealthSummary.get(spec.specId)}</div>
            </health-column>
            <results-column>
            ${specIdToCommitsInfo.get(spec.specId).map(info => html`
                <img style="width: 18px; height: 18px; padding: 1px; box-sizing: content-box;" src="${info.imgName}"/>
            `)}
          </table-row>
        `)}
      `)}
    `);

    function renderSpecInfo(specId) {
      const tests = [];
      for (const info of specIdToCommitsInfo.get(specId))
        tests.push(...info.flakyTests, ...info.failingTests);
      return html`
        <section class=testruns>
          <h4>Unhappy Runs</h4>
          ${renderTests(tests)}
        </section>
      `;
    }

    function renderCommitInfo(specId, commitInfo) {
      return html`
        <section class=testruns>
          <div><a href="${commitURL('playwright', commitInfo.sha)}"><span class=sha>${commitInfo.sha.substring(0, 7)}</span></a>${commitInfo.message}</div>
          <h4>Unhappy Runs</h4>
          ${renderTests([...commitInfo.failingTests, ...commitInfo.flakyTests])}
        </section>
      `;
    }

    function renderTests(allTests) {
      allTests.sort((t1, t2) => {
        if (t1.name !== t2.name)
          return t1.name < t2.name ? -1 : 1;
        return 0;
      });

      return html`${allTests.map(test => renderOneTest(test))}`;
    }

    function renderOneTest(test) {
      let info = null;
      if (isFailingTest(test))
        info = html`<test-info class=fail>fail</test-info>`;
      else if (isFlakyTest(test))
        info = html`<test-info class=flaky>flaky</test-info>`;
      else
        info = html`<test-info class=none>n/a</test-info>`;
      return html`
        <div><a href="${test.url}">${info}</a> ${test.name}</div>
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

function isFailingTest(test) {
  return !test.runs.some(run => run.status === 'skipped' || run.status === test.expectedStatus);
}
