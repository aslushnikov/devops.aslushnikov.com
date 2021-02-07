import {html, svg} from './zhtml.js';
import {humanReadableDate, browserLogoURL, browserLogo, commitURL, highlightANSIText} from './misc.js';
import {CriticalSection, consumeDOMEvent} from './utils.js';
import {SortButton, ExpandButton, FilterConjunctionGroup, Popover} from './widgets.js';
import {SMap} from './smap.js';
import {split} from './split.js';
import {rateLimitedFetch, fetchProgress} from './fetch-extras.js';
import {highlightText, preloadHighlighter} from './codehighlight.js';
import {URLState, newURL, amendURL} from './urlstate.js';
import {humanId} from './humanid.js';

const CHAR_MIDDLE_DOT = '·';
const CHAR_BULLSEYE = '◎';
const CHAR_WARNING = '⚠';
const CHAR_CROSS = '✖';
const CHAR_INFINITY = '∞';

const COMMIT_RECT_SIZE = 16;

const COLOR_SELECTION = '#fff9c4';
const COLOR_YELLOW = '#ffcc80';
const COLOR_GREEN = '#a5d6a7';
const COLOR_RED = '#ef9a9a';
const COLOR_VIOLET = '#ce93d8';
const COLOR_GREY = '#eeeeee';

const STYLE_FILL = 'position: absolute; left: 0; top: 0; right: 0; bottom: 0;';
const STYLE_TEXT_OVERFLOW = `white-space: nowrap; overflow: hidden; text-overflow: ellipsis;`;

const testRunColors = {
  'passed': COLOR_GREEN,
  'failed': COLOR_RED,
  'timedOut': COLOR_YELLOW,
  'skipped': COLOR_GREY,
};

const popover = new Popover(document);
document.documentElement.addEventListener('click', () => popover.hide(), false);

const urlState = new URLState();

window.addEventListener('DOMContentLoaded', async () => {
  const criticalSection = new CriticalSection();
  let dashboard = null;

  urlState.startListening(() => criticalSection.run('nav', async () => {
    const state = urlState.state();

    const useMockData = StringToBool(state.mockdata || 'false');
    if (!dashboard || useMockData !== dashboard.mockData()) {
      document.body.textContent = '';
      dashboard = await DashboardData.create(useMockData);
      document.body.append(dashboard.element);
    }

    const showFlaky = StringToBool(state.show_flaky || 'true');
    dashboard.setShowFlaky(showFlaky);

    const commits = parseInt(state.commits || '20', 10);
    dashboard.setLastCommits(commits);
    dashboard.setBrowserFilter(state.browser === 'any' ? undefined : state.browser);
    dashboard.setPlatformFilter(state.platform === 'any' ? undefined : state.platform);

    dashboard.render();
  }));
}, false);

class DataURL {
  constructor(useMockData = false) {
    this._useMockData = useMockData;
  }

  mockData() { return this._useMockData; }

  dashboardURL(sha) {
    if (this._useMockData)
      return `/mockdata/${sha}.json`;
    return `https://folioflakinessdashboard.blob.core.windows.net/dashboards/compressed_v1/${sha}.json`;
  }

  commitsURL() {
    if (this._useMockData)
      return `/mockdata/commits.json`;
    return 'https://api.github.com/repos/microsoft/playwright/commits?per_page=100';
  }

  sourceURL(sha, testFile) {
    if (this._useMockData)
      return `/mockdata/page-basic.spec.ts`;
    return `https://raw.githubusercontent.com/microsoft/playwright/${sha}/test/${testFile}`;
  }
}

class CommitData {
  constructor(dataURL, sha) {
    this._dataURL = dataURL;
    this._sha = sha;

    this._loadingPromise = null;

    this._specs = new SMap();
    this._tests = new SMap();
    this._isLoaded = false;
  }

  isLoaded() { return this._isLoaded; }
  specs() { return this._specs; }
  tests() { return this._tests; }

  async ensureLoaded() {
    if (!this._loadingPromise)
      this._loadingPromise = this._loadData();
    await this._loadingPromise;
  }

  _onLoadProgress(received, total, isComplete) {
    // Experimentally it turns out that compression ratio is ~19 for JSON reports.
    const COMPRESSION_RATIO = 19;
    const ratio = isComplete ? 1 : received / total / COMPRESSION_RATIO;
  }

