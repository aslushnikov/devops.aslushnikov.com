# Playwright devops landing site

This automation to collect the following information:
- [x] CDN browser links for binaries & logs ![update CDN status](https://github.com/aslushnikov/devops.aslushnikov.com/workflows/update%20CDN%20status/badge.svg)
- [x] Playwright docker image size over time (in a form of a chart) ![track docker size](https://github.com/aslushnikov/devops.aslushnikov.com/workflows/track%20docker%20size/badge.svg)
- [x] Browser protocols per version ![publish browser protocols](https://github.com/aslushnikov/devops.aslushnikov.com/workflows/publish%20browser%20protocols/badge.svg)
- [ ] test status (skips & fails)
- [ ] autoroll info

Data is stored in the `data` branch of this repository. Workflows & serving
website live in the `master` branch.
