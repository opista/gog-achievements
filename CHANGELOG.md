# Changelog

## [0.4.0](https://github.com/opista/gog-achievements/compare/v0.3.1...v0.4.0) (2026-10-18)


### Added

* add account-specific pinned games ([#27](https://github.com/opista/gog-achievements/issues/27)) ([7dadc05](https://github.com/opista/gog-achievements/commit/7dadc05c5aa5c129f7e9a39b52f614f2be180f3d))
* add achievement search and sorting ([#26](https://github.com/opista/gog-achievements/issues/26)) ([9c18f8d](https://github.com/opista/gog-achievements/commit/9c18f8da4e4664956dd2c63bf4b21cb4583fcf64))
* export filtered achievements through the CLI ([#28](https://github.com/opista/gog-achievements/issues/28)) ([6f80d96](https://github.com/opista/gog-achievements/commit/6f80d9677e2476a7bda5141738ec60accb01eba0))
* show achievement completion for the selected game ([#20](https://github.com/opista/gog-achievements/issues/20)) ([16ea2c3](https://github.com/opista/gog-achievements/commit/16ea2c35d5b0fcc4fdaff316a108a2efd159bf0b))
* update compatible CLI releases automatically ([#29](https://github.com/opista/gog-achievements/issues/29)) ([b1e475f](https://github.com/opista/gog-achievements/commit/b1e475f01d7f8c2a38f296d3baf2c3d0b5b113b1))


### Fixed

* harden desktop CLI operations and cleanup ([#31](https://github.com/opista/gog-achievements/issues/31)) ([ee3c44e](https://github.com/opista/gog-achievements/commit/ee3c44edbb57371c8fd154c26fc95d3211a70663))
* load optional workspace data on demand ([#32](https://github.com/opista/gog-achievements/issues/32)) ([0636bea](https://github.com/opista/gog-achievements/commit/0636beafcee7adf7b18b51883c5c2c8ef00e60b5))
* show the product name in native app menus ([#21](https://github.com/opista/gog-achievements/issues/21)) ([440c940](https://github.com/opista/gog-achievements/commit/440c9403e8eecdbcc210da37819a6764cfa40c39))


### Changed

* derive app contracts from validation schemas ([#33](https://github.com/opista/gog-achievements/issues/33)) ([a0b6035](https://github.com/opista/gog-achievements/commit/a0b6035d7eccdde1c9dde18c569cefcf0e0b3ec1))
* reuse queue date labels between renders ([#35](https://github.com/opista/gog-achievements/issues/35)) ([9b96bca](https://github.com/opista/gog-achievements/commit/9b96bcacccd3c471e35d5cbd882d7878ea4a463f))
* separate app compilation from CLI provisioning ([#34](https://github.com/opista/gog-achievements/issues/34)) ([333f4e8](https://github.com/opista/gog-achievements/commit/333f4e83531ec979ca34340bb6c87d0df830bc51))

## [0.3.1](https://github.com/opista/gog-achievements/compare/v0.3.0...v0.3.1) (2026-10-17)


### Fixed

* improve Windows sign-in, menus and scrolling ([53b67bf](https://github.com/opista/gog-achievements/commit/53b67bfbf069546349bf3d4f58e6f908c2d111e4))

## [0.3.0](https://github.com/opista/gog-achievements/compare/v0.2.1...v0.3.0) (2026-10-15)


### Added

* unlock and lock achievements in the desktop app ([#15](https://github.com/opista/gog-achievements/issues/15)) ([79a1f67](https://github.com/opista/gog-achievements/commit/79a1f670420e9f637c9972395ae3c87b489ad9e8))


### Changed

* virtualize large game libraries ([#17](https://github.com/opista/gog-achievements/issues/17)) ([b21e627](https://github.com/opista/gog-achievements/commit/b21e627110f181345cb41b0c2779eb2426d509a8))

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