  async _loadData() {
    const {json, error} = await fetchProgress(this._dataURL.dashboardURL(this._sha), this._onLoadProgress.bind(this))
      .then(text => ({json: JSON.parse(text)}))
      .catch(error => ({error}));
    if (error) {
      this._isLoaded = true;
      return;
    }

    const specs = [];
    const tests = [];

    for (const entry of json) {
      for (const spec of entry.specs) {
        const specId = entry.file + '---' + spec.title;
        const specObject = {
          specId,
          sha: this._sha,
          file: entry.file,
          title: spec.title,
          line: spec.line,
          column: spec.column,
        };
        specs.push(specObject);
        for (const test of spec.tests || []) {
          const testObject = {
            specId,
            spec: specObject,
            sha: this._sha,
            name: getTestName(test),
            browserName: test.parameters.browserName || 'N/A',
            platform: test.parameters.platform,
            parameters: test.parameters,
            annotations: test.annotations || [],
            runs: {
              passed: test.passed || 0,
              skipped: test.skipped || 0,
              timedOut: test.timedOut || 0,
              failed: test.failed ? test.failed.length : 0,
            },
            errors: test.failed || [],
            maxTime: test.maxTime, // max time with test passing
            expectedStatus: test.expectedStatus || 'passed',
          };
          testObject.category = getTestCategory(testObject);
          tests.push(testObject);
        }
      }
    }

    specs.sort((s1, s2) => {
      if (s1.file !== s2.file)
        return s1.file < s2.file ? -1 : 1;
      return s1.line - s2.line || s1.column - s2.column;
    });
    this._specs = new SMap(specs);
    this._tests = new SMap(tests);
    this._isLoaded = true;
  }
}

class DashboardData {
  static async create(useMockData = false) {
    const dataURL = new DataURL(useMockData);
    const commits = await rateLimitedFetch(dataURL.commitsURL()).then(text => JSON.parse(text)).then(commits => commits.map(c => {
      c.commit.committer.date = +new Date(c.commit.committer.date);
      return c;
    }).sort((c1, c2) => c2.commit.committer.date - c1.commit.committer.date));
    return new DashboardData(dataURL, commits);
  }

  constructor(dataURL, commits) {
    this._dataURL = dataURL;
    this._allCommits = new SMap(commits.map((c, index) => ({
      sha: c.sha,
      author: c.commit.author.name,
      email: c.commit.author.email,
      title: c.commit.message.split('\n')[0],
      message: c.commit.message,
      timestamp: c.commit.committer.date,
      data: new CommitData(dataURL, c.sha),
    })));

    this._fileContentsCache = new Map();
    this._mainElement = html`<section style="overflow: auto;${STYLE_FILL}"></section>`;
    this._sideElement = html`<section style="padding: 1em; overflow: auto;${STYLE_FILL}"></section>`;

    this._selection = {};

    const doCloseSidebar = () => {
      split.hideSidebar(this._mainSplitView);
      this._selection = {};
      this.render();
    };

    let editorTabScrollTop = 0;
    this._editorTab = {
      titleElement: html`<span></span>`,
      contentElement: html`<z-widget
          onconnected=${w => w.scrollTop = editorTabScrollTop}
          onscroll=${e => editorTabScrollTop = e.target.scrollTop} style="${STYLE_FILL}; overflow: auto;"></z-widget>`,
    };
    this._errorsTab = {
      titleElement: html`<span></span>`,
      contentElement: html`
          <section style="
            display: flex;
            flex-direction: column;
            flex: auto;
            padding: 1em;
            white-space: pre;
            overflow: auto;
          "></section>
      `,
    };
    this._tabstrip = new TabStrip();
    this._tabstrip.addTab({
      tabId: 'editor-tab',
      titleElement: this._editorTab.titleElement,
      contentElement: this._editorTab.contentElement,
      selected: true,
    });
    this._tabstrip.addTab({
      tabId: 'errors-tab',
      titleElement: this._errorsTab.titleElement,
      contentElement: this._errorsTab.contentElement,
      selected: false,
    });


    this._secondarySplitView = split.right({
      main: this._sideElement,
      sidebar: this._tabstrip.element,
      hidden: false,
      size: 700,
    });
    this._mainSplitView = split.bottom({
      main: this._mainElement,
      sidebar: html`
        ${this._secondarySplitView}
        <button style="position: absolute;
                       right: -5px;
                       top: 0;
                       appearance: none;
                       background-color: var(--border-color);
                       border: 5px solid var(--border-color);
                       cursor: pointer;
                       transform: translate(0, -100%);
                       z-index: 10000;"
                onclick=${doCloseSidebar}>${CHAR_CROSS} close</button>
      `,
      size: 300,
      hidden: true,
    });
    this.element = this._mainSplitView;
    split.registerResizer(this._mainSplitView, this._tabstrip.tabstripElement());

    this._browserFilter = undefined;
    this._platformFilter = undefined;

    this._showFlaky = false;
    this._lastCommits = 0;
    this.setLastCommits(20);
  }

  mockData() { return this._dataURL.mockData(); }

