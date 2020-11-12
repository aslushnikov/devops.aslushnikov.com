import {html, svg} from './zhtml.js';
import {humanReadableDate, browserLogoURL, browserLogo, commitURL} from './misc.js';
import {SortButton, ExpandButton, Popover} from './widgets.js';
import {parse} from './stack-trace.js';

export async function fetchFlakiness() {
  return fetch('https://folioflakinessdashboard.blob.core.windows.net/dashboards/main.json').then(r => r.json()).then(json => {
    console.log(json.buildbotRuns.flatMap(m => m.specs).filter(e => !e.ok));
    return json;
  });
}

const popover = new Popover(document);
document.documentElement.addEventListener('click', () => popover.hide(), false);

export function renderFlakiness(data) {
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
            <details>
            <summary>
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
            </summary>
            ${lazyRender(() => renderSpecErrors(spec))}
            </details>
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
      <div>
        <a href="${test.url}">${info} <test-name>${test.name}</test-name></a>
        ${test.runs.map(run => renderRunError(run, test))}
      </div>
    `;
  }

  function renderRunError(run, test) {
    const {error, status} = run;
    console.log(run, test);
    if (status === 'passed')
      return html``;
    if (!error)
      return html`<div>${status}</div>`;
    
    const message = error.stack || error.message || JSON.stringify(error);
    const lines = String(message).split('\n');
    if (lines.length === 1)
      return html`<pre>${lines[0]}</pre>`;
    return html`
    <details>
      <summary>${lines[0]}</summary>
      ${lines.slice(1).join('\n')}
    </details>
    `;
  }

  function renderSpecErrors(spec) {
    const infos = specIdToCommitsInfo.get(spec.specId);
    const tests = infos.flatMap(info => [...info.flakyTests, ...info.failingTests]);
    const runs = tests.flatMap(test => test.runs);
    const errors = new Set();
    for (const run of runs) {
      if (!run.status || run.status === 'skipped' || run.status === 'passed')
        continue;
      if (run.error)
        errors.add(JSON.stringify(run.error));
      else
        errors.add(JSON.stringify(run.status));
    }
    return html`
    <error-description>
      ${[...errors].map(errorString => renderError(JSON.parse(errorString), spec.file))}
    </error-description>`;
  }

  function renderError(error, file) {
    if (typeof error === 'string')
      return html`${error}`;
    if (!error.message)
      return html`<pre>${JSON.stringify(error, undefined, 2)}</pre>`;
    if (!error.stack)
      return html`<pre>${highlightTerminalText(error.message)}</pre>`;
    const tokens = [];
    const messageLocation = error.stack.indexOf(error.message);
    const preamble = error.stack.substring(0, messageLocation + error.message.length);
    tokens.push(preamble);
    const callsite = file ? callsiteInFile(error, file) : null;
    if (callsite)
      console.log(callsite);
    return html`
  <pre>${highlightTerminalText(preamble)}</pre>
  ${lazyRender(async () => {
    if (!callsite || !callsite.fileName)
      return html``;
    const [CodeMirror, contents] = await Promise.all([
      getCodeMirror(),
      getFile(callsite.fileName),
    ]);
    const host = document.createElement('div');
    host.style.overflow = 'hidden';
    const cm = CodeMirror(host, {
      mode:  "javascript",
      value: contents,
      lineNumbers: true
    });
    cm.markText({
        line: callsite.lineNumber - 1,
        ch: 0,
      }, {
        line: callsite.lineNumber - 1,
        ch: callsite.columnNumber - 1,
      }, {
        className: 'error'
      }
    );
    setTimeout(() => {
      const coords = cm.charCoords({
        line: callsite.lineNumber,
        ch: callsite.columnNumber,
      }, 'local');
      cm.refresh();
      cm.scrollTo(coords.left - 460, (coords.top + coords.bottom)/2 - 58 - 4 );  
    }, 0);
    return host;
  }, html`<codemirror-placeholder></codemirror-placeholder>`)}
<pre>${highlightTerminalText(error.stack.substring(preamble.length + (error.stack[preamble.length] === '\n' ? 1 : 0)))}</pre>`;
  }

  return render();
}

async function getFile(file) {
  // TODO remove playwright-specific stuff here
  const bases = [
    `/home/runner/work/playwright/playwright/`,
    `/Users/runner/work/playwright/playwright/`,
    // TODO windows base
  ];
  const base = bases.find(base => file.startsWith(base));
  if (!base)
    return '';
  // TODO: replace master with commit hash from one of the runs
  const response = await fetch(`https://raw.githubusercontent.com/microsoft/playwright/master/${file.substring(base.length)}`)
  return await response.text();
}
function callsiteInFile(error, file) {
  for (const callsite of parse(error)) {
    if (callsite.fileName && callsite.fileName.endsWith(file))
      return callsite;
  }
  return null; 
}

/**
 * 
 * @param {string} text 
 */
function highlightTerminalText(text) {
  if (!text.includes('\u001b'))
    return html`${text}`;
  let color = null;
  return html`${text.split('\u001b').map((segment, index) => {
    if (index !== 0) {
      const matches = /^[[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]/.exec(segment);
      if (matches && matches.length) {
        const match = matches[0];
        segment = segment.slice(match.length);
        const COLORS = {
          '[30m': 'black',
          '[31m': 'red',
          '[32m': 'green',
          '[33m': 'yellow',
          '[34m': 'blue',
          '[35m': 'magenta',
          '[36m': 'cyan',
          '[37m': '#999',
        };
        if (match in COLORS)
          color = COLORS[match];
        else
          color = null;
      }
    }
    if (!color)
      return html`${segment}`;
    return html`<span style="color:${color}">${segment}</span>`;
  })}`;
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
  return !test.runs.some(run => run.status === 'skipped' || run.status === test.expectedStatus);
}

function lazyRender(render, placeholder = document.createElement('div')) {
  const observer = new IntersectionObserver(async events => {
    if (!events.some(x => x.isIntersecting))
      return;
    observer.disconnect();
    placeholder.replaceWith(await render());
  });
  observer.observe(placeholder);
  return placeholder;
}

async function getCodeMirror() {
  if (window.CodeMirror)
    return CodeMirror;
  await import('./codemirror/codemirror.js');
  await import('./codemirror/javascript.js');
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = './codemirror/codemirror.css';
  document.head.appendChild(link);
  return CodeMirror;
}