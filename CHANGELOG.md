# Changelog

## [0.2.1](https://github.com/opista/gog-achievements/compare/v0.2.0...v0.2.1) (2026-10-15)


### Fixed

* seal Mac app bundles before distribution ([#13](https://github.com/opista/gog-achievements/issues/13)) ([5c29d16](https://github.com/opista/gog-achievements/commit/5c29d16a34c3001100414b33749eb8a02f99a912))

## [0.2.0](https://github.com/opista/gog-achievements/compare/v0.1.0...v0.2.0) (2026-10-15)


### Added

* add desktop achievement restoration workspace ([4a915df](https://github.com/opista/gog-achievements/commit/4a915df82681e3ca2ebc5d091a5e09e654471665))
* add release automation and update notifications ([44a50bb](https://github.com/opista/gog-achievements/commit/44a50bb5065ed5c59211520ca7fc06e03f535c39))
* group game queues and simplify restoration flow ([4bf9e71](https://github.com/opista/gog-achievements/commit/4bf9e715a31254bdb72624f438ef18efb22a29a1))
* improve app usability and update checks ([#2](https://github.com/opista/gog-achievements/issues/2)) ([ad325c2](https://github.com/opista/gog-achievements/commit/ad325c28151e551a2d4da709b66ce6a331837b7d))
* simplify queue actions and achievement history ([00c52ab](https://github.com/opista/gog-achievements/commit/00c52ab37d0a8fc706d75f01091c04d3cec4ac1e))
* use machine local time throughout the app ([7942d62](https://github.com/opista/gog-achievements/commit/7942d62ff91893d1f91463a9f326050e41747a67))


### Fixed

* allow cold Windows process discovery to finish ([2be2795](https://github.com/opista/gog-achievements/commit/2be2795e78d2d9b860b3f336968b72a4c59c7298))
* clarify achievement apply review and time zones ([7979e09](https://github.com/opista/gog-achievements/commit/7979e09082a2b7f493eb844118a27c2a975c629d))
* format dates for the user locale and rename unlock history ([1aa2561](https://github.com/opista/gog-achievements/commit/1aa2561c39701983789ea0b5274ca3e0b6356889))
* limit Windows recovery queries to CLI processes ([96fe349](https://github.com/opista/gog-achievements/commit/96fe349169dcb137c25391f9be249f8ea91485fd))
* refine workspace and clear confirmed queue items ([1e96421](https://github.com/opista/gog-achievements/commit/1e96421e9987d973a804704fdd9cd1dfa8e4d3c9))
* remove confusing draft save status ([60a5465](https://github.com/opista/gog-achievements/commit/60a546508f285bfcde41e14f6aa878c4bfb3e389))
* simplify date labels and highlight apply warning ([d30c3a0](https://github.com/opista/gog-achievements/commit/d30c3a020cad1f78ce47325d677ae9f73a9f6d33))


### Changed

* integrate NestJS and Electron IPC bridge ([#4](https://github.com/opista/gog-achievements/issues/4)) ([0feb55a](https://github.com/opista/gog-achievements/commit/0feb55aed84ed91375ca55c4de39649546891174))
* isolate account and session state ([#7](https://github.com/opista/gog-achievements/issues/7)) ([897ee8f](https://github.com/opista/gog-achievements/commit/897ee8f3a19802fdc984dc0cc4d85ff6e986b99a))
* isolate apply and recovery flow ([#10](https://github.com/opista/gog-achievements/issues/10)) ([e87fb8c](https://github.com/opista/gog-achievements/commit/e87fb8c3dd58de754e515f0c6b0680f49dd4fd66))
* isolate library and achievement browsing ([#6](https://github.com/opista/gog-achievements/issues/6)) ([9ffa27a](https://github.com/opista/gog-achievements/commit/9ffa27a56a0c88c351893ec88e7cf638beddd4f5))
* isolate queue state and editing ([#8](https://github.com/opista/gog-achievements/issues/8)) ([f3df8c3](https://github.com/opista/gog-achievements/commit/f3df8c301734e5b88705f74e64cb39ad6f09254e))
* isolate unlock history feature ([#5](https://github.com/opista/gog-achievements/issues/5)) ([fc2c4f8](https://github.com/opista/gog-achievements/commit/fc2c4f8c15693c629238104a647042b3af7a2494))
* split main process into Nest feature services ([#11](https://github.com/opista/gog-achievements/issues/11)) ([2b03ad2](https://github.com/opista/gog-achievements/commit/2b03ad2f071f0e9e0e2a41ffea18af12cb6a0272))

## 0.1.0 (2026-10-14)


### Added

* add desktop achievement restoration workspace ([4a915df](https://github.com/opista/gog-achievements/commit/4a915df82681e3ca2ebc5d091a5e09e654471665))
* add release automation and update notifications ([44a50bb](https://github.com/opista/gog-achievements/commit/44a50bb5065ed5c59211520ca7fc06e03f535c39))
* group game queues and simplify restoration flow ([4bf9e71](https://github.com/opista/gog-achievements/commit/4bf9e715a31254bdb72624f438ef18efb22a29a1))
* simplify queue actions and achievement history ([00c52ab](https://github.com/opista/gog-achievements/commit/00c52ab37d0a8fc706d75f01091c04d3cec4ac1e))
* use machine local time throughout the app ([7942d62](https://github.com/opista/gog-achievements/commit/7942d62ff91893d1f91463a9f326050e41747a67))


### Fixed

* allow cold Windows process discovery to finish ([2be2795](https://github.com/opista/gog-achievements/commit/2be2795e78d2d9b860b3f336968b72a4c59c7298))
* clarify achievement apply review and time zones ([7979e09](https://github.com/opista/gog-achievements/commit/7979e09082a2b7f493eb844118a27c2a975c629d))
* format dates for the user locale and rename unlock history ([1aa2561](https://github.com/opista/gog-achievements/commit/1aa2561c39701983789ea0b5274ca3e0b6356889))
* limit Windows recovery queries to CLI processes ([96fe349](https://github.com/opista/gog-achievements/commit/96fe349169dcb137c25391f9be249f8ea91485fd))
* refine workspace and clear confirmed queue items ([1e96421](https://github.com/opista/gog-achievements/commit/1e96421e9987d973a804704fdd9cd1dfa8e4d3c9))
* remove confusing draft save status ([60a5465](https://github.com/opista/gog-achievements/commit/60a546508f285bfcde41e14f6aa878c4bfb3e389))
* simplify date labels and highlight apply warning ([d30c3a0](https://github.com/opista/gog-achievements/commit/d30c3a020cad1f78ce47325d677ae9f73a9f6d33))