  setLastCommits(value) {
    if (isNaN(value) || value < 1 || value > 50) {
      console.error(`DASHBOARD: Cannot set last commits number to "${value}"`);
      return;
    }
    this._lastCommits = value;
  }

  setShowFlaky(value) { this._showFlaky = value; }
  setBrowserFilter(value) { this._browserFilter = value; }
  setPlatformFilter(value) { this._platformFilter = value; }

  render() {
    console.time('preparing');
    const self = this;
    const commits = this._allCommits.slice(0, this._lastCommits);

    const allBrowserNames = [...new Set(commits.map(commit => commit.data.tests().uniqueValues('browserName')).flat())].sort();
    const allPlatforms = [...new Set(commits.map(commit => commit.data.tests().uniqueValues('platform')).flat())].sort();

    let loadingProgressElement = null;
    const pendingCommits = commits.filter(commit => !commit.data.isLoaded());
    if (pendingCommits.length > 0) {
      loadingProgressElement = html`<div></div>`;
      const updateProgress = () => {
        const complete = commits.filter(commit => commit.data.isLoaded());
        if (complete.length === commits.length) {
          this.render();
        } else {
          loadingProgressElement.textContent = '';
          loadingProgressElement.append(svgPie({ratio: complete.length / commits.length}));
        }
      };
      for (const pending of pendingCommits)
        pending.data.ensureLoaded().then(() => updateProgress());
      updateProgress();
    }

    const prefilteredTests = new SMap(commits.map(commit => [
      ...commit.data.tests().getAll({category: 'bad'}),
      ...(this._showFlaky ? commit.data.tests().getAll({category: 'flaky'}) : []),
    ]).flat());
    const faultySpecIds = new SMap(prefilteredTests.getAll({browserName: this._browserFilter, platform: this._platformFilter})).uniqueValues('specId');
    const tests = new SMap(commits.map(commit => {
      return faultySpecIds.map(specId => commit.data.tests().getAll({ specId, browserName: this._browserFilter, platform: this._platformFilter})).flat();
    }).flat());

    const specIdToHealth = new Map();
    for (const specId of faultySpecIds) {
      let good = 0;
      let firstBadIndex = -1;
      for (let i = 0; i < commits.length; ++i) {
        const commit = commits[i];
        const isGood = tests.getAll({specId, sha: commit.sha}).every(test => test.category === 'good');
        if (isGood)
          ++good;
        else if (firstBadIndex === -1)
          firstBadIndex = i;
      }
      specIdToHealth.set(specId, {
        goodCommits: good,
        firstBadIndex,
      });
    }

    const specs = new SMap(faultySpecIds.map(specId => {
      for (const commit of commits) {
        let result = commit.data.specs().get({specId});
        if (result)
          return result;
      }
    }).sort((spec1, spec2) => {
      const h1 = specIdToHealth.get(spec1.specId);
      const h2 = specIdToHealth.get(spec2.specId);
      if (h1.goodCommits !== h2.goodCommits)
        return h1.goodCommits - h2.goodCommits;
      if (h1.firstBadIndex !== h2.firstBadIndex)
        return h1.firstBadIndex - h2.firstBadIndex;
      if (spec1.file !== spec2.file)
        return spec1.file < spec2.file ? -1 : 1;
      return spec1.line - spec2.line;
    }));

    console.timeEnd('preparing');

    this._context = {
      loadingProgressElement,
      commits,
      prefilteredTests, // these are tests without browser/platform filtering.
      tests,
      specs,
      allPlatforms,
      allBrowserNames,
    };

    this._renderMainElement();
    this._renderSummary();
    this._renderErrorsTab();
    this._updateMainElementSelection();
  }

  _selectSpecCommit(specId, sha) {
    this._selection.specId = specId;
    this._selection.sha = sha;
    this._selection.testName = undefined;
    split.showSidebar(this._mainSplitView);
    this._renderSummary();
    this._renderErrorsTab();

    this._updateMainElementSelection();
  }

  _updateMainElementSelection() {
    let selectedElement = this._mainElement.$('.selected-element');
    if (selectedElement)
      selectedElement.classList.remove('selected-element');
    if (this._selection.specId && this._selection.sha)
      selectedElement = this._mainElement.$(`svg[data-specid="${this._selection.specId}"][data-commitsha="${this._selection.sha}"]`);
    else if (this._selection.specId)
      selectedElement = this._mainElement.$(`hbox[data-specid="${this._selection.specId}"]`);
    if (selectedElement)
      selectedElement.classList.add('selected-element');
  }

  _selectTest(testName) {
    this._tabstrip.selectTab('errors-tab');
    this._selection.testName = testName;
    this._renderSummary();
    this._renderErrorsTab();
  }

