import {html, svg} from './zhtml.js';
import {humanReadableDate, browserLogoURL, browserLogo, commitURL, highlightANSIText} from './misc.js';
import {CriticalSection, consumeDOMEvent, Throttler} from './utils.js';
import {Popover} from './widgets.js';
import {SMap} from './smap.js';
import {split} from './split.js';
import {rateLimitedFetch, fetchProgress} from './fetch-extras.js';
import {highlightText, preloadHighlighter} from './codehighlight.js';
import {URLState, newURL, amendURL} from './urlstate.js';
import {humanId} from './humanid.js';

const CHAR_MIDDLE_DOT = '·';
const CHAR_BULLSEYE = '◎';
const CHAR_PLUS_IN_CIRCLE = '⊕';
const CHAR_WARNING = '⚠';
const CHAR_CROSS = '✖';
const CHAR_INFINITY = '∞';
const CHAR_RIGHT_ARROW = '⟶';
const CHAR_UP_ARROW = '↑';
const CHAR_DOWN_ARROW = '↓';

const COMMIT_RECT_SIZE = 16;

const COLOR_SELECTION = '#fff59d';
const COLOR_YELLOW = '#ffcc80';
const COLOR_GREEN = '#a5d6a7';
const COLOR_RED = '#ef9a9a';
const COLOR_VIOLET = '#ce93d8';
const COLOR_GREY = '#eeeeee';

const STYLE_FILL = 'position: absolute; left: 0; top: 0; right: 0; bottom: 0;';
const STYLE_TEXT_OVERFLOW = `white-space: nowrap; overflow: hidden; text-overflow: ellipsis;`;
const STYLE_SELECTED = `background-color: ${COLOR_SELECTION};`;

const testRunColors = {
  'passed': COLOR_GREEN,
  'failed': COLOR_RED,
  'timedOut': COLOR_YELLOW,
  'skipped': COLOR_GREY,
};


const urlState = new URLState();

window.addEventListener('DOMContentLoaded', async () => {
  const criticalSection = new CriticalSection();
  const dashboard = new Dashboard();
  document.body.append(dashboard.element);

  urlState.startListening(() => criticalSection.run('nav', async () => {
    const state = urlState.state();

    const showFlaky = StringToBool(state.show_flaky || 'true');
    dashboard.setShowFlaky(showFlaky);

    const commits = parseInt(state.commits || '20', 10);
    dashboard.setLastCommits(commits);
    dashboard.setBrowserFilter(state.browser === 'any' ? undefined : state.browser);
    dashboard.setPlatformFilter(state.platform === 'any' ? undefined : state.platform);
    dashboard.setErrorIdFilter(state.errorid === 'any' ? undefined : state.errorid);
    dashboard.setUntilCommits(state.timestamp);
    dashboard.setBranchName(state.branch || 'master');
    dashboard.setSpecFilter(state.filter_spec);
    dashboard.setTestParameterFilters(state.test_parameter_filters);

    dashboard.render();
  }));
}, false);

class DataURL {
  dashboardURL(sha) {
    return `https://folioflakinessdashboard.blob.core.windows.net/dashboards/compressed_v1/${sha}.json`;
  }

  branches() {
    return 'https://api.github.com/repos/microsoft/playwright/branches';
  }

  commitsURL(untilTimestamp = undefined, branchName = undefined) {
    let url = 'https://api.github.com/repos/microsoft/playwright/commits?per_page=100';
    if (untilTimestamp)
      url += '&until=' + (new Date(untilTimestamp).toISOString());
    if (branchName)
      url += '&sha=' + branchName;
    return url;
  }

  sourceURL(sha, testFile) {
    return `https://raw.githubusercontent.com/microsoft/playwright/${sha}/tests/${testFile}`;
  }
}

const TestSymbol = Symbol('TestSymbol');

class CommitData {
  constructor(dataURL, sha) {
    this._dataURL = dataURL;
    this._sha = sha;

    this._loadingPromise = null;

    this._specs = new SMap();
    this._tests = new SMap();
    this._testFilter = new SMap();
    this._testParameters = new Map();
    this._isLoaded = false;
  }

  isLoaded() { return this._isLoaded; }
  specs() { return this._specs; }
  tests() { return this._tests; }
  testFilter() { return this._testFilter; }
  testParameters() { return this._testParameters; }

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
    const testFilter = [];

