# Playwright devops landing site

This automation to collect the following information:
- [x] CDN browser links for binaries & logs ![.github/workflows/cdn-status.yml](https://github.com/aslushnikov/devops.aslushnikov.com/workflows/.github/workflows/cdn-status.yml/badge.svg)
- [ ] Playwright docker image size over time (in a form of a chart)
- [x] Browser protocols per version ![.github/workflows/browser-protocols.yml](https://github.com/aslushnikov/devops.aslushnikov.com/workflows/.github/workflows/browser-protocols.yml/badge.svg)
- [ ] test status (skips & fails)
- [ ] autoroll info

Data is stored in the `data` branch of this repository. Workflows & serving
website live in the `master` branch.