  _renderMainElement() {
    const {allBrowserNames, allPlatforms, specs, commits, loadingProgressElement} = this._context;

    console.time('rendering main');

    this._mainElement.textContent = '';
    this._mainElement.append(html`
      <div style="padding: 1em;">
        <hbox style="padding-bottom: 1em; border-bottom: 1px solid var(--border-color);">
          <span style="margin-left: 1em; margin-right: 1em;">
            Last <select oninput=${e => urlState.amend({commits: e.target.value})}>
              ${[...new Set([2,5,10,15,20,30,50, this._lastCommits])].sort((a, b) => a - b).map(value => html`
                <option value=${value} selected=${value === this._lastCommits}>${value}</option>
              `)}
            </select> commits
          </span>
          <span style="width: 2em;"> ${loadingProgressElement}</span>
          <span style="margin-right: 1em; display: inline-flex; align-items: center;">
            <input checked=${this._showFlaky} oninput=${e => urlState.amend({show_flaky: e.target.checked})} id=show-flaky-input-checkbox type=checkbox>
            <label for=show-flaky-input-checkbox>Show flaky</label>
          </span>
          <span style="margin-right: 1em;">
            browser:
            <select oninput=${e => urlState.amend({browser: e.target.value})}>
                <option selected=${this._browserFilter === undefined}} value="any">any</option>
              ${allBrowserNames.map(browserName => html`
                <option selected=${this._browserFilter === browserName} value="${browserName}">${browserName}</option>
              `)}
            </select>
          </span>
          <span style="margin-right: 1em;">
            platform:
            <select oninput=${e => urlState.amend({platform: e.target.value})}>
                <option selected=${this._platformFilter === undefined}} value="any">any</option>
              ${allPlatforms.map(platform => html`
                <option selected=${this._platformFilter === platform} value="${platform}">${platform}</option>
              `)}
            </select>
          </span>
        </hbox>
        <hbox style="margin-left: 1em;">
          <h2>${specs.size} problematic specs</h2>
          <a style="margin-left: 1em; cursor: pointer;" onclick=${this._selectSpecCommit.bind(this, undefined, undefined)}>(summary)</a>
        </hbox>
        <vbox style="margin-bottom: 1em; padding-bottom: 1em; border-bottom: 1px solid var(--border-color);">
          ${this._renderStats()}
        </vbox>
        ${specs.map(spec => html`
          <hbox>
            <hbox onclick=${this._selectSpecCommit.bind(this, spec.specId, undefined)} class=hover-darken style="
              ${STYLE_TEXT_OVERFLOW}
              width: 600px;
              cursor: pointer;
              padding: 0 1em;
              margin-right: 1px;
              align-items: baseline;
              background: white;
            " data-specid="${spec.specId}">
              <span style="overflow: hidden; text-overflow: ellipsis;"><span style="color: #9e9e9e;">${spec.file} - </span>${spec.title}</span>
              <spacer></spacer>
              ${this._renderSpecAnnotations(spec)}
            </hbox>
            ${commits.map(commit => this._renderCommitTile(spec, commit, this._selectSpecCommit.bind(this, spec.specId, commit.sha)))}
          </hbox>
        `)}
      </div>
    `);
    console.timeEnd('rendering main');
  }

  _resolveSelectionToObjects() {
    const commit = this._selection.sha ? this._allCommits.get({sha: this._selection.sha}) : undefined;
    const spec = this._selection.specId ? [commit, ...this._allCommits].filter(Boolean).map(({data}) => data.specs().get({specId: this._selection.specId})).filter(Boolean)[0] : undefined;
    return {commit, spec};
  }

