import {html, svg} from './zhtml.js';
import {humanReadableDate, browserLogoURL, browserLogo, commitURL, highlightANSIText} from './misc.js';
import {consumeDOMEvent} from './utils.js';
import {SortButton, ExpandButton, FilterConjunctionGroup, Popover} from './widgets.js';
import {cronjobBadgesHeader} from './cronjobs.js';
import {SMap} from './smap.js';
import {split} from './split.js';
import {rateLimitedFetch, fetchProgress} from './fetch-extras.js';
import {highlightText, preloadHighlighter} from './codehighlight.js';

const CHAR_MIDDLE_DOT = '·';
const CHAR_BULLSEYE = '◎';
const CHAR_WARNING = '⚠';
const CHAR_CROSS = '✖';

const COMMIT_RECT_SIZE = 16;

const COLOR_YELLOW = '#ffcc80';
const COLOR_GREEN = '#a5d6a7';
const COLOR_RED = '#ef9a9a';
const COLOR_VIOLET = '#ce93d8';
const COLOR_GREY = '#eeeeee';
const STYLE_FILL = 'position: absolute; left: 0; top: 0; right: 0; bottom: 0;';

const testRunColors = {
  'passed': COLOR_GREEN,
  'failed': COLOR_RED,
  'timedOut': COLOR_YELLOW,
  'skipped': COLOR_GREY,
};

const cronjobsHeader = cronjobBadgesHeader();

const popover = new Popover(document);
document.documentElement.addEventListener('click', () => popover.hide(), false);

const useMockdata = true;
const URLs = {
  dashboardURL(sha) {
    if (useMockdata)
      return `/mockdata/${sha}.json`;
    return `https://folioflakinessdashboard.blob.core.windows.net/dashboards/raw/${sha}.json`;
  },

  commitsURL() {
    if (useMockdata)
      return `/mockdata/commits.json`;
    return 'https://api.github.com/repos/microsoft/playwright/commits?per_page=100';
  },

  sourceURL(sha, testFile) {
    if (useMockdata)
      return `/mockdata/page-basic.spec.ts`;
    return `https://raw.githubusercontent.com/microsoft/playwright/${sha}/test/${testFile}`;
  },
};

class CommitData {
  constructor(sha, onLoadCallback) {
    this._sha = sha;

    this._progressIndicator = html`<span style="
      display: flex;
      align-items: center;
      justify-content: center;
      flex: none;
      width: ${COMMIT_RECT_SIZE};
      height: ${COMMIT_RECT_SIZE};
      margin: 1px;
    ">${svgPie({ratio: 0})}</span>`;
    this._loadingPromise = null;
    this._onLoadCallback = onLoadCallback;

    this._specs = new SMap();
    this._tests = new SMap();
  }

  specs() { return this._specs; }
  tests() { return this._tests; }
  loadingIndicator() { return this._progressIndicator; }

  async ensureLoaded() {
    if (!this._loadingPromise)
      this._loadingPromise = this._loadData();
    await this._loadingPromise;
  }

  _onLoadProgress(received, total, isComplete) {
    this._progressIndicator.textContent = '';
    // Experimentally it turns out that compression ratio is ~19 for JSON reports.
    const COMPRESSION_RATIO = 19;
    const ratio = isComplete ? 1 : received / total / COMPRESSION_RATIO;
    this._progressIndicator.append(svgPie({ratio}));
  }

