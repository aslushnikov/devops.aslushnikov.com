import {html} from './zhtml.js';

export function humanReadableTimeInterval(diff) {
  const intervals = [
    [1000, 'second'],
    [60, 'minute'],
    [60, 'hour'],
    [24, 'day'],
    [7, 'week'],
    [52, 'year'],
  ];
  let aggr = 1;
  let time = 'Just Now';
  for (let i = 0; i < intervals.length; ++i) {
    if (diff < aggr * intervals[i][0])
      break;
    aggr = aggr * intervals[i][0];
    time = intervals[i][1];
  }
  const fraction = Math.floor(diff / aggr);
  return aggr === 1 ? 'Just Now' :  fraction + ' ' + time + (fraction > 1 ? 's' : '');
}

export function humanReadableSize(bytes) {
  const intervals = [
    [1024, 'KB'],
    [1024, 'MB'],
    [1024, 'GB'],
  ];
  const sign = bytes < 0 ? -1 : 1;
  bytes *= sign;
  let aggr = 1;
  let suffix = 'B';
  for (let i = 0; i < intervals.length; ++i) {
    if (bytes < aggr * intervals[i][0])
      break;
    aggr = aggr * intervals[i][0];
    suffix = intervals[i][1];
  }
  const fraction = Math.floor(bytes / aggr * 10) / 10;
  return sign * fraction + '' + suffix;
}

export function browserLogo(browserName, width = 30, height) {
  const LOGO_URLS = {
    firefox: '/ff.svg',
    webkit: '/wk.svg',
  };
  if (height === undefined)
    height = width;
  return html`
    <img src="${LOGO_URLS[browserName.toLowerCase()]}" width=${width} height=${height}>
  `;
}

export function commitURL(browserName, sha) {
  const base = {
    firefox: 'https://github.com/mozilla/gecko-dev/commit/',
    webkit: 'https://github.com/WebKit/webkit/commit/',
    playwright: 'https://github.com/microsoft/playwright/commit/',
    chromium: 'https://crrev.com/',
  }[browserName.toLowerCase()];
  if (!base)
    return '';
  return base + sha;
}