  _renderSummary() {
    if (!split.isSidebarShown(this._mainSplitView))
      return;
    console.time('rendering summary');
    const {tests, commits} = this._context;

    const {commit, spec} = this._resolveSelectionToObjects();

    const content = html`
      <vbox style="${STYLE_FILL}; overflow: hidden;">
        <hbox onzrender=${e => split.registerResizer(this._mainSplitView, e)} style="
            ${STYLE_TEXT_OVERFLOW}
            cursor: row-resize;
            flex: none;
            background-color: var(--border-color);
            padding: 2px 1em;
        ">
          <hbox onclick=${() => split.maximizeSidebar(this._mainSplitView)} style="cursor: pointer; flex: none; margin-right: 1ex; font-weight: bold">
            ${svg`
            <svg style="margin-right: 4px;" height="10px" version="1.1" viewBox="8 8 20 20" width="10px">
              <path d="m 10,16 2,0 0,-4 4,0 0,-2 L 10,10 l 0,6 0,0 z"></path>
              <path d="m 20,10 0,2 4,0 0,4 2,0 L 26,10 l -6,0 0,0 z"></path>
              <path d="m 24,24 -4,0 0,2 L 26,26 l 0,-6 -2,0 0,4 0,0 z"></path>
              <path d="M 12,20 10,20 10,26 l 6,0 0,-2 -4,0 0,-4 0,0 z"></path>
            </svg>
            `}
            <div>Details</div>
          </hbox>
        </hbox>
      </vbox>
    `;

    const testNameToStats = new Map();
    for (const test of tests.getAll({sha: this._selection.sha, specId: this._selection.specId})) {
      let stats = testNameToStats.get(test.name);
      if (!stats) {
        stats = {
          passed: 0,
          failed: 0,
          timedOut: 0,
          skipped: 0,
          annotationTypes: new Set(),
          expectedStatuses: new Set(),
        };
        testNameToStats.set(test.name, stats);
      }
      stats.passed += test.runs.passed;
      stats.failed += test.runs.failed;
      stats.timedOut += test.runs.timedOut;
      stats.skipped += test.runs.skipped;
      for (const annotation of test.annotations)
        stats.annotationTypes.add(annotation.type);
      stats.expectedStatuses.add(test.expectedStatus);
    }

    const testNames = [...testNameToStats.entries()].sort(([t1, s1], [t2, s2]) => {
      if (s1.failed !== s2.failed)
        return s2.failed - s1.failed;
      if (s1.timedOut !== s2.timedOut)
        return s2.timedOut - s1.timedOut;
      if (s1.annotationTypes.size !== s2.annotationTypes.size)
        return s2.annotationTypes.size - s1.annotationTypes.size;
      return t1 < t2 ? -1 : 1;
    });

    if (testNames.length) {
      this._renderCodeTab(spec);
      split.showSidebar(this._secondarySplitView);
      content.append(html`
        <div style="flex: auto; overflow: auto; padding: 1em; position: relative;">
          <hbox style="margin-bottom: 1em;">
            <vbox style="align-items: flex-end;">
              <div>spec:</div>
              <div>commit:</div>
              <div>test:</div>
            </vbox>
            <vbox style="margin-left: 1ex; align-items: flex-start; overflow: hidden;">
              <div style="${STYLE_TEXT_OVERFLOW}; max-width: 100%; font-weight: ${spec ? 'bold' : 'normal'}">${spec?.title || `<summary for ${this._context.specs.size} specs>`}</div>
              <div style="${STYLE_TEXT_OVERFLOW}; max-width: 100%; font-weight: ${commit ? 'bold' : 'normal'}">${commit?.title || `<summary for ${this._context.commits.length} commits>`}</div>
              <div style="${STYLE_TEXT_OVERFLOW}; max-width: 100%; font-weight: ${this._selection.testName ? 'bold' : 'normal'}">${this._selection.testName || `<summary for all tests>`}</div>
            </vbox>
          </hbox>
          <hbox style="border-bottom: 1px solid var(--border-color); margin-bottom: 4px;">
            <div style="width: 420px; text-align: center;">test parameters</div>
            <div style="width: 100px; text-align: center;">runs</div>
            <div style="width: 100px; text-align: center;">expected</div>
          </hbox>
          ${testNames.map(([testName, stats]) => html`
            <hbox class="hover-darken" style="
                background-color: white;
                position: relative;
                cursor: pointer;
                ${this._selection.testName === testName ? 'outline: 2px solid black; z-index: 100;' : ''}
              " onclick=${this._selectTest.bind(this, testName)}>
              <div style="
                width: 300px;
                padding-left: 1ex;
                ${STYLE_TEXT_OVERFLOW}
              ">${testName}</div>
              <div style="width: 120px; white-space: nowrap;">${[...stats.annotationTypes].map(annotationType => renderAnnotation(annotationType))}</div>
              ${(() => {
                const result = html`<hbox style="width: 100px; align-items: center; justify-content: center;"></hbox>`;
                for (const status of ['failed', 'timedOut', 'passed', 'skipped']) {
                  const count = stats[status];
                  if (count === 0)
                    continue;
                  if (count <= 4) {
                    for (let i = 0; i < count; ++i)
                      result.append(renderTestStatus(status, {marginRight: 2, size: 10}));
                  } else {
                    result.append(renderTestStatus(status, {count: count > 99 ? CHAR_INFINITY : count, marginRight: 2, size: 14}));
                  }
                }
                result.lastElementChild.style.removeProperty('margin-right');
                return result;
              })()}
              <div style="width: 100px; text-align: center;">
                ${[...stats.expectedStatuses].map((status, index) => renderTestStatus(status, {size: 10, marginRight: index < stats.expectedStatuses.size - 1 ? 2 : 0}))}
              </div>
            </hbox>
          `)}
        </div>
      `);
    } else {
      split.hideSidebar(this._secondarySplitView);
      content.append(html`
        <div style="padding: 1em;">
          <h3>No Data</h3>
          <p>
            This spec didn't run a single time. ${commit && html`<a href="${commitURL('playwright', commit.sha)}">See on GitHub</a>`}
          </p>
        </div>
      `);
    }
    this._sideElement.textContent = '';
    this._sideElement.append(content);
    console.timeEnd('rendering summary');
  }

