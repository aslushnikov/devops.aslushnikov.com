import {html} from './zhtml.js';
import {humanReadableSize} from './misc.js';

export function fetchDockerStats() {
  return fetch('https://raw.githubusercontent.com/aslushnikov/devops.aslushnikov.com/docker-image-size-data/data.json').then(r => r.json()).then(json => {
    json.infos.sort((a, b) => b.timestamp - a.timestamp);
    return json;
  });
}

export function dockerSizeStats(dockerData, preview = false) {
  const originalData = dockerData.infos;
  let data = dockerData.infos;
  let footer;
  if (preview) {
    const RECENT_RUNS = 5;
    data = data.slice(0, RECENT_RUNS);
    footer = html`
      <footer>
        Showing ${RECENT_RUNS} most recent commits. <a href="/full-docker-stats.html">See all</a>
      </footer>
    `;
  }
  return html`
    <docker-size>
      <header>
        <h2>
          <span>Dockerfile.bionic image size</span>
          <span>raw: ${humanReadableSize(data[0].rawSize)} zip: ${humanReadableSize(data[0].zipSize)}</span>
        </h2>
        <div>(updates daily at 4AM PST)</div>
      </header>
      <section>
        ${data.map((d, index) => renderRow(d, index))}
      </section>
      ${footer}
    </docker-size>
  `;

  function renderRow(d, index) {
    const rawDelta = index + 1 < originalData.length ? d.rawSize - originalData[index + 1].rawSize : d.rawSize;
    const zipDelta = index + 1 < originalData.length ? d.zipSize - originalData[index + 1].zipSize : d.zipSize;
    return html`
      <div class=row>
        <a class=hash href="https://github.com/microsoft/playwright/commit/${d.sha}"><code>${d.sha.substring(0, 7)}</code></a>
        <span class=message>${d.message}</span>
        ${renderBytesDelta('raw:', rawDelta)}
        ${renderBytesDelta('zip:', zipDelta)}
      </div>
    `;
  }

  function renderBytesDelta(preffix, delta) {
    const cls = delta < 0 ? 'size-decrease' : 'size-increase';
    const sign = delta < 0 ? '': '+';
    return html`<span class="size-delta ${cls}">${preffix} ${sign}${humanReadableSize(delta)}</span>`;
  }
}

