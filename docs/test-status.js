import {html, svg} from './zhtml.js';
import {humanReadableTimeInterval, browserLogoURL, browserLogo} from './misc.js';
import {SortButton, ExpandButton} from './widgets.js';

export async function fetchTestStatus() {
  return fetch('https://raw.githubusercontent.com/aslushnikov/devops.aslushnikov.com/datastore--test-status/status.json').then(r => r.json()).then(json => {
    for (const entry of json) {
      entry.tests.sort((t1, t2) => {
        if (t1.filepath !== t2.filepath)
          return t1.filepath < t2.filepath ? -1 : 1;
        return t1.line - t2.line;
      });
    }
    return json;
  });
}

export function renderTestStatusPreview(entries) {
  const cdnData = entries[entries.length - 1];
  return html`
    <section class=test-status>
      <hbox class=header>
        <h2>Test Status</h2>
        <spacer></spacer>
        <div>(updated ${humanReadableTimeInterval(Date.now() - cdnData.timestamp)} ago)</div>
      </hbox>
      <a href="/test-status-details.html">
        <section class=body>
          <hbox>
          <spacer></spacer>
          ${renderChart(perBrowserTests(cdnData.tests))}
          <spacer></spacer>
          </hbox>
        </section>
      </a>
    </section>
  `;
}

export function renderTestStatusDetails(entries) {
  const cdnData = entries[entries.length - 1];
  const tests = cdnData.tests;
  const filepathToTests = [...perFileTests([...tests])];

  const N = Math.min(...tests.map(test => test.filepath.length));
  let commonPathPrefix = 0;
  for (commonPathPrefix = 0; commonPathPrefix < N; ++commonPathPrefix) {
    const char = tests[0].filepath.charAt(commonPathPrefix);
    if (!tests.every(test => test.filepath.charAt(commonPathPrefix) === char))
      break;
  }

  const expandedFilepaths  = new Set();
  const toggleFilePath = (filepath) => {
    if (expandedFilepaths.has(filepath))
      expandedFilepaths.delete(filepath);
    else
      expandedFilepaths.add(filepath);
    rerenderGrid();
  };

  const toggleTestsVisibility = (tests, {open}) => {
    for (const test of tests) {
      if (open)
        expandedFilepaths.add(test.filepath);
      else
        expandedFilepaths.delete(test.filepath);
    }
    rerenderGrid();
  };

  let currentSortButton = null;
  const sortAlphabetically = ({direction, target}) => {
    if (currentSortButton && target !== currentSortButton)
      currentSortButton.setDirection(0);
    currentSortButton = target;
    filepathToTests.sort(([f1, tests1], [f2, tests2]) => {
      if (f1 !== f2)
        return (f1 < f2 ? -1 : 1) * direction;
      return 0;
    });
    rerenderGrid();
  }
  const sortByBrowser = (browserName, {direction, target}) => {
    if (currentSortButton && target !== currentSortButton)
      currentSortButton.setDirection(0);
    currentSortButton = target;
    filepathToTests.sort(([f1, tests1], [f2, tests2]) => {
      const r1 = browserTests(tests1, browserName).length / cdnData.stats[f1];
      const r2 = browserTests(tests2, browserName).length / cdnData.stats[f2];
      return (r2 - r1) * direction;
    });
    rerenderGrid();
  }

  const alphabeticalSortButton = new SortButton(sortAlphabetically);
  const expandAllButton = new ExpandButton(toggleTestsVisibility.bind(null, tests));

  const browserSortButtons = {
    chromium: new SortButton(sortByBrowser.bind(null, 'chromium')),
    firefox: new SortButton(sortByBrowser.bind(null, 'firefox')),
    webkit: new SortButton(sortByBrowser.bind(null, 'webkit')),
  };
  const browserExpandButtons = {
    chromium: new ExpandButton(toggleTestsVisibility.bind(null, browserTests(tests, 'chromium'))),
    firefox: new ExpandButton(toggleTestsVisibility.bind(null, browserTests(tests, 'firefox'))),
    webkit: new ExpandButton(toggleTestsVisibility.bind(null, browserTests(tests, 'webkit'))),
  };

  let grid = renderGrid();
  return html`<section class="test-status-details">${grid}</section>`;

  function rerenderGrid() {
    const newGrid = renderGrid();
    grid.replaceWith(newGrid);
    grid = newGrid;
  }

  function renderGrid() {
    const COLLAPSED_CHAR = '▶';
    const EXPANDED_CHAR = '▼';
    const browserNames = ['chromium', 'webkit', 'firefox'];

    return html`
      <section>
        <!-- header row -->
        <grid-row class=titlerow>
          <grid-cell class=cell-filepath>
            <h4>
              ${expandAllButton}
              ${alphabeticalSortButton}
            </h4>
          </grid-cell>
          ${browserNames.map(browserName => html`
            <grid-cell class=cell-browser>
              <div>${browserLogo(browserName)}</div>
              <h4>
                ${browserTests(tests, browserName).length} tests
                ${browserSortButtons[browserName]}
              </h4>
            </grid-cell>
          `)}
        </grid-row>


        ${filepathToTests.map(([filepath, tests]) => html`
          <grid-row class=filepathrow onclick=${toggleFilePath.bind(null, filepath)}>
            <grid-cell class=cell-filepath>
              ${expandedFilepaths.has(filepath) ? EXPANDED_CHAR : COLLAPSED_CHAR} ${filepath.substring(commonPathPrefix)}
            </grid-cell>

            ${browserNames.map(browserName => html`
              <grid-cell class=cell-browser>
                <hbox>
                  ${browserTests(tests, browserName).length ? html`
                    <span class=total-bad-tests>${browserTests(tests, browserName).length}</span>
                    <span class=total-tests>/${cdnData.stats[filepath]}</span>
                  ` : '·'}
                </hbox>
              </grid-cell>
            `)}
          </grid-row>

          ${expandedFilepaths.has(filepath) && tests.map(test => html`
            <grid-row class=testrow>
              <grid-cell class=cell-filepath>
                <a class=testname href="https://github.com/microsoft/playwright/blob/${cdnData.commit.sha}/${filepath}#L${test.line}">${test.line}: ${test.title}</a>
              </grid-cell>

              ${browserNames.map(browserName => html`
                <grid-cell class=cell-browser>
                  ${[...test.flaky, ...test.fixme, ...test.fail].includes(browserName) ? html`
                    ${test.flaky.includes(browserName) && html`<strong class=flaky>flaky</strong>`}
                    ${test.fixme.includes(browserName) && html`<strong class=fixme>fixme</strong>`}
                    ${test.fail.includes(browserName) && html`<strong class=fail>fail</strong>`}
                  `: '·'}
                </grid-cell>
              `)}
            </grid-row>
          `)}
        `)}
      </section>
    `;
  }
}