  async _loadData() {
    const {json, error} = await fetchProgress(URLs.dashboardURL(this._sha), this._onLoadProgress.bind(this))
      .then(text => ({json: JSON.parse(text)}))
      .catch(error => ({error}));
    if (error) {
      this._progressIndicator.textContent = '';
      this._progressIndicator.append(html`
        <span style="cursor: help;" title="${error}">${CHAR_WARNING}</span>
      `);
      return;
    }
    this._progressIndicator.textContent = '';

    // All specs are sorted by filename/line/column location.
    // const specs = json.map(report => flattenSpecs(report)).flat();
    const specs = [];
    const tests = [];
    for (const report of json) {
      for (const spec of flattenSpecs(report)) {
        const specId = spec.file + '---' + spec.title;
        const specObject = {
          specId,
          sha: this._sha,
          file: spec.file,
          title: spec.title,
          line: spec.line,
          column: spec.column,
        };
        specs.push(specObject);
        for (const test of spec.tests || []) {
          if (test.runs.length === 1 && !test.runs[0].status)
            continue;
          // Overwrite test platform parameter with a more specific information from
          // build run.
          test.parameters.platform = report.metadata.osName + ' ' + report.metadata.osVersion;
          if (test.parameters.platform.toUpperCase().startsWith('MINGW'))
            test.parameters.platform = 'Windows';
          tests.push({
            specId,
            url: report.metadata.runURL,
            spec: specObject,
            sha: this._sha,
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
    }
    specs.sort((s1, s2) => {
      if (s1.file !== s2.file)
        return s1.file < s2.file ? -1 : 1;
      return s1.line - s2.line || s1.column - s2.column;
    });
    this._specs = new SMap(specs);
    this._tests = new SMap(tests);
    this._onLoadCallback.call(null);
  }
}

class DashboardData {
  static async create() {
    const commits = await rateLimitedFetch(URLs.commitsURL()).then(text => JSON.parse(text)).then(commits => commits.map(c => {
      c.commit.committer.date = +new Date(c.commit.committer.date);
      return c;
    }).sort((c1, c2) => c2.commit.committer.date - c1.commit.committer.date));
    return new DashboardData(commits);
  }

  constructor(commits) {
    this._commits = commits.map(c => ({
      sha: c.sha,
      author: c.commit.author.name,
      email: c.commit.author.email,
      message: c.commit.message,
      timestamp: c.commit.committer.date,
      data: new CommitData(c.sha, () => this._render()),
    }));

    this._fileContentsCache = new Map();
    this._mainElement = html`<section style="overflow: auto;${STYLE_FILL}"></section>`;
    this._sideElement = html`<section style="padding: 1em; overflow: auto;${STYLE_FILL}"></section>`;
    this._secondSideElement = html`<vbox style="${STYLE_FILL}"></vbox>`;

    this._selectedCommit = null;

    const doCloseSidebar = () => {
      split.hideSidebar(this._splitView);
      this._selectedCommit = null;
      this._render();
    };

    this._splitView = split.bottom({
      main: this._mainElement,
      sidebar: html`
        ${split.right({
          main: this._sideElement,
          sidebar: this._secondSideElement,
          hidden: false,
          size: 700,
        })}
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
    this.element = this._splitView;

    this._lastCommits = 20;
    this._lastCommitsSelect = html`
      <select oninput=${e => {
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
      </select>
    `;
    this._render();
  }

  _render() {
    const self = this;
    const commits = this._commits.slice(0, this._lastCommits);
    for (const commit of commits)
      commit.data.ensureLoaded();

    const faultySpecIds = new SMap(commits.map(commit => [
      ...commit.data.tests().getAll({category: 'bad'}),
      ...commit.data.tests().getAll({category: 'flaky'}),
    ]).flat()).uniqueValues('specId');
    const tests = new SMap(commits.map(commit => {
      return faultySpecIds.map(specId => commit.data.tests().getAll({specId})).flat();
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

    const tabstrip = new TabStrip();

    renderMainElement.call(self);

    function renderMainElement() {
      console.time('rendering');
      this._mainElement.textContent = '';
      this._mainElement.append(html`
        ${cronjobsHeader}
        <div style="padding: 1em;">
          <hbox>
            ${renderStats()}
            <div>
              Showing last ${this._lastCommitsSelect} commits
            </div>
          </hbox>
          <hbox>
            <div style="width: 600px; margin-right: 1em;">
            <h3>Showing ${specs.size} specs</h3>
            </div>
            ${commits.map(commit => commit.data.loadingIndicator())}
          </hbox>
          ${specs.map(spec => html`
            <hbox>
              ${renderSpecTitle(spec)}
              ${commits.map(commit => renderSpecCommit(spec, commit))}
            </hbox>
          `)}
        </div>
      `);
      console.timeEnd('rendering');
    }

    function renderStats() {
      const platforms = tests.uniqueValues('platform').sort();
      const browserNames = tests.uniqueValues('browserName').filter(Boolean).sort();

      const faultySpecCount = (browserName, platform) => new SMap([
        ...tests.getAll({category: 'bad', browserName, platform}),
        ...tests.getAll({category: 'flaky', browserName, platform}),
      ]).uniqueValues('specId').length;

      return html`
        <div style="
          display: grid;
          grid-template-rows: ${'auto '.repeat(platforms.length + 1).trim()};
          grid-template-columns: ${'auto '.repeat(browserNames.length + 1).trim()};
          border: 1px solid var(--border-color);
        ">
          <div style="
              border-right: 1px solid var(--border-color);
              border-bottom: 1px solid var(--border-color);
            "></div>
          ${browserNames.map(browserName => html`
            <div style="padding: 4px 1em; border-bottom: 1px solid var(--border-color);">${browserLogo(browserName, 18)}</div>
          `)}
          ${platforms.map(platform => html`
            <div style="padding: 0 1em; border-right: 1px solid var(--border-color);">${platform}</div>
            ${browserNames.map(browserName => html`
              <div style="text-align: center; padding: 0 1em">${faultySpecCount(browserName, platform) || CHAR_MIDDLE_DOT}</div>
            `)}
          `)}
        </div>
      `;
    }

    function renderSpecTitle(spec) {
      return html`
        <hbox style="
          width: 600px;
          margin-right: 1em;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
          align-items: baseline;
        ">
          <span style="overflow: hidden; text-overflow: ellipsis;">${spec.file} - ${spec.title}</span>
          <spacer></spacer>
          ${renderSpecAnnotations(spec)}
        </hbox>
      `;
    }

    function renderSpecAnnotations(spec) {
      const annotations = tests.getAll({specId: spec.specId, sha: spec.sha}).map(test => test.annotations).flat();
      const types = new SMap(annotations).uniqueValues('type').sort();
      return html`<hbox style="align-self: center;">${types.map(renderAnnotation)}</hbox>`;
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
      let color = COLOR_GREY;

      const categories = new Set(tests.getAll({specId: spec.specId, sha: commit.sha}).map(test => test.category));
      if (categories.has('bad'))
        color = COLOR_RED;
      else if (categories.has('flaky'))
        color = COLOR_VIOLET;
      else if (categories.size || commit.data.specs().has({specId: spec.specId}))
        color = COLOR_GREEN;

      const clazz = spec.specId === self._selectedCommit?.specId && commit.sha === self._selectedCommit?.sha ? 'selected-commit' : undefined;

      return svg`
        <svg class="${clazz} hover-darken" style="cursor: pointer; flex: none; margin: 1px;" width="${COMMIT_RECT_SIZE}" height="${COMMIT_RECT_SIZE}"
             onclick=${event => renderSidebarSpecCommit.call(self, spec, commit)}
             viewbox="0 0 14 14">
          <rect x=0 y=0 width=14 height=14 fill="${color}"/>
        </svg>
      `;
    }

    function renderSidebarSpecCommit(spec, commit) {
      this._selectedCommit = {
        specId: spec.specId,
        sha: commit.sha,
      };
      renderMainElement.call(self);

      renderSecondSidebar.call(self, commit, spec);
      this._sideElement.textContent = '';
      this._sideElement.append(html`
        <vbox>
          <div style="
              margin-bottom: 1em;
              white-space: nowrap;
              overflow: hidden;
              text-overflow: ellipsis;
          ">
            <a href="${commitURL('playwright', commit.sha)}" class=sha>${commit.sha.substring(0, 7)}</a> ${commit.message}
          </div>
          <hbox style="border-bottom: 1px solid var(--border-color); margin-bottom: 4px;">
            <div style="margin-left: 1em; width: 420px; text-align: center;">test parameters</div>
            <div style="width: 100px; text-align: center;">runs</div>
            <div style="width: 100px; text-align: center;">expected</div>
          </hbox>
          ${tests.getAll({sha: commit.sha, specId: spec.specId}).sort((t1, t2) => {
            const categoryScore = {
              'bad': 0,
              'flaky': 1,
              'good': 2,
            };
            if (t1.category !== t2.category)
              return categoryScore[t1.category] - categoryScore[t2.category];
            if (t1.annotations.length !== t2.annotations.length)
              return t2.annotations.length - t1.annotations.length;
            if (t1.name !== t2.name)
              return t1.name < t2.name ? -1 : 1;
            return 0;
          }).map(test => html`
            <hbox class="hover-darken" style="background-color: white; cursor: pointer;" onclick=${() => addTestTab(test)}>
              <div style="
                width: 300px;
                margin-left: 1em;
                overflow: hidden;
                text-overflow: ellipsis;
                white-space: nowrap;
              "><span>${test.name}</span><a href="${test.url}"></a></div>
              <div style="width: 120px;">${test.annotations.map(a => renderAnnotation(a.type))}</div>
              <div style="width: 100px; text-align: center;">
                ${test.runs.map(run => renderTestStatus(run.status))}
              </div>
              <div style="width: 100px; text-align: center;">
                ${renderTestStatus(test.expectedStatus)}
              </div>
            </hbox>
          `)}
        </vbox>
      `);
      split.showSidebar(this._splitView);
    }

    function addTestTab(test) {
      let tab = tabstrip.tabWithName(test.name);
      if (tab) {
        tabstrip.selectTab(tab);
        return;
      }

      tabstrip.addTab({
        name: test.name,
        selected: true,
        closable: true,
        contentElement: html`
          <section style="
            display: flex;
            flex-direction: column;
            flex: auto;
            padding: 1em;
            white-space: pre;
            font-family: var(--monospace);
            overflow: auto;
          ">
            <h2>${test.name}</h2>
            ${test.runs.map((run, index) => renderTestRun(test, run, index))}
          </section>
        `,
      });
    }

    function renderTestRun(test, run, index) {
      return html`
        <h3 style="display: flex;align-items: center;">${renderTestStatus(run.status, 12)} Run #${index + 1} - ${run.status}</h3>
        ${run.error && html`
          <pre style="
            background-color: #333;
            color: #eee;
            padding: 1em;
            overflow: auto;
          ">${highlightANSIText(run.error.stack)}</pre>
        `}
      `;
    }

    function renderSecondSidebar(commit, spec) {
      spec = commit.data.specs().get({specId: spec.specId});
      if (!spec)
        return;

      const gutter = html`<div></div>`;
      const scrollToCoords = () => {
        gutter.$(`[x-line-number="${spec.line}"]`)?.scrollIntoView({block: 'center'});
      };

      const editorElement = html`<section style="${STYLE_FILL}; overflow: auto;"></section>`;
      tabstrip.removeAllTabs();
      tabstrip.addTab({
        name: `${spec.file}:${spec.line}`,
        contentElement: editorElement,
        selected: true,
        onSelected: scrollToCoords,
      });

      this._secondSideElement.textContent = '';
      this._secondSideElement.append(tabstrip.element);

      const editorSourceLoadingElement = html`<div></div>`;
      setTimeout(() => editorSourceLoadingElement.textContent = 'Loading...', 777);
      editorElement.append(editorSourceLoadingElement);

      const cacheKey = JSON.stringify({sha: commit.sha, file: spec.file});
      let textPromise = this._fileContentsCache.get(cacheKey);
      if (!textPromise) {
        textPromise = fetch(URLs.sourceURL(commit.sha, spec.file)).then(r => r.text());
        this._fileContentsCache.set(cacheKey, textPromise);
      }

      preloadHighlighter('text/typescript');

      textPromise.then(async text => {
        const lines = await highlightText(text, 'text/typescript');
        const digits = (lines.length + '').length;
        const STYLE_SELECTED = 'background-color: #fff9c4;';
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
        editorElement.textContent = '';
        editorElement.append(html`
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
  }
}

export async function renderFlakiness() {
  const data = await DashboardData.create();
  return data.element;
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
  const hasBadRun = test.runs.some(run => run.status !== test.expectedStatus && run.status && run.status !== 'skipped');
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

function svgPie({ratio, color = COLOR_GREEN, size = COMMIT_RECT_SIZE}) {
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

function renderTestStatus(status, size=10) {
  return svg`
    <svg style="margin: 1px;" width=${size} height=${size} viewbox="0 0 10 10">
      <circle cx=5 cy=5 r=5 fill="${testRunColors[status] || 'blue'}">
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

class TabStrip {
  constructor() {
    this._strip = html`
      <div style="
          background-color: var(--border-color);
          border-bottom: 1px solid var(--border-color);
          flex: none;
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

    this._selectedTab = null;
    this._tabs = new Map();
  }

  removeAllTabs() {
    this._tabs.clear();
    this._strip.textContent = '';
    this._content.textContent = '';
  }

  addTab({name, contentElement, selected = false, onSelected = () => {}, closable = false}) {
    const tab = html`
      <span class=hover-lighten style="
        padding: 2px 10px;
        cursor: pointer;
        display: inline-block;
        background-color: ${selected ? 'white' : 'none'};
      ">${name}</span>
    `;
    if (closable) {
      tab.append(html`
        <span onclick=${event => {this.removeTab(tab); consumeDOMEvent(event); }}> ${CHAR_CROSS} </span>
      `);
    }
    tab.onclick = this._onTabClicked.bind(this, tab);
    this._tabs.set(tab, {
      name, contentElement, onSelected, closable
    });
    this._strip.append(tab);
    if (selected)
      this.selectTab(tab);
    return tab;
  }

  removeTab(tab) {
    if (tab === this._selectedTab) {
      if (tab.nextSibling) {
        this.selectTab(tab.nextSibling);
      } else if (tab.previousSibling) {
        this.selectTab(tab.previousSibling);
      } else {
        this._selectedTab = null;
        this._content.textContent = '';
      }
    }
    tab.remove();
    this._tabs.delete(tab);
  }

  _onTabClicked(tab, event) {
    this.selectTab(tab);
    this._tabs.get(tab).onSelected.call(null);
  }

  selectTab(tab) {
    if (this._selectedTab === tab)
      return;
    if (this._selectedTab)
      this._selectedTab.style.setProperty('background-color', 'var(--border-color)');
    this._selectedTab = tab;
    if (this._selectedTab)
      this._selectedTab.style.setProperty('background-color', 'white');
    this._content.textContent = '';
    this._content.append(this._tabs.get(tab).contentElement);
    this._tabs.get(tab).onSelected.call(null);
  }

  tabWithName(name) {
    const result = [...this._tabs.entries()].find(([tab, info]) => info.name === name);
    return result ? result[0]: null;
  }

  setText(tab, text) {
    tab.textContent = text;
  }
}
