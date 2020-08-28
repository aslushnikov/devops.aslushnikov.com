import {html} from './zhtml.js';

export function cronjobCDNStatusBadge() {
  return html`
    <a href='https://github.com/aslushnikov/devops.aslushnikov.com/blob/master/.github/workflows/cdn-status.yml'>
      <img title="cronjob status (green is good, red - broken!)" src='https://github.com/aslushnikov/devops.aslushnikov.com/workflows/update%20CDN%20status/badge.svg'>
    </a>
  `;
}

export function cronjobDockerSizeBadge() {
  return html`
    <a href='https://github.com/aslushnikov/devops.aslushnikov.com/blob/master/.github/workflows/track-docker-image-size.yml'>
      <img title="cronjob status (green is good, red - broken!)" src='https://github.com/aslushnikov/devops.aslushnikov.com/workflows/track%20docker%20size/badge.svg'>
    </a>
  `;
}

export function cronjobPublishBrowserProtocols() {
  return html`
    <a href='https://github.com/aslushnikov/devops.aslushnikov.com/blob/master/.github/workflows/publish-browser-protocols.yml'>
      <img title="cronjob status (green is good, red - broken!)" src='https://github.com/aslushnikov/devops.aslushnikov.com/workflows/publish%20browser%20protocols/badge.svg'>
    </a>
  `;
}

export function cronjobAutorollFirefox() {
  return html`
    <a href='https://github.com/aslushnikov/devops.aslushnikov.com/blob/master/.github/workflows/autoroll-firefox.yml'>
      <img title="cronjob status (green is good, red - broken!)" src='https://github.com/aslushnikov/devops.aslushnikov.com/workflows/autoroll%20firefox/badge.svg'>
    </a>
  `;
}

export function cronjobAutorollWebKit() {
  return html`
    <a href='https://github.com/aslushnikov/devops.aslushnikov.com/blob/master/.github/workflows/autoroll-webkit.yml'>
      <img title="cronjob status (green is good, red - broken!)" src='https://github.com/aslushnikov/devops.aslushnikov.com/workflows/autoroll%20webkit/badge.svg'>
    </a>
  `;
}

export function cronjobBadgesHeader() {
  return html`
    <hbox class=cronjobs-header>
      <a class=ghlogo href="https://github.com/aslushnikov/devops.aslushnikov.com" aria-label="View source on GitHub"><img width=22px src='/github.png'></a>
      <spacer></spacer>
      <hbox class=badges>
        ${[
          cronjobCDNStatusBadge(),
          cronjobDockerSizeBadge(),
          cronjobPublishBrowserProtocols(),
          cronjobAutorollFirefox(),
          cronjobAutorollWebKit(),
        ]}
      </hbox>
      <spacer></spacer>
    </hbox>
  `;
}

