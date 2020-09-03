import {html} from './zhtml.js';

function generateStatusBadge(workflowName) {
  return html`
    <a href='https://github.com/aslushnikov/devops.aslushnikov.com/actions?query=${encodeURIComponent(`workflow:"${workflowName}"`)}'>
      <img title="cronjob status (green is good, red - broken!)" src='https://github.com/aslushnikov/devops.aslushnikov.com/workflows/${encodeURIComponent(workflowName)}/badge.svg'>
    </a>
  `;
}

function cronjobCDNStatusBadge() {
  return generateStatusBadge('update CDN status')
}

function cronjobDockerSizeBadge() {
  return generateStatusBadge('track docker size')
}

function cronjobPublishBrowserProtocols() {
  return generateStatusBadge('publish browser protocols')
}

function cronjobAutorollFirefox() {
  return generateStatusBadge('autoroll firefox')
}

function cronjobAutorollWebKit() {
  return generateStatusBadge('autoroll webkit')
}

export function dockerImageTests() {
  return generateStatusBadge('Test Docker')
}

export function cronjobBadgesHeader() {
  return html`
    <hbox class=cronjobs-header>
      <a href="https://github.com/aslushnikov/devops.aslushnikov.com" aria-label="View source on GitHub"><img width=22px src='/octocat.svg'></a>
      <spacer></spacer>
      <hbox class=badges>
        ${[
          cronjobCDNStatusBadge(),
          cronjobDockerSizeBadge(),
          cronjobPublishBrowserProtocols(),
          cronjobAutorollFirefox(),
          cronjobAutorollWebKit(),
          dockerImageTests(),
        ]}
      </hbox>
      <spacer></spacer>
    </hbox>
  `;
}

