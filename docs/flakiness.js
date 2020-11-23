import {html, svg} from './zhtml.js';
import {humanReadableDate, browserLogoURL, browserLogo, commitURL, highlightANSIText} from './misc.js';
import {SortButton, ExpandButton, FilterConjunctionGroup, Popover} from './widgets.js';
import {Table} from './utils.js';

const MIDDLE_DOT = '·';

export async function fetchFlakiness() {
  return fetch('https://folioflakinessdashboard.blob.core.windows.net/dashboards/main.json').then(r => r.json()).then(json => {
  // return fetch('/flakiness_data.json').then(r => r.json()).then(json => {
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
    this._expandedSpecIds = new Set();
    this._specIdToOpenedStackId = new Map();

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

    this._allSpecs = [...this._specIdToSpec.values()].sort((spec1, spec2) => {
      if (spec1.file !== spec2.file)
        return spec1.file < spec2.file ? -1 : 1;
      return spec1.line - spec2.line;
    });

    // Cleanup parameters: if parameter has only one value, then we can ignore it.
    for (const [key, value] of this._allParameters) {
      if (value.size === 1)
        this._allParameters.delete(key);
    }

    this._commitsToBeHealthySelect = html`
      <div>
        Show Last <select oninput=${e => {
          this._commitsToBeHealthy = parseInt(e.target.value, 10);
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

  _specIdToCommitInfoRespectingGlobalFiltering() {
    // Build this map accounting for a global test filter.
    const specIdToCommitsInfo = new Map();
    for (const spec of this._allSpecs) {
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
    return specIdToCommitsInfo;
  }

  _render() {
    // Build this map accounting for a global test filter.
    const specIdToCommitsInfo = this._specIdToCommitInfoRespectingGlobalFiltering();
    // Get all specs that we will render.
    // Do not render specs without failing commits.
    const allSpecs = this._allSpecs.filter(spec => {
      const commitsInfo = specIdToCommitsInfo.get(spec.specId);
      const badCommits = commitsInfo.filter(info => info.flakyTests.length || info.failingTests.length);
      return badCommits.length;
    });

    const allTests = [];
    for (const spec of allSpecs) {
      const commitsInfo = specIdToCommitsInfo.get(spec.specId);
      for (const commitInfo of commitsInfo) {
        allTests.push(...commitInfo.flakyTests);
        allTests.push(...commitInfo.failingTests);
      }
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

    // Compute stack signatures.
    const specIdToStackIdToStackInfos = new Map();
    const stackIdToSpecIdToSha = new Map();
    for (const spec of allSpecs) {
      const stackIdToStackInfos = new Map();
      specIdToStackIdToStackInfos.set(spec.specId, stackIdToStackInfos);

      for (const commitInfo of specIdToCommitsInfo.get(spec.specId)) {
        for (const test of [...commitInfo.flakyTests, ...commitInfo.failingTests]) {
          for (const run of test.runs.filter(run => !!run.error)) {
            const stackId = createStackSignature(run.error.stack);
            let stackInfos = stackIdToStackInfos.get(stackId);
            if (!stackInfos) {
              stackInfos = [];
              stackIdToStackInfos.set(stackId, stackInfos);
            }
            stackInfos.push({
              commitInfo,
              test,
              run,
            });
            let specIdToSha = stackIdToSpecIdToSha.get(stackId);
            if (!specIdToSha) {
              specIdToSha = new Map();
              stackIdToSpecIdToSha.set(stackId, specIdToSha);
            }

            let shas = specIdToSha.get(spec.specId);
            if (!shas) {
              shas = new Set();
              specIdToSha.set(spec.specId, shas);
            }
            shas.add(commitInfo.sha);
          }
        }
      }
    }

    const COLLAPSED_CHAR = '▶';
    const EXPANDED_CHAR = '▼';
    const RIGHT_ARROW = '⟶';

    this.element.textContent = '';
    this.element.append(html`
      <div>${this._commitsToBeHealthySelect}</div>
      <div>${this._filterGroup}</div>
      ${this._renderSummary(allTests)}
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
            <spec-column class=specname>
              ${spec.line}: ${spec.title}
              ${[...specIdToStackIdToStackInfos.get(spec.specId)].map(([stackId, uniqueStackInfo], idx) => html`
                <span class=stack-toggle selected=${stackId === this._specIdToOpenedStackId.get(spec.specId)} onclick=${e => {
                  if (this._specIdToOpenedStackId.get(spec.specId) === stackId)
                    this._specIdToOpenedStackId.delete(spec.specId);
                  else
                    this._specIdToOpenedStackId.set(spec.specId, stackId);
                  this._render();
                }}>Stack ${specIdToStackIdToStackInfos.get(spec.specId).size > 1 ? idx + 1 : ''}</span>
              `)}
            </spec-column>
            <health-column>
              <div class=healthstats>${specIdToHealthSummary.get(spec.specId)}</div>
            </health-column>
            <results-column>
            ${specIdToCommitsInfo.get(spec.specId).map(info => html`
                <!--
                -->
                <img
                    onclick=${popover.onClickHandler(() => this._showCommitInfo(info.sha))}
                    x-commit-info
                    class="${stackIdToSpecIdToSha.get(this._specIdToOpenedStackId.get(spec.specId))?.get(spec.specId)?.has(info.sha) ? 'highlighted' : ''}"
                    src="${info.imgName}"/>
            `)}
          </table-row>
          ${this._specIdToOpenedStackId.has(spec.specId) && renderStack(spec.specId, this._specIdToOpenedStackId.get(spec.specId))}
        `)}
      `)}
    `);

    function renderStack(specId, stackId) {
      const infos = specIdToStackIdToStackInfos.get(specId).get(stackId);
      const terminal = html`<div class=terminal-content>${highlightANSIText(infos[0].run.error.stack)}</div>`;
      const select = html`
        <select oninput=${e => {
          terminal.textContent = '';
          terminal.append(highlightANSIText(e.target.selectedOptions[0].info.run.error.stack));
        }}>
          ${infos.map(info => html`
            <option onzrender=${e => e.info = info}>[ ${info.test.name} ] ${info.commitInfo.message}</option>
          `)}
        </select>
      `;
      return html`
        <div class=terminal>
          Stack Occurrence: ${select}
          <hr>
          ${terminal}
        </div>
      `;
    }

    function createStackSignature(stack) {
      // Sometimes stack traces are slightly different:
      // 1. They might contain GUID's that did not match
      // 2. They might contain numbers that did not match
      // We want to "dedupe" these stacktraces.
      return stack.split('\n')
          // we care about stack only, so get all the lines that start with 'at '
          .map(line => line.trim())
          .filter(line => line.startsWith('at '))
          .join('\n')
          // replace all numbers with '<NUM>'
          .replaceAll(/\b\d+\b/g, '<NUM>');
    }
  }

  _renderSummary(tests) {
    const browserToPlatformToTests = new Table(3);
    for (const test of tests) {
      const browserName = test.parameters.browserName;
      const platform = test.parameters.platform;
      browserToPlatformToTests.set(browserName, platform, test);
    }

    const platforms = [...this._allParameters.get('platform')].sort();
    const browsers = [...this._allParameters.get('browserName')].sort();

    const renderPlatformAndBrowserSummary = (browserName, platform) => {
      const tests = browserToPlatformToTests.get(browserName, platform);
      const count = new Map();
      for (const test of tests) {
        const x = count.get(test.name) || 0;
        count.set(test.name, x + 1);
      }
      const rows = [...count].sort((a, b) => b[1] - a[1]);
      return html`
        <div style="display: flex;">
          <div>
            ${rows.map(([name, num]) => html`<div>${name}</div>`)}
          </div>
          <div style="margin-left: 1em;">
            ${rows.map(([name, num]) => html`<div style="text-align: right">${num}</div>`)}
          </div>
        </div>
      `;
    };

    function renderCell(browserName, platform) {
      const count = browserToPlatformToTests.get(browserName, platform).length;
      if (count === 0)
        return html`<a-row>${MIDDLE_DOT}</a-row>`;
      return html`
        <a-row style="cursor: pointer" onclick=${popover.onClickHandler(renderPlatformAndBrowserSummary.bind(null, browserName, platform))}>${count}</a-row>
      `;
    }

    return html`
      <flakiness-summary>
        <a-column class=first-column>
          <a-row class=first-row>&nbsp;</a-row>
          ${[...platforms].map(platform => html`<a-row>${platform}</a-row>`)}
        </a-column>

        ${[...browsers].map(browserName => html`
          <a-column>
            <a-row class=first-row>${browserLogo(browserName, 18)}</a-row>
            ${[...platforms].map(platform => renderCell(browserName, platform))}
          </a-column>
        `)}
      </flakiness-summary>
    `;
  }

  _showCommitInfo(sha) {
    return html`
      <div>
        <a style="margin-right: 4px" class=sha href="${commitURL('playwright', sha)}" >${sha.substring(0, 7)}</a>${this._shaToDetails.get(sha).message}
      </div>
    `;
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
