import {html} from './zhtml.js';
import {renderWebkitCDNStatus, renderFirefoxCDNStatus} from './cdn-status.js';
import {dockerSizeStats} from './docker-size.js';

const URL_CDN_STATUS = 'https://raw.githubusercontent.com/aslushnikov/devops.aslushnikov.com/cdn-status-data/status.json';
const URL_DOCKER_IMAGE_SIZE = 'https://raw.githubusercontent.com/aslushnikov/devops.aslushnikov.com/docker-image-size-data/data.json';

window.addEventListener('DOMContentLoaded', async () => {
  const [cdnData, dockerData] = await Promise.all([
    fetch(URL_CDN_STATUS).then(r => r.json()),
    fetch(URL_DOCKER_IMAGE_SIZE).then(r => r.json()),
  ]);

  cdnData.webkit.sort((a, b) => b.rev - a.rev);
  cdnData.firefox.sort((a, b) => b.rev - a.rev);

  document.body.append(html`
    <div class="gallery">
      ${renderWebkitCDNStatus(cdnData, 5)}
      ${renderFirefoxCDNStatus(cdnData, 5)}
      ${dockerSizeStats(dockerData, 10)}
    </div>
  `);
}, false);