    for (const entry of json) {
      for (const spec of entry.specs) {
        const specId = entry.file + '---' + spec.title;
        const specObject = {
          specId,
          sha: this._sha,
          url: `https://github.com/microsoft/playwright/blob/${this._sha}/tests/${entry.file}#L${spec.line}`,
          file: entry.file,
          title: spec.title,
          line: spec.line,
          column: spec.column,
        };
        specs.push(specObject);
        for (const test of spec.tests || []) {
          if (test.parameters.channel) {
            test.parameters.browserName = test.parameters.channel;
            delete test.parameters.channel;
          }
          // By default, all tests are run under "default" mode unless marked differently.
          if (!test.parameters.mode)
            test.parameters.mode = 'default';
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
            errors: (test.failed || []).map(error => ({
              stack: error.stack,
              errorId: humanId(createStackSignature(error.stack)),
            })),
            hasErrors: test.failed?.length > 0,
            maxTime: test.maxTime, // max time with test passing
            expectedStatus: test.expectedStatus || 'passed',
          };
          testObject.category = getTestCategory(testObject);
          tests.push(testObject);
          testFilter.push({
            [TestSymbol]: testObject,
            ...testObject.parameters,
          });
          for (const [name, value] of Object.entries(test.parameters)) {
            let values = this._testParameters.get(name);
            if (!values) {
              values = new Set();
              this._testParameters.set(name, values);
            }
            values.add(value);
          }
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
    this._testFilter = new SMap(testFilter);
    this._isLoaded = true;
  }
}

class Dashboard {
  constructor() {
    this._dataURL = new DataURL();
    this._allCommits = new Map();

    this._commitsThrottler = new Throttler();
    this._fileContentsCache = new Map();
    this._mainElement = html`<section style="overflow: auto;${STYLE_FILL}"></section>`;
    this._sideElement = html`<section style="padding: 1em; overflow: auto;${STYLE_FILL}"></section>`;
    this._popover = new Popover(this._mainElement);
    document.documentElement.addEventListener('click', () => this._popover.hide(), false);

    this._selection = {};

    const doCloseSidebar = () => {
      split.hideSidebar(this._mainSplitView);
      this._selection = {};
      this._updateMainElementSelection();
    };

    this._editorTab = {
      titleElement: html`<span></span>`,
      contentElement: html`<section style="${STYLE_FILL}"></section>`,
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
    this._tabstrip.setRightWidget(html`
        <button style="appearance: none;
                       background-color: var(--border-color);
                       border: none;
                       cursor: pointer;"
                onclick=${doCloseSidebar}>${CHAR_CROSS} close</button>
    `);


    this._secondarySplitView = split.right({
      main: this._sideElement,
      sidebar: this._tabstrip.element,
      hidden: false,
      size: 700,
    });
    this._mainSplitView = split.bottom({
      main: this._mainElement,
      sidebar: this._secondarySplitView,
      size: 300,
      hidden: true,
    });
    this.element = this._mainSplitView;
    split.registerResizer(this._mainSplitView, this._tabstrip.tabstripElement());

    this._browserFilter = undefined;
    this._platformFilter = undefined;
    this._errorIdFilter = undefined;
    this._specFilter = undefined;
    this._testParameterFilters = new Map();

    this._showFlaky = false;
    this._lastCommits = 0;

    this._branchName = 'master';
    this._branches = ['master'];
    this._branchSHAs = new Map();
    this._initializeBranches();
  }

  setTestParameterFilters(testParameterFilters) {
    //TODO: parse test parameters from URL
    this._testParameterFilters = deserializeTestParameterFilters(testParameterFilters);
  }

  setUntilCommits(timestamp) {
    timestamp = +timestamp;
    if (isNaN(timestamp))
      timestamp = 0;
    if (this._untilCommitsFilter === timestamp)
      return;
    this._untilCommitsFilter = timestamp;
    this._loadBranchCommits();
  }

  setBranchName(branchName) {
    if (this._branchName === branchName)
      return;
    this._branchName = branchName;
    this._loadBranchCommits();
  }

  setSpecFilter(specFilter) {
    this._specFilter = specFilter;
  }

  _loadBranchCommits() {
    const branchName = this._branchName;
    this._commitsThrottler.schedule(async () => {
      const text = await rateLimitedFetch(this._dataURL.commitsURL(this._untilCommitsFilter, branchName));
      const rawCommits = JSON.parse(text);
      const commits = rawCommits.map(c => ({
        sha: c.sha,
        author: c.commit.author.name,
        url: c.html_url,
        email: c.commit.author.email,
        title: c.commit.message.split('\n')[0],
        message: c.commit.message,
        timestamp: +new Date(c.commit.committer.date),
        data: new CommitData(this._dataURL, c.sha),
      }));
      let branchSHAs = this._branchSHAs.get(branchName);
      if (!branchSHAs) {
        branchSHAs = new Set();
        this._branchSHAs.set(branchName, branchSHAs);
      }
      for (const commit of commits) {
        branchSHAs.add(commit.sha);
        if (!this._allCommits.has(commit.sha))
          this._allCommits.set(commit.sha, commit);
      }
      if (!this._commitsThrottler.isScheduled())
        this.render();
    });
  }

  async _initializeBranches() {
    const text = await rateLimitedFetch(this._dataURL.branches());
    const json = await JSON.parse(text);
    const semverToNumber = text => text.split('.').reverse().map((token, index) => +token * Math.pow(1000, index)).reduce((a, b) => a + b);
    this._branches = json.map(raw => raw.name).sort((b1, b2) => {
      if (b1 === 'master' || b2 === 'master')
        return b1 === 'master' ? -1 : 1;
      if (b1.startsWith('release-') && b2.startsWith('release-'))
        return semverToNumber(b2.substring('release-'.length)) - semverToNumber(b1.substring('release-'.length));
      if (b1.startsWith('release-') !== b2.startsWith('release-'))
        return b1.startsWith('release-') ? -1 : 1;
      return b1 < b2 ? -1 : 1;
    });
    this.render();
  }

  setLastCommits(value) {
    if (isNaN(value) || value < 1) {
      console.error(`DASHBOARD: Cannot set last commits number to "${value}"`);
      return;
    }
    this._lastCommits = value;
  }

  setShowFlaky(value) { this._showFlaky = value; }
  setBrowserFilter(value) { this._browserFilter = value; }
  setPlatformFilter(value) { this._platformFilter = value; }
  setErrorIdFilter(value) { this._errorIdFilter = value; }

  _filterTest(test) {
    for (const [name, valueFilters] of this._testParameterFilters) {
      let satisfiesSomeInclude = false;
      let hasIncludeFilter = false;
      for (const [value, op] of valueFilters) {
        if (op === 'exclude' && test.parameters[name] === value)
          return false;
        if (op === 'include') {
          hasIncludeFilter = true;
          satisfiesSomeInclude ||= test.parameters[name] === value;
        }
      }
      if (hasIncludeFilter && !satisfiesSomeInclude)
        return false;
    }
    if (!test.hasErrors || !this._errorIdFilter)
      return true;
    return test.errors.some(error => error.errorId === this._errorIdFilter);
  }

  render() {
    this._popover.hide();
    console.time('preparing');
    const self = this;

    const sortedCommits = [...(this._branchSHAs.get(this._branchName) || [])].map(sha => this._allCommits.get(sha)).sort((c1, c2) => c2.timestamp - c1.timestamp);
    const until = this._untilCommitsFilter ? this._untilCommitsFilter : Date.now();
    const commits = sortedCommits.filter(c => c.timestamp <= until).slice(0, this._lastCommits);

    const allBrowserNames = [...new Set([...commits.map(commit => commit.data.tests().uniqueValues('browserName')).flat(), this._browserFilter].filter(Boolean))].sort();
    const allPlatforms = [...new Set([...commits.map(commit => commit.data.tests().uniqueValues('platform')).flat(), this._platformFilter].filter(Boolean))].sort();

    let loadingProgressElement = null;
    const pendingCommits = commits.filter(commit => !commit.data.isLoaded());
    if (pendingCommits.length > 0) {
      loadingProgressElement = html`<div></div>`;
      const updateProgress = () => {
        if (this._context.loadingProgressElement !== loadingProgressElement)
          return;
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

    let prefilteredTests;
    if (!this._errorIdFilter && !this._specFilter) {
      prefilteredTests = new SMap(commits.map(commit => [
        ...commit.data.tests().getAll({category: 'bad'}),
        ...(this._showFlaky ? commit.data.tests().getAll({category: 'flaky'}) : []),
      ]).flat());
    } else if (this._specFilter) {
      const allSpecIds = new Set(commits.map(commit => commit.data.specs().filter(spec => spec.file.includes(this._specFilter) || spec.title.includes(this._specFilter)).map(spec => spec.specId)).flat());
      let tests = [];
      for (const specId of allSpecIds) {
        for (const commit of commits)
          tests.push(...commit.data.tests().getAll({specId}));
      }
      if (this._errorIdFilter)
        tests = tests.filter(test => test.errors.some(error => error.errorId === this._errorIdFilter))
      prefilteredTests = new SMap(tests);
    } else if (this._errorIdFilter) {
      prefilteredTests = new SMap(commits.map(commit => commit.data.tests().getAll({hasErrors: true}).filter(test => test.errors.some(error => error.errorId === this._errorIdFilter))).flat());
    }

    const faultySpecIds = new SMap(prefilteredTests.filter(test => this._filterTest(test))).uniqueValues('specId');

    console.time('-- filtering all selected tests');
    const tests = new SMap(commits.map(commit => {
      return faultySpecIds.map(specId => commit.data.tests().getAll({ specId })).flat().filter(test => this._filterTest(test));
    }).flat());
    console.timeEnd('-- filtering all selected tests');

    console.time('-- generating commit tiles');
    const commitTiles = new SMap(faultySpecIds.map(specId => commits.map(commit => {
      let category = '';
      if (commit.data.tests().getAll({ specId, category: 'bad' }).some(test => this._filterTest(test)))
        category = 'bad';
      else if (this._showFlaky && commit.data.tests().getAll({ specId, category: 'flaky' }).some(test => this._filterTest(test)))
        category = 'flaky';
      else if (commit.data.tests().getAll({ specId, category: 'good' }).some(test => this._filterTest(test)))
        category = 'good';
      return {
        specId,
        sha: commit.sha,
        category,
      };
    })).flat());
    console.timeEnd('-- generating commit tiles');

    const specIdToFirstFailingCommit = new Map();
    for (const specId of faultySpecIds) {
      specIdToFirstFailingCommit.set(specId, commits.length + 1);
      const tiles = commitTiles.getAll({specId});
      for (let i = 0; i < tiles.length; ++i) {
        if (tiles[i].category !== 'good' && tiles[i].category) {
          specIdToFirstFailingCommit.set(specId, i);
          break;
        }
      }
    }

    const specs = new SMap(faultySpecIds.map(specId => {
      for (const commit of commits) {
        const spec = commit.data.specs().get({specId});
        if (spec)
          return spec;
      }
    }).sort((spec1, spec2) => {
      const bad1 = commitTiles.getAll({specId: spec1.specId, category: 'bad'}).length;
      const bad2 = commitTiles.getAll({specId: spec2.specId, category: 'bad'}).length;

      const flaky1 = commitTiles.getAll({specId: spec1.specId, category: 'flaky'}).length;
      const flaky2 = commitTiles.getAll({specId: spec2.specId, category: 'flaky'}).length;
      if (flaky1 + bad1 !== flaky2 + bad2)
        return flaky2 + bad2 - flaky1 - bad1;

      const firstFailing1 = specIdToFirstFailingCommit.get(spec1.specId);
      const firstFailing2 = specIdToFirstFailingCommit.get(spec2.specId);
      if (firstFailing1 !== firstFailing2)
        return firstFailing1 - firstFailing2;
      if (spec1.file !== spec2.file)
        return spec1.file < spec2.file ? -1 : 1;
      return spec1.line - spec2.line;
    }));

    console.time('errors');
    const allErrorIdsSet = new Set();
    for (const commit of commits) {
      for (const specId of faultySpecIds) {
        for (const test of commit.data.tests().getAll({specId, hasErrors: true})) {
          if (!this._filterTest(test))
            continue;
          for (const error of test.errors)
            allErrorIdsSet.add(error.errorId);
        }
      }
    }
    console.timeEnd('errors');

    console.timeEnd('preparing');

    const isFirstRender = !this._context;

    if (isFirstRender && this._errorIdFilter)
      split.showSidebar(this._mainSplitView);

    this._context = {
      loadingProgressElement,
      until,
      commits,
      prefilteredTests, // these are tests without browser/platform filtering.
      tests,
      specs,
      allPlatforms,
      allBrowserNames,
      allErrorIds: [...allErrorIdsSet],
      commitTiles,
    };

    this._renderMainElement();
    this._renderSidebar();
    this._updateMainElementSelection();

    if (isFirstRender && this._errorIdFilter)
      this._tabstrip.selectTab(this._errorsTab);
  }


  _selectSpecCommit(specId, sha) {
    if (this._selection.specId === specId && this._selection.sha === sha) {
      this._selection.specId = undefined;
      this._selection.sha = undefined;
    } else {
      this._selection.specId = specId;
      this._selection.sha = sha;
    }
    this._selection.testName = undefined;
    split.showSidebar(this._mainSplitView);
    this._renderSidebar();

    this._updateMainElementSelection();
  }

  _updateMainElementSelection() {
    let selectedElement = this._mainElement.$('.selected-element');
    if (selectedElement)
      selectedElement.classList.remove('selected-element');
    if (this._selection.specId && this._selection.sha)
      selectedElement = this._mainElement.$(`[data-specid="${this._selection.specId}"][data-commitsha="${this._selection.sha}"]`);
    else if (this._selection.specId)
      selectedElement = this._mainElement.$(`[data-specid="${this._selection.specId}"]:not([data-commitsha])`);
    else if (this._selection.sha)
      selectedElement = this._mainElement.$(`[data-commitsha="${this._selection.sha}"]:not([data-specid])`);
    else
      selectedElement = null;
    if (selectedElement)
      selectedElement.classList.add('selected-element');
  }

  _selectTest(testName) {
    if (this._selection.testName === testName)
      this._selection.testName = undefined;
    else
      this._selection.testName = testName;
    this._renderSidebar();
    this._tabstrip.selectTab(this._errorsTab);
  }

  _renderMainElement() {
    const {until, allBrowserNames, allPlatforms, allErrorIds, specs, commits, loadingProgressElement, commitTiles} = this._context;

    console.time('rendering main');

    const maybeHighlight = this._specFilter ? text => {
      const tokens = text.split(this._specFilter);
      if (tokens.length === 1)
        return text;
      const fragment = html``;
      for (let i = 0; i < tokens.length - 1; ++i) {
        fragment.append(html`${tokens[i] || undefined}`);
        fragment.append(html`
          <span style="${STYLE_SELECTED}">${this._specFilter}</span>
        `);
      }
      fragment.append(html`${tokens[tokens.length - 1]}`);
      return fragment;
    } : text => text;

    const renderSpecRow = (spec) => html`
      <hbox>
        <hbox onclick=${this._selectSpecCommit.bind(this, spec.specId, undefined)} class=hover-darken style="
          ${STYLE_TEXT_OVERFLOW}
          width: 600px;
          min-width: 400px;
          cursor: pointer;
          padding: 0 1em;
          margin-right: 1px;
          align-items: baseline;
          background: white;
        " data-specid="${spec.specId}">
          <span style="overflow: hidden; text-overflow: ellipsis;"><span style="color: #9e9e9e;">${maybeHighlight(spec.file)} - </span>${maybeHighlight(spec.title)}</span>
          <spacer></spacer>
          ${this._renderSpecAnnotations(spec)}
        </hbox>
        ${commitTiles.getAll({specId: spec.specId}).map(commitTile => this._renderCommitTile(commitTile))}
      </hbox>
    `;

    this._mainElement.textContent = '';
    const RENDER_ROWS = Math.min(Math.max(25, 1000 / commits.length), 50);
    this._mainElement.append(html`
      ${this._untilCommitsFilter ? html`
      <div style="
          display: flex;
          align-items: center;
          justify-content: center;
          background-color: ${COLOR_SELECTION};
      ">
        <h4>
          Showing state as of <b style="
            border-bottom: 1px black dashed;
            cursor: pointer;
          "onclick=${this._popover.onClickHandler(() => this._renderCalendar())} >${new Intl.DateTimeFormat("en-US", {month: "long", year: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric',}).format(new Date(this._untilCommitsFilter))}</b>
          <a style="margin-left: 2ex;" href="${amendURL({timestamp: undefined})}">See latest</a>
        </h4>
      </div>
      ` : undefined}

      <div style="padding: 1em;">
        <hbox style="padding-bottom: 1em; border-bottom: 1px solid var(--border-color);">
          <span style="margin-left: 1em;">
            <select style="${this._branchName !== 'master' ? STYLE_SELECTED : ''}" oninput=${e => urlState.amend({branch: e.target.value})}>
              ${this._branches.map(branchName => html`
                <option selected=${this._branchName === branchName} value="${branchName}">${branchName}</option>
              `)}
            </select>
          </span>
          <span style="margin-left: 1em; margin-right: 1em;">
            <select oninput=${e => urlState.amend({commits: e.target.value})}>
              ${[...new Set([2,5,10,15,20,30,50, this._lastCommits])].sort((a, b) => a - b).map(value => html`
                <option value=${value} selected=${value === this._lastCommits}>${value} commits</option>
              `)}
            </select>
          </span>
          <span style="margin-right: 1em; width: ${COMMIT_RECT_SIZE}px;"> ${loadingProgressElement}</span>
          <span style="margin-right: 1em; display: inline-flex; align-items: center;">
            <input checked=${this._showFlaky} oninput=${e => urlState.amend({show_flaky: e.target.checked})} id=show-flaky-input-checkbox type=checkbox>
            <label for=show-flaky-input-checkbox>Show flaky</label>
          </span>
          <span style="margin-right: 1em">
            <input style="${this._specFilter ? STYLE_SELECTED : ''}" type=text placeholder="filter specs" value=${this._specFilter || ''} onkeydown=${e => {
              if (e.key === 'Enter')
                e.target.blur();
            }} onblur=${e => urlState.amend({filter_spec: e.target.value.trim() || undefined})}>
          </span>
          <span style="margin-right: 1em;">
            errorId:
            <select style="${this._errorIdFilter ? STYLE_SELECTED : ''}" oninput=${e => urlState.amend({errorid: e.target.value})}>
                <option selected=${this._errorIdFilter === undefined}} value="any">any</option>
              ${allErrorIds.map(errorId => html`
                <option selected=${this._errorIdFilter === errorId} value="${errorId}">${errorId}</option>
              `)}
            </select>
          </span>
          <span style="margin-right: 1em;">
            <a href="${amendURL({browser: undefined, platform: undefined, errorid: undefined, branch: undefined, filter_spec: undefined})}">Reset All</a>
          </span>
          ${!this._untilCommitsFilter ? html`
          <spacer></spacer>
          <span style="margin-right: 1em;">
            <a href="${amendURL({timestamp: until})}">Permalink</a>
          </span>` : undefined}
        </hbox>
        <hbox style="margin-bottom: 5px; padding-bottom: 1em; border-bottom: 1px solid var(--border-color);">
          ${this._renderFilterChips()}
        </hbox>
        <hbox style="margin-left: 1em;">
          <h2>${specs.size} ${this._specFilter ? '' : 'problematic'} specs</h2>
          <a style="margin-left: 1em; cursor: pointer;" onclick=${this._selectSpecCommit.bind(this, undefined, undefined)}>(summary)</a>
        </hbox>


        <vbox style="margin-bottom: 5px; padding-bottom: 1em; border-bottom: 1px solid var(--border-color);">
        </vbox>


        ${commits.length && specs.size ? html`
        <hbox style="
            border-bottom: 1px solid var(--border-color);
            margin-bottom: 1ex;
            padding-bottom: 4px;
        ">
          <hbox style="width: 600px; min-width: 400px; margin-right: 1px;">
            <spacer></spacer>
            <span style="color: #9e9e9e; margin-right: 1em;">Commits: Newer ${CHAR_RIGHT_ARROW} Older</span>
          </hbox>
          ${commits.map(commit => {
            let color = COLOR_GREY;
            if (commitTiles.has({sha: commit.sha, category: 'bad'}))
              color = COLOR_RED;
            else if (commitTiles.has({sha: commit.sha, category: 'flaky'}))
              color = COLOR_VIOLET;
            else if (commitTiles.has({sha: commit.sha, category: 'good'}))
              color = COLOR_GREEN;
            return svg`
              <svg onclick=${e => this._selectSpecCommit(undefined, commit.sha)}
                   class=hover-darken
                   style="cursor: pointer; margin: 1px; flex: none;"
                   data-commitsha="${commit.sha}"
                   viewbox="0 0 100 100"
                   width="16" height="16">
                <!--<circle cx="50" cy="50" r="50" />-->
                <!-- <path d="M100,100 a1,1 0 0,0 -100,0" fill="${color}" /> -->
                <rect x=0 y=20 width=100 height=60 fill="${color}"/>
              </svg>
            `;
          })}
        </hbox>
        ` : undefined}

        ${specs.slice(0, RENDER_ROWS).map(renderSpecRow)}
        ${specs.size <= RENDER_ROWS ? undefined : html`
          <vbox style="position: relative;">
            <div style="
              height: 80px;
              width: 100%;
              background: linear-gradient(#ffffff00, #ffffff);
              position: absolute;
              pointer-events: none;
              top: -80px;
            "></div>
            <div class=hover-darken onclick=${e => {
              e.target.parentElement.replaceWith(html`${specs.slice(RENDER_ROWS).map(renderSpecRow)}`);
            }} style="
                display: flex;
                align-items: center;
                justify-content: center;
                height: 50px;
                font-size: 12px;
                color: #9e9e9e;
                cursor: pointer;
                background-color: white;
                margin-top: 1em;
            ">Show all ${specs.size} specs</div>
          </vbox>
        `}
      </div>
    `);
    console.timeEnd('rendering main');
  }

  _resolveSelectionToObjects() {
    const commit = this._selection.sha ? this._allCommits.get(this._selection.sha) : undefined;
    const spec = this._selection.specId ? [commit, ...this._allCommits.values()].filter(Boolean).map(({data}) => data.specs().get({specId: this._selection.specId})).filter(Boolean)[0] : undefined;
    return {commit, spec};
  }

  _renderCalendar() {
    const {until} = this._context;

    const today = new Date();
    today.setHours(23, 59, 59, 0);
    const date = new Date(until);
    let selectedDate = new Date(until);
    selectedDate.setDate(1);

    const table = html`<section style="white-space: pre;margin-top: 1ex;"></section>`;

    const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December' ];
    const monthSelector = html`
      <select style="margin-right: 1em;" oninput=${e => {
        selectedDate.setMonth(e.target.value);
        renderTable();
      }}>
        ${months.map((month, index) => html`<option selected=${index === selectedDate.getMonth()} value=${index}>${month}</option>`)}
      </select>
    `;
    const yearSelector = html`<select oninput=${e => {
      selectedDate.setFullYear(e.target.value);
      renderTable();
    }}></select>`;
    for (let i = -10; i <= 10; ++i)
      yearSelector.append(html`<option selected=${i === 0} value=${selectedDate.getFullYear() + i}>${selectedDate.getFullYear() + i}</option>`);

    function renderTable() {
      monthSelector.value = selectedDate.getMonth();
      yearSelector.value = selectedDate.getFullYear();

      const rolling = new Date(selectedDate);
      rolling.setHours(23, 59, 0, 0);
      rolling.setDate(1);
      rolling.setDate(-rolling.getDay());

      table.textContent = '';
      for (let week = 0; week < 6; ++week) {
        const el = html`<div></div>`;
        table.append(el);
        for (let day = 0; day < 7; ++day) {
          rolling.setDate(rolling.getDate() + 1);
          const isSelectable = rolling <= today;
          const clazz = isSelectable ? 'hover-darken' : '';
          el.append(html`
            <a ${isSelectable ? `href=${amendURL({timestamp: +rolling})}` : undefined} class=${clazz} style="
              display: inline-block;
              width: 3em;
              box-sizing: border-box;
              border: 1px solid white;
              text-align: center;
              background: white;
              ${!isSelectable ? 'cursor: not-allowed;' : ''}
              ${rolling.getMonth() !== selectedDate.getMonth() ? 'color: #9e9e9e;' : ''}
              ${rolling.getDate() === date.getDate() && rolling.getFullYear() === date.getFullYear() && rolling.getMonth() === date.getMonth() ? `
                background: #2196f3;
                color: white;
                font-weight: bold;
              ` : ''}
              ${rolling.getDate() === today.getDate() && rolling.getFullYear() === today.getFullYear() && rolling.getMonth() === today.getMonth() ? `
                border: 1px solid black;
              ` : ''}
            ">${rolling.getDate()}</a>
          `);
        }
      }
    }
    renderTable();

    return html`
      <vbox>
        <hbox style='margin-bottom: 1ex;'>
          ${monthSelector}
          ${yearSelector}
          <spacer></spacer>
          <span style="font-size: 16px; user-select: none;">
            <span onclick=${e => { selectedDate.setMonth(selectedDate.getMonth() - 1); renderTable(); }} style="cursor: pointer; padding: 4px;">${CHAR_UP_ARROW}</span>
            <span onclick=${e => { selectedDate.setMonth(selectedDate.getMonth() + 1); renderTable(); }} style="cursor: pointer; padding: 4px;">${CHAR_DOWN_ARROW}</span>
          </span>
        </hbox>
        <div style="user-select: none">
          ${['S', 'M', 'T', 'W', 'T', 'F', 'S'].map(day => html`
            <span style="
              display: inline-block;
              width: 3em;
              text-align: center;
            ">${day}</span>
          `)}
        </div>
        ${table}
        <hbox>
          <spacer></spacer>
          <span onclick=${e => { selectedDate = new Date(today); renderTable(); }} style="cursor: pointer;">Today</span>
        </hbox>
      </vbox>
    `;
  }

  _renderSidebar() {
    if (!split.isSidebarShown(this._mainSplitView))
      return;
    const {commit, spec} = this._resolveSelectionToObjects();
    if (spec)
      this._tabstrip.setTabs([this._editorTab, this._errorsTab]);
    else
      this._tabstrip.setTabs([this._errorsTab]);

    this._renderSummary(commit, spec);
    if (spec)
      this._renderCodeTab(spec);
    this._renderErrorsTab();
  }

  _renderSummary(commit, spec) {
    console.time('rendering summary');
    const {tests, commits} = this._context;

    const commitTimeFormatter = new Intl.DateTimeFormat("en-US", {month: "short", year: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric'});
    let selectionTimeRange = ''
    if (commit)
      selectionTimeRange = commitTimeFormatter.format(new Date(commit.timestamp));
    else if (commits.length)
      selectionTimeRange = commitTimeFormatter.format(new Date(commits[0].timestamp)) + ` ${CHAR_RIGHT_ARROW} ` + commitTimeFormatter.format(new Date(commits[commits.length - 1].timestamp));

    const content = html`
      <vbox style="${STYLE_FILL}; overflow: hidden;">
        <hbox onzrender=${e => split.registerResizer(this._mainSplitView, e)} style="
            ${STYLE_TEXT_OVERFLOW}
            cursor: row-resize;
            flex: none;
            background-color: var(--border-color);
            padding: 2px 1em;
        ">
          <hbox style="flex: auto;">
            <hbox onclick=${() => split.toggleExpand(this._mainSplitView)} style="cursor: pointer; flex: none; margin-right: 1ex;">
              ${svg`
              <svg style="margin-right: 4px;" height="10px" version="1.1" viewBox="8 8 20 20" width="10px">
                <path d="m 10,16 2,0 0,-4 4,0 0,-2 L 10,10 l 0,6 0,0 z"></path>
                <path d="m 20,10 0,2 4,0 0,4 2,0 L 26,10 l -6,0 0,0 z"></path>
                <path d="m 24,24 -4,0 0,2 L 26,26 l 0,-6 -2,0 0,4 0,0 z"></path>
                <path d="M 12,20 10,20 10,26 l 6,0 0,-2 -4,0 0,-4 0,0 z"></path>
              </svg>
              `}
              <div style="font-weight: bold;">Details</div>
            </hbox>
            <spacer></spacer>
            <div style="color: #9e9e9e;">
              ${selectionTimeRange}
            </div>
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

    content.append(html`
      <div style="flex: auto; overflow: auto; padding: 1em; position: relative;">
        <hbox style="margin-bottom: 1em;">
          <vbox style="align-items: flex-end;">
            <div>commit:</div>
            <div>spec:</div>
            <div>test:</div>
          </vbox>
          <vbox style="margin-left: 1ex; align-items: flex-start; overflow: hidden;">
            <div style="${STYLE_TEXT_OVERFLOW}; max-width: 100%;">
              ${commit ? html`
                              <span class=hover-darken onclick=${() => this._selectSpecCommit(this._selection.specId, undefined)} style="cursor: pointer; background: white;">${CHAR_CROSS} </span>
                              <a href="${commit.url}" style="${STYLE_TEXT_OVERFLOW}">
                                ${commit.title} (${commit.author})
                                <away-link style="vertical-align: text-top;"></away-link>
                              </a>
              ` : html`<span style="color: #999;">&lt;summary for ${this._context.commits.length} commits&gt;</span>`}
            </div>
            <div style="${STYLE_TEXT_OVERFLOW}; max-width: 100%;">
              ${spec ? html`
                  <span class=hover-darken onclick=${() => this._selectSpecCommit(undefined, this._selection.sha)} style="cursor: pointer; background: white;">${CHAR_CROSS} </span>
                  <a style="${STYLE_TEXT_OVERFLOW}" href="${spec.url}">
                    ${spec.file} - ${spec.title}
                    <away-link style="vertical-align: text-top;"></away-link>
                  </a>
                ` : html`<span style="color: #999;">&lt;summary for ${this._context.specs.size} specs&gt;</span>`}
            </div>
            <div style="${STYLE_TEXT_OVERFLOW}; max-width: 100%;">
              ${this._selection.testName ? html`
                <span class=hover-darken onclick=${() => this._selectTest(undefined)} style="background: white; cursor: pointer;">${CHAR_CROSS} </span>${this._selection.testName}
              ` : html`<span style="color: #999;">&lt;summary for all tests&gt;</span>`}
            </div>
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
    this._sideElement.textContent = '';
    this._sideElement.append(content);
    console.timeEnd('rendering summary');
  }

  _renderCodeTab(spec) {
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

    let editorTabScrollTop = -1;
    const contentElement = html`<z-widget
      onconnected=${w => editorTabScrollTop === -1 ? scrollToCoords() : w.scrollTop = editorTabScrollTop}
      onscroll=${e => editorTabScrollTop = e.target.scrollTop} style="${STYLE_FILL}; overflow: auto;">
        ${editorSourceLoadingElement}
      </z-widget>
    `;

    this._editorTab.contentElement.textContent = '';
    this._editorTab.contentElement.append(contentElement);

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
      contentElement.textContent = '';
      contentElement.append(html`
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

  _renderFilterChips() {
    const {commits} = this._context;
    const allTestParameters = new Map();
    for (const commit of commits) {
      for (const [name, values] of [...commit.data.testParameters()]) {
        let allValues = allTestParameters.get(name);
        if (!allValues) {
          allValues = new Set();
          allTestParameters.set(name, allValues);
        }
        for (const value of values)
          allValues.add(value);
      }
    }

    // add test parameter filters
    for (const [name, filterValues] of this._testParameterFilters) {
      let allValues = allTestParameters.get(name);
      if (!allValues) {
        allValues = new Set();
        allTestParameters.set(name, allValues);
      }
      for (const filterValue of filterValues.keys())
        allValues.add(filterValue);
    }

    const setTestParameterFilter = (parameterName, parameterValue, predicate) => {
      let allValues = this._testParameterFilters.get(parameterName);
      if (!allValues) {
        allValues = new Map();
        this._testParameterFilters.set(parameterName, allValues);
      }
      if (predicate)
        allValues.set(parameterValue, predicate);
      else
        allValues.delete(parameterValue);
      if (!allValues.size)
        this._testParameterFilters.delete(parameterName);
    }

    const onFilterStripStateChanged = (stripName, stripState) => {
      for (const [value, predicate] of stripState) {
        if (predicate === '+')
          setTestParameterFilter(stripName, value, 'include');
        else if (predicate === '-')
          setTestParameterFilter(stripName, value, 'exclude');
        else
          setTestParameterFilter(stripName, value, undefined);
      }
      urlState.amend({test_parameter_filters: serializeTestParameterFilters(this._testParameterFilters)});
    };

    const createFilterStripState = testParameterName => {
      const state = new Map();
      for (const value of allTestParameters.get(testParameterName)) {
        const predicate = this._testParameterFilters.get(testParameterName)?.get(value);
        state.set(value, {'include': '+', 'exclude': '-'}[predicate]);
      }
      return state;
    };

    const createBoolStripState = testParameterName => {
      const state = new Map();
      const predicate = this._testParameterFilters.get(testParameterName)?.get(true);
      if (predicate === 'include')
        state.set(testParameterName, '+');
      else if (predicate === 'exclude')
        state.set(testParameterName, '-');
      else
        state.set(testParameterName, undefined);
      return state;
    }

    const onBoolFilterStripStateChanged = (stripName, boolState) => {
      for (const [name, value] of boolState) {
        if (value === '+')
          setTestParameterFilter(name, true, 'include');
        else if (value === '-')
          setTestParameterFilter(name, true, 'exclude');
        else
          setTestParameterFilter(name, true, undefined);
      }
      urlState.amend({test_parameter_filters: serializeTestParameterFilters(this._testParameterFilters)});
    }

    let browserNameStrip = null;
    let platformStrip = null;
    const boolStrips = [];
    const otherStrips = [];

    const boolFilterStripState = new Map();
    for (const [name, values] of allTestParameters) {
      if (name === 'browserName') {
        browserNameStrip = createFilterStrip('browserName', createFilterStripState('browserName'), onFilterStripStateChanged);
      } else if (name === 'platform') {
        platformStrip = createFilterStrip('platform', createFilterStripState('platform'), onFilterStripStateChanged);
      } else if (values.has(true) || values.has(false)) {
        boolStrips.push(createFilterStrip(name, createBoolStripState(name), onBoolFilterStripStateChanged));
      } else {
        otherStrips.push(createFilterStrip(name, createFilterStripState(name), onFilterStripStateChanged));
      }
    }

    const stripSorter = (a, b) => {
      if (a.__state.size !== b.__state.size)
        return b.__state.size - a.__state.size;
      return a.__name < b.__name ? -1 : 1;
    }
    boolStrips.sort(stripSorter);
    otherStrips.sort(stripSorter);

    return html`
      <vbox>
        <hbox style="display: flex; flex-wrap: wrap;">${browserNameStrip}</hbox>
        <hbox style="display: flex; flex-wrap: wrap;">${platformStrip}</hbox>
        <hbox style="display: flex; flex-wrap: wrap;">${otherStrips}${boolStrips}</hbox>
      </vbox>
    `;
  }

  //TODO: remove??
  _renderStats() {
    const {allBrowserNames, allPlatforms, prefilteredTests} = this._context;
    const faultySpecCount = (browserName, platform) => new SMap(prefilteredTests.getAll({browserName, platform})).uniqueValues('specId').length;

    const getFilterURL = (browserName, platform) => {
      if (browserName === this._browserFilter && platform === this._platformFilter)
        return amendURL({browser: 'any', platform: 'any'});
      return amendURL({browser: browserName || 'any', platform: platform || 'any'});
    };

    return html`
      <hbox style="flex: none">
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
            <a href="${getFilterURL(browserName, undefined)}">${browserLogo(browserName, 25)}</a>
          </div>
        `)}
        ${allPlatforms.map(platform => html`
          <div style="
              padding: 0 1em;
              border-right: 1px solid var(--border-color);
              background-color: ${platform === this._platformFilter ? COLOR_SELECTION : 'none'};
          ">
            <a href="${getFilterURL(undefined, platform)}">${platform}</a>
          </div>
          ${allBrowserNames.map(browserName => {
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
              "><a style="color: var(--text-color);" href="${getFilterURL(browserName, platform)}">${faultySpecCount(browserName, platform) || CHAR_MIDDLE_DOT}</a></div>
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

  _renderCommitTile(commitTile) {
    const color = {
      '': COLOR_GREY,
      'bad': COLOR_RED,
      'flaky': COLOR_VIOLET,
      'good': COLOR_GREEN,
    }[commitTile.category];

    return svg`
      <svg class=hover-darken style="cursor: pointer; flex: none; margin: 1px;" width="${COMMIT_RECT_SIZE}" height="${COMMIT_RECT_SIZE}"
           data-specid="${commitTile.specId || ''}"
           data-commitsha="${commitTile.sha}"
           onclick=${this._selectSpecCommit.bind(this, commitTile.specId, commitTile.sha)}
           viewbox="0 0 14 14">
        <rect x=0 y=0  width=14 height=14 fill="${color}"/>
      </svg>
    `;
  }

  _renderErrorsTab() {
    const {tests} = this._context;

    const viewTests = tests.getAll({sha: this._selection.sha, specId: this._selection.specId, name: this._selection.testName});
    const runsWithErrors = viewTests.map(test => test.errors.map(error => ({
      test,
      error,
      stackId: error.errorId,
    }))).flat();

    if (!runsWithErrors.length) {
      this._errorsTab.titleElement.textContent = `Errors: 0`;
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

    if (this._errorIdFilter)
      this._errorsTab.titleElement.textContent = `Error: ${this._errorIdFilter}`;
    else
      this._errorsTab.titleElement.textContent = `Errors: ${stackIdToInfo.size}`;
    this._errorsTab.contentElement.textContent = '';

    const stackInfosToRender = [...stackIdToInfo.values()].sort((info1, info2) => {
      if (info1.specIds.size !== info2.specIds.size)
        return info2.specIds.size - info1.specIds.size;
      if (info1.commitSHAs.size !== info2.commitSHAs.size)
        return info2.commitSHAs.size - info1.commitSHAs.size;
      return info2.errors.length - info1.errors.length;
    });

    const renderStackInfo = ({stackId, specIds, commitSHAs, errors}, index) => html`
      <h3 style="
        display: flex;
        align-items: center;
      ">${stackId !== this._errorIdFilter ? index + 1 + ') ' : html`<span class=hover-darken style="background: white; cursor: pointer;" onclick=${() => urlState.amend({errorid: undefined})}>${CHAR_CROSS} </span>selected `}error: ${stackId === this._errorIdFilter ? html`${stackId}` : html`
          <a href="${amendURL({errorid: stackId})}">${stackId}</a>
        `}</h3>
      <div style="margin-left: 1em;">
        <div style="margin-left: 1em; margin-bottom: 1em;">
          ${!this._selection.specId && html`<div>different specs: ${specIds.size}</div>`}
          ${!this._selection.sha && html`<div>different commits: ${commitSHAs.size}</div>`}
          <div>occurrences: ${errors.length}</div>
        </div>
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
    `;
    const STACKINFOS_TO_RENDER = 10;

    this._errorsTab.contentElement.append(html`
      ${stackInfosToRender.slice(0, STACKINFOS_TO_RENDER).map((stackInfo, index) => renderStackInfo(stackInfo, index))};
      ${stackInfosToRender.length < STACKINFOS_TO_RENDER ? undefined : html`
        <vbox style="position: relative;">
          <div style="
            height: 80px;
            width: 100%;
            background: linear-gradient(#ffffff00, #ffffff);
            position: absolute;
            pointer-events: none;
            top: -80px;
          "></div>
          <div class=hover-darken onclick=${e => {
            e.target.parentElement.replaceWith(html`${stackInfosToRender.slice(STACKINFOS_TO_RENDER).map((stackInfo, index) => renderStackInfo(stackInfo, index + STACKINFOS_TO_RENDER))}`);
          }} style="
              display: flex;
              align-items: center;
              justify-content: center;
              height: 50px;
              font-size: 12px;
              color: #9e9e9e;
              cursor: pointer;
              background-color: white;
              margin-top: 1em;
          ">Show all ${stackInfosToRender.length} errors</div>
        </vbox>
      `}
    `);
  }
}

function getTestCategory(test) {
  const hasGoodRun = test.runs[test.expectedStatus] > 0;
  const hasBadRun = (test.expectedStatus !== 'failed' && test.runs.failed > 0) || (test.expectedStatus !== 'timedOut' && test.runs.timedOut > 0);
  if (hasGoodRun && hasBadRun)
    return 'flaky';
  if (hasBadRun)
    return 'bad';
  return 'good';
}

function getTestName(test) {
  const browserName = test.parameters.browserName || 'N/A';
  const browserVersion = test.parameters.browserVersion || '';
  const platform = test.parameters.platform;
  const prefix = browserName && browserVersion ? browserName + ' ' + browserVersion : browserName;
  return [prefix, platform, ...Object.entries(test.parameters).filter(([key, value]) => !!value && key !== 'platform' && key !== 'browserName' && key !== 'browserVersion').map(([key, value]) => {
    if (typeof value === 'string')
      return value;
    if (typeof value === 'boolean')
      return key;
    return `${key}=${value}`;
  })].join(' / ');
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

function createFilterStrip(stripName, state, onFilterStateChanged = (stripName, state) => {}) {
  const onChipClick = (event, isRightClick, chipName) => {
    consumeDOMEvent(event);
    const newPredicate = event.altKey || isRightClick ? '-' : '+';
    const currentPredicate = state.get(chipName);

    if (!event.ctrlKey && !event.metaKey) {
      for (const name of state.keys())
        state.set(name, null);
    }
    if (currentPredicate !== newPredicate)
      state.set(chipName, newPredicate);
    else
      state.set(chipName, null);
    onFilterStateChanged(stripName, state);
  };

  const onFieldsetTitleClick = (event) => {
    consumeDOMEvent(event);
    for (const name of state.keys())
      state.set(name, null);
    onFilterStateChanged(stripName, state);
  };

  const hasEnabledFilters = [...state.values()].some(Boolean);
  const element = html`
    <fieldset class=filter-strip style="display: flex; border: 1px solid #e0e0e0; padding: 4px; align-items: center; margin: 0 10px;">
      <legend style="${ hasEnabledFilters ? 'cursor: pointer;' : '' }" onclick=${onFieldsetTitleClick}><span style="visibility: ${hasEnabledFilters ? 'visible;' : 'hidden;'}">${CHAR_CROSS} </span>${stripName}</legend>
      ${[...state.keys()].sort().map(chipName => html`
        <span
          onclick=${(e) => onChipClick(e, false /* isRightClick */, chipName)}
          oncontextmenu=${(e) => onChipClick(e, true /* isRightClick */, chipName)}
          style="
            user-select: none;
            white-space: nowrap;
            border: 1px solid ${{'+': 'green', '-': 'red'}[state.get(chipName)] || '#9e9e9e'};
            background-color: ${{'+': '#c8e6c9', '-': '#f8bbd0'}[state.get(chipName)] || '#f5f5f5'};
            padding: 1px 4px;
            margin: 0 2px;
            cursor: pointer;
        ">${chipName}</span>
      `)}
    </fieldset>
  `;

  element.__name = stripName;
  element.__state = state;
  return element;
}

class TabStrip {
  constructor() {
    this._tabContainer = html`
      <div style="
          flex: none;
          display: flex;
      "></div>
    `;
    this._widgetContainer = html`<div style="flex: none;"></div>`;
    this._strip = html`
      <hbox style="
          background: var(--border-color);
          justify-content: space-between;
          cursor: row-resize;
      ">
        ${this._tabContainer}
        ${this._widgetContainer}
      </hbox>
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

    this._selectedTab = null;
    this._tabs = new Map();
  }

  setRightWidget(element) {
    this._widgetContainer.textContent = '';
    this._widgetContainer.append(element);
  }

  tabstripElement() {
    return this._strip;
  }

  setTabs(tabs) {
    this._tabContainer.textContent = '';
    const toBeSelected = tabs.find(tab => tab.contentElement.isConnected) || tabs[0];
    for (const tab of tabs) {
      const tabElement = html`
        <span class=hover-lighten style="
          user-select: none;
          padding: 2px 1em;
          cursor: pointer;
          display: inline-block;
          white-space: pre;
          flex: none;
          background-color: ${toBeSelected === tab ? 'white' : 'none'};
        ">${tab.titleElement}</span>
      `;
      tabElement.onclick = this._onTabClicked.bind(this, tab);
      this._tabs.set(tab, {tabElement});
      this._tabContainer.append(tabElement);
    }
    this.selectTab(toBeSelected);
  }

  _onTabClicked(tab, event) {
    if (this.selectTab(tab))
      consumeDOMEvent(event);
  }

  selectTab(tab) {
    if (this._selectedTab === tab)
      return false;
    if (this._selectedTab)
      this._tabs.get(this._selectedTab).tabElement.style.setProperty('background-color', 'var(--border-color)');
    this._selectedTab = tab;
    this._content.textContent = '';
    if (this._selectedTab) {
      this._tabs.get(this._selectedTab).tabElement.style.setProperty('background-color', 'white');
      this._content.append(tab.contentElement);
    }
    return true;
  }
}

function deserializeTestParameterFilters(string) {
  try {
    const json = JSON.parse(string);
    const result = new Map();
    for (const [name, valueFilters] of json)
      result.set(name, new Map(valueFilters));
    return result;
  } catch (e) {
    return new Map();
  }
}

function serializeTestParameterFilters(testParameterFilters) {
  const result = [];
  for (const [name, valueFilters] of testParameterFilters)
    result.push([name, [...valueFilters]]);
  return JSON.stringify(result);
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