  _renderSelection({showTestName = false} = {}) {
    const {commit, spec} = this._resolveSelectionToObjects();
    return html`
    `;
  }

  _renderCodeTab(spec) {
    if (!spec)
      return;

    const gutter = html`<div></div>`;
    const scrollToCoords = () => {
      gutter.$(`[x-line-number="${spec.line}"]`)?.scrollIntoView({block: 'center'});
    };

    this._editorTab.titleElement.textContent = ``;
    this._editorTab.titleElement.append(html`
      <span onclick=${e => scrollToCoords()}>${spec.file}:${spec.line}</span>
    `);

    const editorSourceLoadingElement = html`<div></div>`;
    setTimeout(() => editorSourceLoadingElement.textContent = 'Loading...', 777);

    this._editorTab.contentElement.textContent = '';
    this._editorTab.contentElement.append(editorSourceLoadingElement);

    const cacheKey = JSON.stringify({sha: spec.sha, file: spec.file});
    let textPromise = this._fileContentsCache.get(cacheKey);
    if (!textPromise) {
      textPromise = fetch(this._dataURL.sourceURL(spec.sha, spec.file)).then(r => r.text());
      this._fileContentsCache.set(cacheKey, textPromise);
    }

    preloadHighlighter('text/typescript');

    textPromise.then(async text => {
      const lines = await highlightText(text, 'text/typescript');
      const digits = (lines.length + '').length;
      const STYLE_SELECTED = `background-color: ${COLOR_SELECTION};`;
      gutter.append(html`
        <div style="padding: 0 1em 0 1em; text-align: right; border-right: 1px solid var(--border-color)">
          ${lines.map((line, index) => html`<div x-line-number=${index + 1}>${index + 1}</div>`)}
        </div>
      `);
      const code = html`
        <div style="flex: auto">
        <div>
        ${lines.map((line, index) => html`
          <div style="
            display: flex;
            padding-left: 1em;
            ${index + 1 === spec.line ? STYLE_SELECTED : ''}
          ">
            ${line.length ? line.map(({tokenText, className}) => html`<span class=${className ? 'cm-js-' + className : undefined}>${tokenText}</span>`) : html`<span> </span>`}
          </div>
        `)}
        </div>
        </div>
      `;
      this._editorTab.contentElement.textContent = '';
      this._editorTab.contentElement.append(html`
        <div style="display: flex;
                    white-space: pre;
                    overflow: auto;
                    font-family: var(--monospace);
        ">
          ${gutter}
          ${code}
        </div>
      `);
      scrollToCoords();
    });
  }

  _renderStats() {
    const {allBrowserNames, allPlatforms, prefilteredTests} = this._context;
    const faultySpecCount = (browserName, platform) => new SMap(prefilteredTests.getAll({browserName, platform})).uniqueValues('specId').length;

    return html`
      <hbox>
      <div style="
        display: grid;
        grid-template-rows: ${'auto '.repeat(allPlatforms.length + 1).trim()};
        grid-template-columns: ${'auto '.repeat(allBrowserNames.length + 1).trim()};
        border: 1px solid var(--border-color);
      ">
        <div style="
            border-right: 1px solid var(--border-color);
            border-bottom: 1px solid var(--border-color);
          "></div>
        ${allBrowserNames.map(browserName => html`
          <div style="
              padding: 4px 1em;
              border-bottom: 1px solid var(--border-color);
              background-color: ${browserName === this._browserFilter ? COLOR_SELECTION : 'none'};
          ">
            <a href="${amendURL({browser: browserName === this._browserFilter ? 'any' : browserName, platform: 'any'})}">${browserLogo(browserName, 18)}</a>
          </div>
        `)}
        ${allPlatforms.map(platform => html`
          <div style="
              padding: 0 1em;
              border-right: 1px solid var(--border-color);
              background-color: ${platform === this._platformFilter ? COLOR_SELECTION : 'none'};
          ">
            <a href="${amendURL({platform: platform === this._platformFilter ? 'any' : platform, browser: 'any'})}">${platform}</a>
          </div>
          ${allBrowserNames.map(browserName => {
            const url = (platform === this._platformFilter && browserName === this._browserFilter) ? amendURL({platform: 'any', browser: 'any'}) : amendURL({platform, browser: browserName});
            let isHighlighted = false;
            if (this._platformFilter && this._browserFilter)
              isHighlighted = platform === this._platformFilter && browserName === this._browserFilter;
            else
              isHighlighted = platform === this._platformFilter || browserName === this._browserFilter;
            return html`
              <div style="
                  text-align: center;
                  padding: 0 1em;
                  background-color: ${isHighlighted ? COLOR_SELECTION : 'none'};
              "><a style="color: var(--text-color);" href="${url}">${faultySpecCount(browserName, platform) || CHAR_MIDDLE_DOT}</a></div>
            `;
          })}
        `)}
      </div>
      </hbox>
    `;
  }

