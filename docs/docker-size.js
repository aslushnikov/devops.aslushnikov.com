import {html} from './zhtml.js';
import {humanReadableSize, commitURL} from './misc.js';

export function fetchDockerStats() {
  return fetch('https://raw.githubusercontent.com/aslushnikov/devops.aslushnikov.com/docker-image-size-data/data.json').then(r => r.json()).then(json => {
    json.infos.sort((a, b) => b.timestamp - a.timestamp);
    for (let i = 0, N = json.infos.length; i < N; ++i) {
      const info = json.infos[i];
      const next = json.infos[i + 1] || {rawSize: 0, zipSize: 0};
      info.rawDelta = info.rawSize - next.rawSize;
      info.zipDelta = info.zipSize - next.zipSize;
    }
    return json;
  });
}

export function dockerSizeStats(dockerData, preview = false) {
  const RECENT_RUNS = 5;
  let data = dockerData.infos;
  if (preview)
    data = data.slice(0, RECENT_RUNS);

  return html`
    <section class=docker-size>
      <header>
        <hbox>
          <h2>Dockerfile.bionic image size</h2>
          <spacer></spacer>
          <h2>raw: ${humanReadableSize(data[0].rawSize)} zip: ${humanReadableSize(data[0].zipSize)}</h2>
        </hbox>
        <div>(updates daily at 4AM PST)</div>
      </header>
      <section>
        ${data.map(d => html`
          <hbox class=row>
            <span>
              <a class=sha href="${commitURL('playwright', d.sha)}">${d.sha.substring(0, 7)}</a>
            </span>
            <span class=message>${d.message}</span>
            <spacer></spacer>
            ${renderBytesDelta('raw:', d.rawDelta)}
            ${renderBytesDelta('zip:', d.zipDelta)}
          </hbox>
        `)}
      </section>
      ${preview && html`
        <footer>
          Showing ${RECENT_RUNS} most recent commits. <a href="/full-docker-stats.html">See all</a>
        </footer>
      `}
    </section>
  `;

  function renderBytesDelta(preffix, delta) {
    const cls = delta < 0 ? 'good' : 'bad';
    // render deltas in MBs
    const mb = delta / 1024 / 1024;
    const sign = delta < 0 ? '' : '+';
    return html`<span class="size-delta ${cls}">${preffix} ${sign}${mb.toFixed(2)}MB</span>`;
  }
}

