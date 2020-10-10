import {html} from './zhtml.js';
import {humanReadableTimeInterval, browserLogoURL} from './misc.js';

export async function fetchTestStatus() {
  return fetch('https://raw.githubusercontent.com/aslushnikov/devops.aslushnikov.com/datastore--test-status/status.json').then(r => r.json()).then(json => {
    return json;
  });
}

export function renderTestStatusPreview(entries) {
  const cdnData = entries[entries.length - 1];
  const testsPerBrowser = {
    firefox: new Set(),
    webkit: new Set(),
    chromium: new Set(),
  };
  for (const test of cdnData.tests) {
    for (const b of [...test.fail, ...test.fixme, ...test.fail])
      testsPerBrowser[b].add(test);
  }
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
      fill: '#eeeeee',
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
      fill: '#ffecb3',
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

  function drawSVGBar(bar) {
    return `
      <rect x=${bar.x} y=${bar.y} width=${bar.width} height=${bar.height} stroke="black" stroke-width="${BORDER_WIDTH}" fill="${bar.fill}"/>
      <text x=${bar.x + bar.width / 2} y=${bar.y + bar.height / 2} font-size=60px dominant-baseline="middle" text-anchor="middle">${bar.podiumText}</text>
      <image x=${bar.imgx} y=${bar.imgy} width=${bar.imgsize} height=${bar.imgsize} xlink:href="${bar.imgsrc}" dominant-baseline="middle" text-anchor="middle"/>
      <text x=${bar.textx} y=${bar.texty} font-size="${bar.textsize}px" dominant-baseline="middle" text-anchor="middle">${bar.text}</text>
    `;
  }

  const viewbox = `${-PAD} ${-PAD} ${3 * BAR_WIDTH + PAD} ${2 * BAR_HEIGHT + PAD}`;
  const result = html`
    <section class=test-status>
      <hbox>
        <div class=header>
          <h2>Test Status</h2>
          <div>(updated ${humanReadableTimeInterval(Date.now() - cdnData.timestamp)} ago)</div>
        </div>
        <spacer></spacer>
        <svg xmlns="http://www.w3.org/2000/svg" width=250></svg>
        <spacer></spacer>
      </hbox>
      <section class=body>
      </section>
    </section>
  `;
  const svg = result.$('svg');
  svg.setAttribute('viewBox', viewbox);
  svg.innerHTML = `
      ${drawSVGBar(bars[0])}
      ${drawSVGBar(bars[1])}
      ${drawSVGBar(bars[2])}
  `;
  return result;
}

