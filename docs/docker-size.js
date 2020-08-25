import {html} from './zhtml.js';
import {humanReadableSize} from './misc.js';

export function dockerSizeStats(dockerData, rows = Infinity) {
  const data = dockerData.infos.slice().sort((a, b) => b.timestamp - a.timestamp).slice(0, rows);
  return html`
    <docker-size class=tile>
      <tile-header>
          <h2>Dockerfile.bionic image size</h2>
          <h2>raw: ${humanReadableSize(data[0].rawSize)} zip: ${humanReadableSize(data[0].zipSize)}</h2>
      </tile-header>
      <section>
        ${data.map((d, index) => renderRow(d, index))}
      </section>
    </docker-size>
  `;

  function renderRow(d, index) {
    const rawDelta = index + 1 < data.length ? d.rawSize - data[index + 1].rawSize : d.rawSize;
    const zipDelta = index + 1 < data.length ? d.zipSize - data[index + 1].zipSize : d.zipSize;
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