function browserTests(tests, browserName) {
  browserName = browserName.toLowerCase();
  return tests.filter(test => [...test.flaky, ...test.fixme, ...test.fail].includes(browserName));
}

function perBrowserTests(tests) {
  const testsPerBrowser = {
    firefox: new Set(),
    webkit: new Set(),
    chromium: new Set(),
  };
  for (const test of tests) {
    for (const b of [...test.flaky, ...test.fixme, ...test.fail])
      testsPerBrowser[b].add(test);
  }
  return testsPerBrowser;
}

function perFileTests(tests) {
  const result = new Map();
  for (const test of tests) {
    let bucket = result.get(test.filepath);
    if (!bucket) {
      bucket = [];
      result.set(test.filepath, bucket);
    }
    bucket.push(test);
  }
  return result;
}

function renderChart(testsPerBrowser, chartWidth = 250) {
  const chartData = [
    {
      imgsrc: browserLogoURL('firefox'),
      sortkey: testsPerBrowser.firefox.size,
    },
    {
      imgsrc: browserLogoURL('webkit'),
      sortkey: testsPerBrowser.webkit.size,
    },
    {
      imgsrc: browserLogoURL('chromium'),
      sortkey: testsPerBrowser.chromium.size,
    },
  ];
  chartData.sort((a, b) => a.sortkey - b.sortkey);
  for (const d of chartData)
    d.text = d.sortkey + ' tests';
  const BAR_WIDTH = 250;
  const BAR_HEIGHT = 200;
  const IMG_SIZE = 125;
  const IMG_PADDING = 20;

  const BORDER_WIDTH = 4;
  const PAD = BORDER_WIDTH >> 1;

  const CHART_HEIGHT = 2 * BAR_HEIGHT;

  const height1 = BAR_HEIGHT;
  const height2 = BAR_HEIGHT * 3 / 4 | 0;
  const height3 = BAR_HEIGHT / 2 | 0;

  const imgsize1 = IMG_SIZE;
  const imgsize2 = IMG_SIZE * 5 / 6 | 0;
  const imgsize3 = IMG_SIZE * 3 / 4 | 0;

  const bars = [
    {
      x: BAR_WIDTH,
      y: CHART_HEIGHT - height1,
      fill: '#ffecb3',
      width: BAR_WIDTH,
      height: height1,
      imgsize: imgsize1,
      textsize: 40,
      podiumText: 'I',
      ...chartData[0],
    },
    {
      x: 0,
      y: CHART_HEIGHT - height2,
      fill: '#eeeeee',
      width: BAR_WIDTH,
      height: height2,
      imgsize: imgsize2,
      textsize: 40,
      podiumText: 'II',
      ...chartData[1],
    },
    {
      x: BAR_WIDTH * 2,
      y: CHART_HEIGHT - height3,
      width: BAR_WIDTH,
      height: height3,
      fill: '#BCAAA4',

      imgsize: imgsize3,
      textsize: 40,
      podiumText: 'III',
      ...chartData[2],
    },
  ];

  for (const bar of bars) {
    bar.imgx = bar.x + bar.width / 2 - bar.imgsize / 2;
    bar.imgy = bar.y - IMG_PADDING - bar.textsize - IMG_PADDING - bar.imgsize;
    bar.textx = bar.x + bar.width / 2;
    bar.texty = bar.y - IMG_PADDING - bar.textsize / 2;
  }

  return svg`
    <svg width=${chartWidth} viewbox="${-PAD} ${-PAD} ${3 * BAR_WIDTH + 2 * PAD} ${2 * BAR_HEIGHT + 2 * PAD}">
      ${bars.map(bar => svg`
        <rect x=${bar.x} y=${bar.y} width=${bar.width} height=${bar.height} stroke="black" stroke-width="${BORDER_WIDTH}" fill="${bar.fill}"/>
        <text x=${bar.x + bar.width / 2} y=${bar.y + bar.height / 2} font-size=60px dominant-baseline="middle" text-anchor="middle">${bar.podiumText}</text>
        <image x=${bar.imgx} y=${bar.imgy} width=${bar.imgsize} height=${bar.imgsize} href="${bar.imgsrc}" dominant-baseline="middle" text-anchor="middle"/>
        <text x=${bar.textx} y=${bar.texty} font-size="${bar.textsize}px" dominant-baseline="middle" text-anchor="middle">${bar.text}</text>
      `)}
    </svg>
  `;
}