  _renderSpecAnnotations(spec) {
    const {tests} = this._context;
    const annotations = tests.getAll({specId: spec.specId, sha: spec.sha}).map(test => test.annotations).flat();
    const types = new SMap(annotations).uniqueValues('type').sort();
    return html`<hbox style="align-self: center;">${types.map(renderAnnotation)}</hbox>`;
  }

  _renderCommitTile(spec, commit, onclick) {
    const {tests} = this._context;
    let color = COLOR_GREY;
    const categories = new Set(tests.getAll({specId: spec.specId, sha: commit.sha}).map(test => test.category));
    if (categories.has('bad'))
      color = COLOR_RED;
    else if (categories.has('flaky') && this._showFlaky)
      color = COLOR_VIOLET;
    else if (categories.size || commit.data.specs().has({specId: spec.specId}))
      color = COLOR_GREEN;

    return svg`
      <svg class=hover-darken style="cursor: pointer; flex: none; margin: 1px;" width="${COMMIT_RECT_SIZE}" height="${COMMIT_RECT_SIZE}"
           data-specid="${spec.specId}"
           data-commitsha="${commit.sha}"
           onclick=${onclick}
           viewbox="0 0 14 14">
        <rect x=0 y=0 width=14 height=14 fill="${color}"/>
      </svg>
    `;
  }

  _renderErrorsTab() {
    const {tests} = this._context;

    const viewTests = tests.getAll({sha: this._selection.sha, specId: this._selection.specId, name: this._selection.testName});
    const runsWithErrors = viewTests.map(test => test.errors.map(error => ({
      test,
      error,
      stackId: humanId(createStackSignature(error.stack)),
    }))).flat();

    if (!runsWithErrors.length) {
      this._errorsTab.titleElement.textContent = `Unique Errors - none`;
      this._errorsTab.contentElement.textContent = '';
      this._errorsTab.contentElement.append(html`
        <h3>No Errors</h3>
      `);
      return;
    }


    const stackIdToInfo = new Map();
    for (const {test, error, stackId} of runsWithErrors) {
      let info = stackIdToInfo.get(stackId);
      if (!info) {
        info = {
          stackId,
          specIds: new Set(),
          commitSHAs: new Set(),
          errors: [],
        };
        stackIdToInfo.set(stackId, info);
      }
      info.specIds.add(test.specId);
      info.commitSHAs.add(test.sha);
      info.errors.push(error);
    }

    this._errorsTab.titleElement.textContent = `Unique Errors: ${stackIdToInfo.size}`;
    this._errorsTab.contentElement.textContent = '';
    this._errorsTab.contentElement.append(html`
      ${[...stackIdToInfo.values()].sort((info1, info2) => {
        if (info1.specIds.size !== info2.specIds.size)
          return info2.specIds.size - info1.specIds.size;
        if (info1.commitSHAs.size !== info2.commitSHAs.size)
          return info2.commitSHAs.size - info1.commitSHAs.size;
        return info2.errors.length - info1.errors.length;
      }).map(({stackId, specIds, commitSHAs, errors}, index) => html`
        <h2 style="display: flex;align-items: center;">(${index + 1}/${stackIdToInfo.size}) error "${stackId}"</h2>
        <div style="margin-left: 1em;">
          <div>specs: ${specIds.size}</div>
          ${(() => {
            const terminal = html`<pre style="overflow: auto;">${highlightANSIText(errors[0].stack)}</pre>`;
            return html`
                <div style="
                  background-color: #333;
                  color: #eee;
                  padding: 1em;
                ">
                  <div>Occurence <select style="background-color: #333; color: white;" oninput=${e => {
                      terminal.textContent = '';
                      terminal.append(highlightANSIText(e.target.selectedOptions[0].error.stack));
                    }}>
                      ${errors.map((error, index) => html`
                        <option onzrender=${e => e.error = error}>#${index + 1}</option>
                      `)}
                    </select>
                  </div>
                  <hr/>
                  ${terminal}
                </div>
            `;
          })()}
        </div>
      `)}
    `);
  }

}

