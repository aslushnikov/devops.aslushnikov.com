import {html, svg} from './zhtml.js';
import {humanReadableDate, browserLogoURL, browserLogo, commitURL} from './misc.js';
import {SortButton, ExpandButton, Popover} from './widgets.js';

export async function fetchFlakiness() {
  return fetch('https://folioflakinessdashboard.blob.core.windows.net/dashboards/main.json').then(r => r.json()).then(json => {
    return json;
  });
}

const popover = new Popover(document);
document.documentElement.addEventListener('click', () => popover.hide(), false);

export function renderFlakiness(data) {
  console.log(data);

  const specIdToSpec = new Map();
  const specIdToShaToCellInfo = new Map();
  const shaToDetails = new Map();

  for (const run of data.buildbotRuns) {
    const sha = run.metadata.commitSHA;
    shaToDetails.set(run.metadata.commitSHA, {
      sha,
      timestamp: run.metadata.commitTimestamp,
    });
    for (const spec of run.specs) {
      const specId = spec.file + ' @@@ ' + spec.title;
      specIdToSpec.set(specId, {
        specId,
        file: spec.file,
        line: spec.line,
        title: spec.title,
      });
      let shaToCellInfo = specIdToShaToCellInfo.get(specId);
      if (!shaToCellInfo) {
        shaToCellInfo = new Map();
        specIdToShaToCellInfo.set(specId, shaToCellInfo);
      }
      let cellInfo = shaToCellInfo.get(sha);
      if (!cellInfo) {
        cellInfo = {
          line: spec.line,
          column: spec.column,
          sha,
          url: run.metadata.runURL,
          tests: [],
        };
        shaToCellInfo.set(sha, cellInfo);
      }
      for (const test of spec.tests) {
        // Overwrite test platform parameter with a more specific information from
        // build run.
        test.parameters.platform = run.metadata.osName + ' ' + run.metadata.osVersion;
        // Pull test URL.
        test.url = run.metadata.runURL;
        test.name = Object.entries(test.parameters).filter(([key, value]) => !!value).map(([key, value]) => {
          if (typeof value === 'string')
            return value;
          if (typeof value === 'boolean')
            return key;
          return `${key}=${value}`;
        }).join(' / ');
      }
      cellInfo.tests.push(...spec.tests);
    }
  }
  const allSpecs = [...specIdToSpec.values()].sort((spec1, spec2) => {
    if (spec1.file !== spec2.file)
      return spec1.file < spec2.file ? -1 : 1;
    return spec1.line - spec2.line;
  });

  const fileToSpecs = new Map();
  for (const spec of allSpecs) {
    let specs = fileToSpecs.get(spec.file);
    if (!specs) {
      specs = [];
      fileToSpecs.set(spec.file, specs);
    }
    specs.push(spec);
  }

  const specIdToHealthSummary = new Map();
  const specIdToCommitsInfo = new Map();
  for (const spec of allSpecs) {
    // 10 last commits that ran this spec.
    const commits = [...specIdToShaToCellInfo.get(spec.specId).keys()].map(sha => shaToDetails.get(sha)).sort((c1, c2) => c1.timestamp - c2.timestamp);// .slice(-20);
    const commitsInfo = [];
    for (const commit of commits) {
      const cellInfo = specIdToShaToCellInfo.get(spec.specId).get(commit.sha);
      const flakyTests = cellInfo.tests.filter(isFlakyTest);
      const failingTests = cellInfo.tests.filter(isFailingTest);
      let className = 'good';
      if (failingTests.length)
        className = 'bad';
      else if (flakyTests.length)
        className = 'normal';
      commitsInfo.push({
        sha: commit.sha,
        timestamp: commit.timestamp,
        flakyTests,
        failingTests,
        className,
      });
    }
    commitsInfo.reverse();
    specIdToCommitsInfo.set(spec.specId, commitsInfo);

    const badCommits = commitsInfo.filter(info => info.flakyTests.length || info.failingTests.length);
    specIdToHealthSummary.set(spec.specId, `${Math.round((1 - badCommits.length / commitsInfo.length) * 100)}%`);
  }

  function render() {
    const COLLAPSED_CHAR = '▶';
    const EXPANDED_CHAR = '▼';
    const RIGHT_ARROW = '⟶';

    return html`
      <section onclick=${() => popover.hide()} class=flakiness>
        <table-row>
          <spec-column></spec-column>
          <health-column>Health</health-column>
          <results-column>Commits: Newer ${RIGHT_ARROW} Older</results-column>
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
                  <commit-info onclick=${popover.onClickHandler(renderCommitInfo.bind(null, spec.specId, info))} class=${info.className}>${info.flakyTests.length + info.failingTests.length || ''}</commit-info>
              `)}
            </table-row>
          `)}
        `)}
      </section>
    `;
  }

  function renderSpecInfo(specId) {
    const tests = [];
    for (const info of specIdToCommitsInfo.get(specId))
      tests.push(...info.flakyTests, ...info.failingTests);
    return html`
      <section class=testruns>
        <div><b>file:</b> ${specIdToSpec.get(specId).file}</div>
        <div><b>name:</b> ${specIdToSpec.get(specId).title}</div>
        <h4>Unhappy Runs</h4>
        ${renderTests(tests)}
      </section>
    `;
  }

  function renderCommitInfo(specId, commitInfo) {
    return html`
      <section class=testruns>
        <div><b>file:</b> ${specIdToSpec.get(specId).file}</div>
        <div><b>name:</b> ${specIdToSpec.get(specId).title}</div>
        <div><b>commit:</b><a href="${commitURL('playwright', commitInfo.sha)}"><span class=sha>${commitInfo.sha.substring(0, 7)}</span></a></div>
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

  return render();
}

function isHealthyTest(test) {
  if (test.runs.length !== 1)
    return false;
  const run = test.runs[0];
  return !run.status || run.status === 'skipped' || run.status === 'passed';
}

function isFlakyTest(test) {
  if (test.runs.length === 1)
    return false;
  return test.runs.some(run => run.status === test.expectedStatus);
}

function isFailingTest(test) {
  return !test.runs.some(run => run.status === test.expectedStatus);
}
