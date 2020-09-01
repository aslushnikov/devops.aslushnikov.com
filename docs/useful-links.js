import {html} from './zhtml.js';

export function renderUsefulLinks() {
  return html`
    <section class=useful-links>
      <h2>Useful Links</h2>
      <ul>
        <li>
          Protocol Viewers: <a href="https://vanilla.aslushnikov.com/">Chromium</a>, <a href="https://wkprotocol.aslushnikov.com/">WebKit</a> and <a href="https://ffprotocol.aslushnikov.com/">Firefox</a>
        </li>
        <li>
          CodeSearch: <a href="https://cs.chromium.org">Chromium</a>, <a href="https://wksearch.azurewebsites.net">WebKit</a> and <a href="https://ffsearch.azurewebsites.net">Firefox</a>
        </li>
        <li>
          Upstream WK Packaging Bots:
            <a href="https://build.webkit.org/builders/WPE-Linux-64bit-Release-Packaging-Nightly-Ubuntu1804">WPE-18.04</a>,
            <a href="https://build.webkit.org/builders/WPE-Linux-64bit-Release-Packaging-Nightly-Ubuntu2004">WPE-20.04</a>,
            <a href="https://build.webkit.org/builders/GTK-Linux-64bit-Release-Packaging-Nightly-Ubuntu1804">GTK-18.04</a>,
            <a href="https://build.webkit.org/builders/GTK-Linux-64bit-Release-Packaging-Nightly-Ubuntu2004">GTK-20.04</a>
        </li>
      </ul>
    </section>
  `;
}