function getTestCategory(test) {
  const hasGoodRun = test.runs[test.expectedStatus] > 0;
  const hasBadRun = (test.expectedStatus !== 'failed' && test.runs.failed > 0) || (test.expectedStatus !== 'passed' && test.runs.passed > 0) || (test.expectedStatus !== 'timedOut' && test.runs.timedOut > 0);
  if (hasGoodRun && hasBadRun)
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

function svgPie({ratio, color = '#bbb', size = COMMIT_RECT_SIZE}) {
  const r = 50;
  const cx = r;
  const cy = r;
  if (Math.abs(1 - ratio) < 1e-5) {
    return svg`
      <svg width=${size} height=${size} viewbox="0 0 ${2 * r} ${2 * r}">
        <circle cx=${cx} cy=${cy} fill="${color}" r="${r}"/>
      </svg>
    `;
  }
  const rotation = -Math.PI / 2;
  const ax1 = cx + r * Math.cos(0 + rotation);
  const ay1 = cy + r * Math.sin(0 + rotation);
  const ax2 = cx + r * Math.cos(2 * Math.PI * ratio + rotation);
  const ay2 = cy + r * Math.sin(2 * Math.PI * ratio + rotation);
  const largeArcFlag = ratio < 0.5 ? "0" : "1";
  return svg`
    <svg width=${size} height=${size} viewbox="0 0 ${2 * r} ${2 * r}">
      <path fill="${color}" d="M ${cx} ${cy} L ${ax1} ${ay1} A ${r} ${r} 0 ${largeArcFlag} 1 ${ax2} ${ay2} L ${cx} ${cy}"/>
      <circle cx=${cx} cy=${cy} stroke="${color}" stroke-width="2px" fill="none" r="${r}"/>
    </svg>
  `;
}

function renderTestStatus(status, {count='', size=14, marginRight=0} = {}) {
  return svg`
    <svg style="margin-right: ${marginRight}px;" width=${size } height=${size } viewbox="0 0 ${size * 2} ${size * 2}">
      <circle cx=${size} cy=${size} r=${size} fill="${testRunColors[status] || 'blue'}"></circle>
      <text font-weight=200 font-size=large x=${size} y=${size} text-anchor="middle" stroke="#333"  dy=".3em">${count}</text>
    </svg>
  `;
}

function flattenSpecs(suite, result = []) {
  if (suite.suites) {
    for (const child of suite.suites)
      flattenSpecs(child, result);
  }
  for (const spec of suite.specs || [])
    result.push(spec);
  return result;
}

function StringToBool(text) {
  text = text.trim().toLowerCase();
  return text === 'yes' || text === 'true';
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
        user-select: none;
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


class TabStrip {
  constructor() {
    this._strip = html`
      <div style="
          background-color: var(--border-color);
          cursor: row-resize;
          flex: none;
          display: flex;
      "></div>
    `;
    this._content = html`
      <div style="
        flex: auto;
        position: relative;
        overflow: auto;
      "></div>
    `;
    this.element = html`<section style="
      display: flex;
      flex-direction: column;
      ${STYLE_FILL}
    ">
      ${this._strip}
      ${this._content}
    </section>`;

    this._selectedTabId = '';
    this._tabs = new Map();
  }

  tabstripElement() {
    return this._strip;
  }

  addTab({tabId, titleElement, contentElement, selected = false}) {
    const tabElement = html`
      <span class=hover-lighten style="
        user-select: none;
        padding: 2px 1em;
        cursor: pointer;
        display: inline-block;
        white-space: pre;
        flex: none;
        background-color: ${selected ? 'white' : 'none'};
      ">${titleElement}</span>
    `;
    tabElement.onclick = this._onTabClicked.bind(this, tabId);
    this._tabs.set(tabId, {titleElement, contentElement, tabElement});
    this._strip.append(tabElement);
    if (selected)
      this.selectTab(tabId);
  }

  _onTabClicked(tabId, event) {
    if (this.selectTab(tabId))
      consumeDOMEvent(event);
  }

  selectTab(tabId) {
    if (this._selectedTabId === tabId)
      return false;
    if (this._selectedTabId)
      this._tabs.get(this._selectedTabId).tabElement.style.setProperty('background-color', 'var(--border-color)');
    this._selectedTabId = tabId;
    this._content.textContent = '';
    if (this._selectedTabId) {
      this._tabs.get(this._selectedTabId).tabElement.style.setProperty('background-color', 'white');
      this._content.append(this._tabs.get(this._selectedTabId).contentElement);
    }
    return true;
  }
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
      .replaceAll(/\b\d+\b/g, '<NUM>')
      // replace all hex numbers with '<HEXNUM>'
      .replaceAll(/\b0x[0-9a-e]+\b/gi, '<HEXNUM>');
}
