# Changelog

## [0.9.0](https://github.com/gemini-testing/testplane-ai/compare/mcp-v0.8.0...mcp-v0.9.0) (2026-07-28)


### Features

* implement time-travel-export-html tool ([#50](https://github.com/gemini-testing/testplane-ai/issues/50)) ([30878d8](https://github.com/gemini-testing/testplane-ai/commit/30878d82270f0a2744ebb02f5c6c1cc425568006))


### Dependencies

* The following workspace dependencies were updated
  * devDependencies
    * @testplane/tools bumped from * to 1.0.0

## [0.8.0](https://github.com/gemini-testing/testplane-ai/compare/mcp-v0.7.0...mcp-v0.8.0) (2026-07-22)


### Features

* add support for headful mode in CLI ([#38](https://github.com/gemini-testing/testplane-ai/issues/38)) ([df1a7c5](https://github.com/gemini-testing/testplane-ai/commit/df1a7c567c1b384a96690f8ac5e3429b87057f05))
* add the timeout option to navigate command ([#35](https://github.com/gemini-testing/testplane-ai/issues/35)) ([484a5b3](https://github.com/gemini-testing/testplane-ai/commit/484a5b3e3cff8fffbbd5bc97fb877aef0b09f7be))
* implement browser-console tool ([#40](https://github.com/gemini-testing/testplane-ai/issues/40)) ([9e965f9](https://github.com/gemini-testing/testplane-ai/commit/9e965f968371b196c65e1da1bcdc26eb5a3f4938))
* implement initial version of testplane cli ([#34](https://github.com/gemini-testing/testplane-ai/issues/34)) ([9aec732](https://github.com/gemini-testing/testplane-ai/commit/9aec7321df8155196fa3f7c9f1de888405db51e8))
* implement inspect-result tool ([#42](https://github.com/gemini-testing/testplane-ai/issues/42)) ([f37ca5d](https://github.com/gemini-testing/testplane-ai/commit/f37ca5d72c4eece1f7978c1e3f380aca0ccc3bc0))
* implement run-code tool ([#44](https://github.com/gemini-testing/testplane-ai/issues/44)) ([e76404d](https://github.com/gemini-testing/testplane-ai/commit/e76404d9bcaa4f87e2b437b7c463e5d2deb1aec6))
* implement saveState/restoreState tools ([#47](https://github.com/gemini-testing/testplane-ai/issues/47)) ([e875993](https://github.com/gemini-testing/testplane-ai/commit/e8759939e5617d82f648523ebaef8697b046ce51))
* implement select-option tool ([#39](https://github.com/gemini-testing/testplane-ai/issues/39)) ([0305aa4](https://github.com/gemini-testing/testplane-ai/commit/0305aa434f6ee28eac407b0b22d9d87e7ec71e1a))
* implement the REPL integration ([#46](https://github.com/gemini-testing/testplane-ai/issues/46)) ([4f2f022](https://github.com/gemini-testing/testplane-ai/commit/4f2f0226e8bc75d58e87575d831c28a176d66715))
* implement the test-results command ([#41](https://github.com/gemini-testing/testplane-ai/issues/41)) ([cec6a90](https://github.com/gemini-testing/testplane-ai/commit/cec6a90d289fc96aa00185246cde96c4d6af487d))
* implement the time-travel-snapshot tool ([#43](https://github.com/gemini-testing/testplane-ai/issues/43)) ([7626c55](https://github.com/gemini-testing/testplane-ai/commit/7626c550313185d3f36f6ac1ed7bde57db45f963))
* save snapshots to file by default and remove element-based snapshots ([#36](https://github.com/gemini-testing/testplane-ai/issues/36)) ([d692e66](https://github.com/gemini-testing/testplane-ai/commit/d692e66971b168217140f7f8b905497fe3f9747c))


### Bug Fixes

* revamp autolaunch behavior and ignore resource loading errors when navigating ([#45](https://github.com/gemini-testing/testplane-ai/issues/45)) ([4170fcc](https://github.com/gemini-testing/testplane-ai/commit/4170fcc445080f78b628a3aabf4e5da7d550470f))
* update testplane to latest to support ALS in repl ([#51](https://github.com/gemini-testing/testplane-ai/issues/51)) ([5b30a29](https://github.com/gemini-testing/testplane-ai/commit/5b30a29fdddedca2968b7b2f6fb303ad94a1818f))

## [0.6.0](https://github.com/gemini-testing/testplane-mcp/compare/v0.5.0...v0.6.0) (2025-10-15)


### Features

* implement launchBrowser tool ([#29](https://github.com/gemini-testing/testplane-mcp/issues/29)) ([5171785](https://github.com/gemini-testing/testplane-mcp/commit/517178518074d3bd92cfbdc041ac83b924713fb2))

## [0.5.0](https://github.com/gemini-testing/testplane-mcp/compare/v0.4.0...v0.5.0) (2025-08-28)

### Features

- implement takeViewportScreenshot tool ([#26](https://github.com/gemini-testing/testplane-mcp/issues/26)) ([20ac3b1](https://github.com/gemini-testing/testplane-mcp/commit/20ac3b1129b3612457df8429664582f263b682fc))
- **mcp-tools:** add attach to existing browser ([7b2ae9b](https://github.com/gemini-testing/testplane-mcp/commit/7b2ae9b3f24b1ff7b79d5a70b6b6e9f8ee15d2f0))
- **mcp-tools:** add hover element tool ([06790c8](https://github.com/gemini-testing/testplane-mcp/commit/06790c8485659ec91d152c3ecbee36481a123cd3))

## [0.4.0](https://github.com/gemini-testing/testplane-mcp/compare/v0.3.0...v0.4.0) (2025-07-24)

### Features

- implement waitFor tool ([#20](https://github.com/gemini-testing/testplane-mcp/issues/20)) ([bde02dd](https://github.com/gemini-testing/testplane-mcp/commit/bde02ddc30246035dc9f35acaa02e986c0f495db))

## [0.3.0](https://github.com/gemini-testing/testplane-mcp/compare/v0.2.0...v0.3.0) (2025-06-18)

### Features

- implement tab management tools ([#17](https://github.com/gemini-testing/testplane-mcp/issues/17)) ([12ad0f3](https://github.com/gemini-testing/testplane-mcp/commit/12ad0f3ee481bb803a71b643a1cd3951daf512fb))
- implement take page snapshot command ([#16](https://github.com/gemini-testing/testplane-mcp/issues/16)) ([dede051](https://github.com/gemini-testing/testplane-mcp/commit/dede051a3da90e2eba3ff379f316c770ad592eee))
- use optimized snapshots provided by testplane ([#15](https://github.com/gemini-testing/testplane-mcp/issues/15)) ([1f09ebc](https://github.com/gemini-testing/testplane-mcp/commit/1f09ebccf85bae614c66c947295d5cc6b826e108))

## [0.2.0](https://github.com/gemini-testing/testplane-mcp/compare/v0.1.2...v0.2.0) (2025-06-10)

### Features

- implement clickOnElement and typeIntoElement tools ([#13](https://github.com/gemini-testing/testplane-mcp/issues/13)) ([5f05be8](https://github.com/gemini-testing/testplane-mcp/commit/5f05be8ba5bc8a658985b472d7c9610f51925e2f))

## [0.1.2](https://github.com/gemini-testing/testplane-mcp/compare/v0.1.1...v0.1.2) (2025-05-27)

### Bug Fixes

- fix publish action ([#11](https://github.com/gemini-testing/testplane-mcp/issues/11)) ([c1c4c46](https://github.com/gemini-testing/testplane-mcp/commit/c1c4c46ae64ef9b91d40b4065e8053e787b71e3c))

## [0.1.1](https://github.com/gemini-testing/testplane-mcp/compare/v0.1.0...v0.1.1) (2025-05-27)

### Bug Fixes

- fix docs ([#9](https://github.com/gemini-testing/testplane-mcp/issues/9)) ([ce6aa34](https://github.com/gemini-testing/testplane-mcp/commit/ce6aa34cec7d1e85f1f888f0b7b452e3c0596cd5))
