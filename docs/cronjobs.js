import {html} from './zhtml.js';

function generateStatusBadge(workflowName) {
  return html`
    <a href='https://github.com/aslushnikov/devops.aslushnikov.com/actions?query=${encodeURIComponent(`workflow:"${workflowName}"`)}'>
      <img title="cronjob status (green is good, red - broken!)" src='https://github.com/aslushnikov/devops.aslushnikov.com/workflows/${encodeURIComponent(workflowName)}/badge.svg'>
    </a>
  `;
}

export function cronjobBadgesHeader() {
  return html`
    <hbox class=cronjobs-header>
      <a href="https://github.com/aslushnikov/devops.aslushnikov.com" aria-label="View source on GitHub"><img width=22px src='/octocat.svg'></a>
      <spacer></spacer>
      <hbox class=badges>
        ${[
          generateStatusBadge('CDN status'),
          generateStatusBadge('track docker size'),
          generateStatusBadge('publish browser protocols'),
          generateStatusBadge('autoroll firefox'),
          generateStatusBadge('autoroll webkit'),
          generateStatusBadge('autoroll chromium'),
          generateStatusBadge('Test Docker'),
        ]}
      </hbox>
      <spacer></spacer>
    </hbox>
  `;
}

