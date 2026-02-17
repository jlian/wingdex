# [1.4.0](https://github.com/jlian/wingdex/compare/v1.3.2...v1.4.0) (2026-02-17)


### Features

* rename BirdDex to WingDex across app ([#129](https://github.com/jlian/wingdex/issues/129)) ([bacd237](https://github.com/jlian/wingdex/commit/bacd2374fbae125980c958270b5644e71ea03827))

## [1.3.2](https://github.com/jlian/birddex/compare/v1.3.1...v1.3.2) (2026-02-17)


### Bug Fixes

* prevent home empty-state flash during Spark KV load ([#124](https://github.com/jlian/birddex/issues/124)) ([9ac485a](https://github.com/jlian/birddex/commit/9ac485aa0c7bff7d7353e5c167c36e3e1cc20553)), closes [#101](https://github.com/jlian/birddex/issues/101)

## [1.3.1](https://github.com/jlian/birddex/compare/v1.3.0...v1.3.1) (2026-02-17)


### Bug Fixes

* pre-resolve Wikipedia titles at build time to fix iOS image loading ([#99](https://github.com/jlian/birddex/issues/99)) ([ce58c62](https://github.com/jlian/birddex/commit/ce58c627c4c21a16151cc35e33885c1e44c3a21a))

## [1.3.0](https://github.com/jlian/birddex/compare/v1.2.3...v1.3.0) (2026-02-17)


### Features

* enlarge bird detail hero image with overlay text and top-biased crop ([#94](https://github.com/jlian/birddex/issues/94)) ([495fff3](https://github.com/jlian/birddex/commit/495fff37f88b89a8047b0c1fd2ba73e2c441c8a4)), closes [#92](https://github.com/jlian/birddex/issues/92)


### Bug Fixes

* apply top-biased crop to homepage species cards ([e5c401a](https://github.com/jlian/birddex/commit/e5c401a7c3c0b9d50d276dd311e1fa8abed1220e))

## [1.2.3](https://github.com/jlian/birddex/compare/v1.2.2...v1.2.3) (2026-02-16)


### Bug Fixes

* **ci:** make paths-filter v3 compatible on push and PR ([506a6b9](https://github.com/jlian/birddex/commit/506a6b9640dd22a469c080d8bcef5a5ad68038a9))
* **ci:** simplify single-check workflow and enforce lint/typecheck reliability ([#90](https://github.com/jlian/birddex/issues/90)) ([b16d477](https://github.com/jlian/birddex/commit/b16d477835558594210eba3b49dfe48d095e8642))

## [1.2.2](https://github.com/jlian/birddex/compare/v1.2.1...v1.2.2) (2026-02-16)


### Bug Fixes

* reduce expected 404 noise in Spark KV + Wikimedia fallbacks ([#75](https://github.com/jlian/birddex/issues/75)) ([d92fcbf](https://github.com/jlian/birddex/commit/d92fcbf873cec805e365e3d9170cde75851135c1))

## [1.2.1](https://github.com/jlian/birddex/compare/v1.2.0...v1.2.1) (2026-02-16)


### Bug Fixes

* use plain v tags for release-please ([#85](https://github.com/jlian/birddex/issues/85)) ([ab4a2da](https://github.com/jlian/birddex/commit/ab4a2da3df3de4abb6e16589010b1a48f70bcd4f))

## [1.2.0](https://github.com/jlian/birddex/compare/v1.1.0...v1.2.0) (2026-02-16)

### Features
- replace stat cards with compact inline stats on homepage ([3908041](https://github.com/jlian/birddex/commit/3908041))
- replace homepage top with 3 enriched stat cards ([7a1c6bd](https://github.com/jlian/birddex/commit/7a1c6bd))
- minimal typographic homepage header ([0780084](https://github.com/jlian/birddex/commit/0780084))
- E1 homepage layout, rename tab to BirdDex, MapPin outings icon ([ff3996f](https://github.com/jlian/birddex/commit/ff3996f))
- big CTA card homepage, fix skeleton color, smoother bird detail ([02730a2](https://github.com/jlian/birddex/commit/02730a2))
- add AI test fixtures with real LLM responses (#63) ([a251e06](https://github.com/jlian/birddex/commit/a251e06))
- expand AI fixtures to all 27 images, rename for consistency ([c281324](https://github.com/jlian/birddex/commit/c281324))
- Add OG and Twitter image metadata for share previews ([a9744c6](https://github.com/jlian/birddex/commit/a9744c6))

### Bug Fixes
- Fix species deduplication, crop preview overflow, and Wikipedia attribution (#62) ([8d09bb3](https://github.com/jlian/birddex/commit/8d09bb3))
- UI modernization and bug fixes (#45, #17, #59, #14, #13) ([a39b13b](https://github.com/jlian/birddex/commit/a39b13b))
- unify top bar, homepage overhaul, normalize lists, species dedup ([d689f33](https://github.com/jlian/birddex/commit/d689f33))
- tab trigger feedback + reimport duplicate warning ([2cd1351](https://github.com/jlian/birddex/commit/2cd1351))
- iOS Mail list style, accent→green, tab hover, homepage consolidation ([6c9e183](https://github.com/jlian/birddex/commit/6c9e183))
- restore hover/active feedback on lists, fix homepage highlights layout, add cursor-pointer consistency ([ad3de97](https://github.com/jlian/birddex/commit/ad3de97))
- image sizing, hover alignment, highlights grid, homepage outing feedback ([5672f0f](https://github.com/jlian/birddex/commit/5672f0f))
- restore inset borders with rounded hover, icon-only back buttons, MapPin outings ([da6ccca](https://github.com/jlian/birddex/commit/da6ccca))
- move border-b to outer row div, add Back text to back buttons ([e4947b5](https://github.com/jlian/birddex/commit/e4947b5))
- restore iOS Mail inset border, fix double-navigation on BirdRow click ([151746a](https://github.com/jlian/birddex/commit/151746a))
- consolidate page transitions to fast fade-in, fix scrollbar shift ([698910d](https://github.com/jlian/birddex/commit/698910d))
- neutral skeleton colors, smoother bird detail loading, faster fade ([c4cc27f](https://github.com/jlian/birddex/commit/c4cc27f))
- crossfade skeleton→content on bird detail, elegant borderless hero ([cc9a18d](https://github.com/jlian/birddex/commit/cc9a18d))
- use valid Tailwind size classes for upload button (size-16/20) ([415c615](https://github.com/jlian/birddex/commit/415c615))
- dialog scrollbar shift, redesign footer with GitHub logo ([40f3c93](https://github.com/jlian/birddex/commit/40f3c93))
- override react-remove-scroll-bar margin to prevent dialog shift ([a7e9c7a](https://github.com/jlian/birddex/commit/a7e9c7a))
- keep scrollbar visible during dialog to prevent shift without gutter ([22c56cb](https://github.com/jlian/birddex/commit/22c56cb))
- scrollbar always visible, larger dialog close button, slower fade animation ([2a6cbe6](https://github.com/jlian/birddex/commit/2a6cbe6))
- remove header top gap, add bottom fade edge ([2af976a](https://github.com/jlian/birddex/commit/2af976a))
- update BootShell skeleton to match current header and homepage layout ([29b889c](https://github.com/jlian/birddex/commit/29b889c))
- scroll to top on navigation, restore position on back ([4894ffa](https://github.com/jlian/birddex/commit/4894ffa))
- iOS share/PWA icons — split manifest purposes, add sizes attribute ([6e886e0](https://github.com/jlian/birddex/commit/6e886e0))
- update e2e specs for new nav and address review feedback ([f1494f6](https://github.com/jlian/birddex/commit/f1494f6))
- update E2E specs for nav redesign ([8e82840](https://github.com/jlian/birddex/commit/8e82840))
- use visible locator for Northern Cardinal in outing detail test ([c8b0238](https://github.com/jlian/birddex/commit/c8b0238))
- restore scroll position on back navigation ([c94cb31](https://github.com/jlian/birddex/commit/c94cb31))
- address second round of review comments ([02f8423](https://github.com/jlian/birddex/commit/02f8423))
- regenerate PWA icons from favicon SVG ([c370070](https://github.com/jlian/birddex/commit/c370070))
- regenerate icons with sharp for proper PNG output ([514f898](https://github.com/jlian/birddex/commit/514f898))
- timezone conversion & taxonomy normalization bugs ([1b8b656](https://github.com/jlian/birddex/commit/1b8b656))
- keep taxonomy aligned with eBird, use wiki override for Chukar ([3efe908](https://github.com/jlian/birddex/commit/3efe908))
- use offset-aware ISO for exifTime and outing timestamps ([8c55ecc](https://github.com/jlian/birddex/commit/8c55ecc))
- convert eBird CSV times from profile TZ to observation-local (#59) ([2a9fe08](https://github.com/jlian/birddex/commit/2a9fe08))
- add 'None' option to TZ picker for eBird World region users ([e30b613](https://github.com/jlian/birddex/commit/e30b613))
- update TZ picker help text — region preference doesn't control export ([e2c1a80](https://github.com/jlian/birddex/commit/e2c1a80))
- update TZ help text — eBird doesn't document export timezone ([f7619a7](https://github.com/jlian/birddex/commit/f7619a7))
- clarify TZ help text — it's the submitting device's timezone ([150ca17](https://github.com/jlian/birddex/commit/150ca17))
- relax outing distance threshold when times nearly match (Merlin case) ([b2fd1ce](https://github.com/jlian/birddex/commit/b2fd1ce))
- sort homepage recent species by firstSeenDate to match BirdDex page ([a6dc546](https://github.com/jlian/birddex/commit/a6dc546))
- address remaining PR review comments ([385a65d](https://github.com/jlian/birddex/commit/385a65d))
- Fix manifest 404 by linking manifest.json ([e688180](https://github.com/jlian/birddex/commit/e688180))

### Code Refactoring
- collapse redundant fixture replay tests, reorder bird detail links ([ad9d1a8](https://github.com/jlian/birddex/commit/ad9d1a8))
- tighten timezone pipeline and resolve review concerns ([dd6812c](https://github.com/jlian/birddex/commit/dd6812c))

### Documentation
- clarify zero-based monthIndex in timezone offset API ([2361280](https://github.com/jlian/birddex/commit/2361280))

### Tests
- add 41 timezone edge case tests across all pipelines ([ece4430](https://github.com/jlian/birddex/commit/ece4430))
- harden timezone pipeline with 30 new tests ([c3c716b](https://github.com/jlian/birddex/commit/c3c716b))
- add e2e integration tests for CSV import + photo upload flow ([6a900f4](https://github.com/jlian/birddex/commit/6a900f4))

### Miscellaneous Chores
- editorial left-aligned homepage hero ([9eecd56](https://github.com/jlian/birddex/commit/9eecd56))
- inline species observed on same line as big number ([367cee5](https://github.com/jlian/birddex/commit/367cee5))
- remove italic, move upload button to right as square icon button ([f5630ef](https://github.com/jlian/birddex/commit/f5630ef))
- premium upload button with gradient, layered shadow, hover lift ([408996b](https://github.com/jlian/birddex/commit/408996b))
- premium circular upload button with gradient and shadow ([5ddcbd1](https://github.com/jlian/birddex/commit/5ddcbd1))
- refined rectangular upload button with subtle gradient ([3ef4956](https://github.com/jlian/birddex/commit/3ef4956))
- inline text upload button, left-aligned with content ([e4c2e09](https://github.com/jlian/birddex/commit/e4c2e09))
- square upload button with icon above text, right-aligned ([af11fd9](https://github.com/jlian/birddex/commit/af11fd9))
- minimal hero — species count + Add button, no sub-stats or divider ([8c06d73](https://github.com/jlian/birddex/commit/8c06d73))
- species observed under number, emerald-to-teal gradient Add button ([0c9d796](https://github.com/jlian/birddex/commit/0c9d796))
- italic subtitle, subtle flat gradient, tighter spacing to content ([c589a7c](https://github.com/jlian/birddex/commit/c589a7c))
- emerald-to-teal horizontal gradient on Add button ([257fea5](https://github.com/jlian/birddex/commit/257fea5))
- slightly larger Add button (px-6 py-3, text-base) ([15cd38c](https://github.com/jlian/birddex/commit/15cd38c))
- translucent sticky header, 150ms fade animation ([1b4c85e](https://github.com/jlian/birddex/commit/1b4c85e))
- address review comments: fix date init, bulk update, User-Agent, header comment ([3d5f387](https://github.com/jlian/birddex/commit/3d5f387))
- less rounded Add button, unbold text, align header with content ([53802f0](https://github.com/jlian/birddex/commit/53802f0))
- remove private CSV from tracking, add to gitignore ([7eaeeaf](https://github.com/jlian/birddex/commit/7eaeeaf))
- move eBird timezone setup into import dialog ([588f4f1](https://github.com/jlian/birddex/commit/588f4f1))
- Load PWA manifest from bundled asset to avoid Spark 404 ([0299465](https://github.com/jlian/birddex/commit/0299465))
- Harden iOS home-screen icon metadata and cache-bust touch icon ([7bdb77e](https://github.com/jlian/birddex/commit/7bdb77e))

## [1.1.0](https://github.com/jlian/birddex/compare/v1.0.2...v1.1.0) (2026-02-15)

### Features
- extract saved locations from eBird CSV import ([3cd4b05](https://github.com/jlian/birddex/commit/3cd4b05))
- Add PWA icons and web manifest for share/home screen support ([1a797d6](https://github.com/jlian/birddex/commit/1a797d6))
- Add sorting to outings list and sort home page recent outings by date (#35) ([c93da7a](https://github.com/jlian/birddex/commit/c93da7a))
- Add scientific names to AI inference and Wikipedia reference images to photo confirmation (#44) ([382eec5](https://github.com/jlian/birddex/commit/382eec5))
- Add coding guidelines for LLM coding practices ([c76e951](https://github.com/jlian/birddex/commit/c76e951))

### Bug Fixes
- Fix iOS Wikimedia thumbnail loading and simplify image pipeline ([1ed8a07](https://github.com/jlian/birddex/commit/1ed8a07))
- restore eBird outing grouping when submission IDs are unique ([4c5d057](https://github.com/jlian/birddex/commit/4c5d057))
- Fix lockfile stability by relaxing Node version requirement ([a0fc30d](https://github.com/jlian/birddex/commit/a0fc30d))
- add Merlin to WIKI_OVERRIDES to show bird article instead of mythical figure ([98ed5c6](https://github.com/jlian/birddex/commit/98ed5c6))
- Fix LLM prompt and species selection UX for high-confidence flow (#33) ([f3ebd10](https://github.com/jlian/birddex/commit/f3ebd10))
- Fix issues #46, #48–#56: upload UX, sort toggles, timezone, location, footer (#57) ([affe544](https://github.com/jlian/birddex/commit/affe544))

### Code Refactoring
- remove saved location handling from eBird import flow ([49a5399](https://github.com/jlian/birddex/commit/49a5399))

### Miscellaneous Chores
- Improve eBird CSV import/export and fix type errors ([df78348](https://github.com/jlian/birddex/commit/df78348))
- Revert unintended package-lock.json changes ([05952c0](https://github.com/jlian/birddex/commit/05952c0))
- Update CI configuration, add .npmrc, and enhance documentation for reproducible installs ([1bbdad1](https://github.com/jlian/birddex/commit/1bbdad1))
- sort WIKI_OVERRIDES alphabetically and update comment to cover disambiguation ([a47ba24](https://github.com/jlian/birddex/commit/a47ba24))
- Rework bird list sort toggles to New/Old/Updated/Frequency/A-Z (#34) ([3e6689b](https://github.com/jlian/birddex/commit/3e6689b))
- Pass location name to bird ID prompt for regional species accuracy (#30) ([30c7b03](https://github.com/jlian/birddex/commit/30c7b03))
- Replace saved locations with outing name autocomplete (#41) ([dfe28f7](https://github.com/jlian/birddex/commit/dfe28f7))

## [1.0.2](https://github.com/jlian/birddex/compare/v1.0.1...v1.0.2) (2026-02-13)

### Bug Fixes
- eBird links, taxonomy grounding, and Wikipedia coverage ([5b1cb31](https://github.com/jlian/birddex/commit/5b1cb31))

## [1.0.1](https://github.com/jlian/birddex/compare/v1.0.0...v1.0.1) (2026-02-13)

### Features
- harden user isolation and auth guard ([79cbee7](https://github.com/jlian/birddex/commit/79cbee7))

### Bug Fixes
- Fix GitHub Spark link in README ([45d5774](https://github.com/jlian/birddex/commit/45d5774))
- Fix link formatting for GitHub Spark in README ([68233e2](https://github.com/jlian/birddex/commit/68233e2))
- Fix GitHub Spark link in README ([3c04961](https://github.com/jlian/birddex/commit/3c04961))
- Fix GitHub Spark link in README ([afd9df5](https://github.com/jlian/birddex/commit/afd9df5))

### Miscellaneous Chores
- stabilize spark resolution and CI install mode ([f93cc93](https://github.com/jlian/birddex/commit/f93cc93))
- sync settings version from package.json ([3cf43aa](https://github.com/jlian/birddex/commit/3cf43aa))

## [1.0.0](https://github.com/jlian/birddex/compare/v0.9.0...v1.0.0) (2026-02-13)

### Highlights
- Reached first stable major release with core BirdDex flows: dark mode, outing title editing, and eBird record-format export.
- Hardened Spark runtime boundaries and KV behavior, including host-gated Spark calls and repeated fetch-loop fixes.
- Improved reliability and UX across theming, portals, dashboard/upload surfaces, and location handling.
- Expanded test coverage (unit, clustering, runtime behavior) and enabled PR smoke-test CI.

<details>
<summary>Historical commit details (1.0.0)</summary>

### Features
- add dark mode support ([95b6674](https://github.com/jlian/birddex/commit/95b6674))
- Add outings title editing with default location reset ([2254dc5](https://github.com/jlian/birddex/commit/2254dc5))
- export record-format CSV and add conformance tests ([d24c628](https://github.com/jlian/birddex/commit/d24c628))
- Add close confirmation dialog, extract helpers, expand e2e tests ([1cefaab](https://github.com/jlian/birddex/commit/1cefaab))
- Add unit tests for P0-P2 coverage gaps ([bcd93ca](https://github.com/jlian/birddex/commit/bcd93ca))

### Bug Fixes
- fix css token scope and stabilize dex/theme flows ([610be90](https://github.com/jlian/birddex/commit/610be90))
- prevent first-paint theme flash ([7b3e852](https://github.com/jlian/birddex/commit/7b3e852))
- gate Spark runtime/KV calls to Spark hosts ([6c97ca0](https://github.com/jlian/birddex/commit/6c97ca0))
- Fix dialog portals to inherit app theme styles ([ff16ca4](https://github.com/jlian/birddex/commit/ff16ca4))
- reconcile dex aggregates and improve privacy-safe location handling ([ec48951](https://github.com/jlian/birddex/commit/ec48951))
- Fix broken pic ([c5de7fd](https://github.com/jlian/birddex/commit/c5de7fd))
- Fix useKV function call ([59867ac](https://github.com/jlian/birddex/commit/59867ac))
- Fix KV probe URL: use /_spark/kv instead of /_spark/kv/keys ([ebdaa01](https://github.com/jlian/birddex/commit/ebdaa01))
- Fix KV probe: test individual key instead of unsupported listing endpoint ([f32e18a](https://github.com/jlian/birddex/commit/f32e18a))
- stop repeated Spark KV fetch loops on rerender ([09ead78](https://github.com/jlian/birddex/commit/09ead78))

### Code Refactoring
- standardize app mount container to spark-app ([6389b02](https://github.com/jlian/birddex/commit/6389b02))
- split Spark KV and localStorage by runtime ([911b9a4](https://github.com/jlian/birddex/commit/911b9a4))

### Tests
- make unit test script auto-discover tests ([0c06da1](https://github.com/jlian/birddex/commit/0c06da1))
- cover stable fallback dev user id behavior ([5eee156](https://github.com/jlian/birddex/commit/5eee156))
- Rewrite README, tighten clustering thresholds to 5hr/6km, add clustering tests, fix resizable.tsx types ([819c3ef](https://github.com/jlian/birddex/commit/819c3ef))
- add local and Spark runtime coverage for useKV ([b55bfbd](https://github.com/jlian/birddex/commit/b55bfbd))

### Continuous Integration
- run smoke tests on pull requests ([94d43f5](https://github.com/jlian/birddex/commit/94d43f5))

### Miscellaneous Chores
- Rename Life List to BirdDex ([23c2c30](https://github.com/jlian/birddex/commit/23c2c30))
- remove temporary root token fallback ([b703b34](https://github.com/jlian/birddex/commit/b703b34))
- fix tailwind screens and make KV sync resilient ([b40f864](https://github.com/jlian/birddex/commit/b40f864))
- use stable local fallback user id ([d291858](https://github.com/jlian/birddex/commit/d291858))
- add boot shell and subtle app fade-in ([c53152d](https://github.com/jlian/birddex/commit/c53152d))
- Standardize portal mounting to app root ([18b03a1](https://github.com/jlian/birddex/commit/18b03a1))
- Align BirdDex sighting list with outing list style ([1d73210](https://github.com/jlian/birddex/commit/1d73210))
- Redesign species detail: square image + inline stats, no cards ([68ee797](https://github.com/jlian/birddex/commit/68ee797))
- add flat eslint config and refresh README ([bc67387](https://github.com/jlian/birddex/commit/bc67387))
- Remove stale test:smoke reference from README ([19d12ae](https://github.com/jlian/birddex/commit/19d12ae))
- Update hero taglines to highlight privacy, batch upload, and cross-referencing ([a744479](https://github.com/jlian/birddex/commit/a744479))
- Simplify hero CTA: rename button and condense taglines ([ad36f7b](https://github.com/jlian/birddex/commit/ad36f7b))
- Restyle home dashboard and upload dialog ([fc71c4a](https://github.com/jlian/birddex/commit/fc71c4a))
- v1.0.0: polish copy, move Upload & Identify to home page, bump version ([f66f3a8](https://github.com/jlian/birddex/commit/f66f3a8))
- Generated by Spark: Please commit the latest changes I just fixed a test ([6bf444e](https://github.com/jlian/birddex/commit/6bf444e))
- Revert "Fix useKV function call" ([5de1fce](https://github.com/jlian/birddex/commit/5de1fce))
- Restore package-lock.json to pre-rewrite state ([182fde3](https://github.com/jlian/birddex/commit/182fde3))
- Rewrite useKV: KV-only in prod, localStorage dev-only with banner ([44ed17e](https://github.com/jlian/birddex/commit/44ed17e))
- Untrack and ignore package-lock.json ([5df7f63](https://github.com/jlian/birddex/commit/5df7f63))
- Restore original package-lock.json for CI ([927e021](https://github.com/jlian/birddex/commit/927e021))
- Revert "Rewrite useKV: KV-only in prod, localStorage dev-only with banner" ([19323f6](https://github.com/jlian/birddex/commit/19323f6))
- Auto-lookup location name from GPS instead of requiring manual button click ([c02e823](https://github.com/jlian/birddex/commit/c02e823))
- Trim README ([b288c9b](https://github.com/jlian/birddex/commit/b288c9b))

</details>

## [0.9.0](https://github.com/jlian/birddex/compare/v0.8.0...v0.9.0) (2026-02-13)

### Features
- Add eBird taxonomy for species autocomplete and AI grounding ([e2990d8](https://github.com/jlian/birddex/commit/e2990d8))
- Add tests for taxonomy, AI inference, and AddPhotosFlow logic ([8d018b0](https://github.com/jlian/birddex/commit/8d018b0))

### Bug Fixes
- Fix Skip crash and improve 429 error message ([911dff0](https://github.com/jlian/birddex/commit/911dff0))
- surface errors to user — toast on geocode/import failures, detailed messages ([278487a](https://github.com/jlian/birddex/commit/278487a))
- remove dead suggestBirdCrop, throw on unparseable AI response ([ee4ee19](https://github.com/jlian/birddex/commit/ee4ee19))

### Code Refactoring
- extract crop-math module, export parseEXIF for testability ([c53a413](https://github.com/jlian/birddex/commit/c53a413))

### Documentation
- add CONTRIBUTING.md, CODE_OF_CONDUCT.md, and package.json metadata ([f36303b](https://github.com/jlian/birddex/commit/f36303b))

### Tests
- import source functions, delete redundant integration tests ([953a87d](https://github.com/jlian/birddex/commit/953a87d))

### Continuous Integration
- run all tests instead of hardcoded subset ([4c9ec46](https://github.com/jlian/birddex/commit/4c9ec46))

## [0.8.0](https://github.com/jlian/birddex/compare/v0.7.0...v0.8.0) (2026-02-13)

### Bug Fixes
- align react-dom version with react to fix #527 mismatch error ([8c2b23b](https://github.com/jlian/birddex/commit/8c2b23b))

### Miscellaneous Chores
- Bump react and @types/react (#1) ([0e49fb1](https://github.com/jlian/birddex/commit/0e49fb1))
- Bump eslint-plugin-react-refresh from 0.4.24 to 0.5.0 (#4) ([ea03c89](https://github.com/jlian/birddex/commit/ea03c89))
- Bump @vitejs/plugin-react-swc from 4.2.2 to 4.2.3 (#5) ([d0fc789](https://github.com/jlian/birddex/commit/d0fc789))
- Simplify CI to build-only, update README ([ae36dcb](https://github.com/jlian/birddex/commit/ae36dcb))
- Update title to BirdDex, use Phosphor Bird favicon, bird pics ([1d3ccf2](https://github.com/jlian/birddex/commit/1d3ccf2))
- Bump react-resizable-panels from 2.1.9 to 4.6.2 (#2) ([d7d56e2](https://github.com/jlian/birddex/commit/d7d56e2))
- Bump eslint-plugin-react-hooks from 5.2.0 to 7.0.1 (#3) ([0c813b2](https://github.com/jlian/birddex/commit/0c813b2))

## [0.7.0](https://github.com/jlian/birddex/compare/v0.6.0...v0.7.0) (2026-02-13)

### Miscellaneous Chores
- eBird import creates outings, add import instructions, confetti on new species ([936e4e8](https://github.com/jlian/birddex/commit/936e4e8))

## [0.6.0](https://github.com/jlian/birddex/compare/v0.5.0...v0.6.0) (2026-02-13)

### Code Refactoring
- extract shared utilities, remove dead code ([cc491d3](https://github.com/jlian/birddex/commit/cc491d3))

### Tests
- Extract shared BirdRow/StatCard components, fix tests, add CI ([eb08078](https://github.com/jlian/birddex/commit/eb08078))

### Miscellaneous Chores
- Polish detail pages, fix nav bug, reorder settings, clean up stale files ([b838f76](https://github.com/jlian/birddex/commit/b838f76))
- Update docs, fix CI console error filter, remove UX_FIXES.md ([ac4d5f1](https://github.com/jlian/birddex/commit/ac4d5f1))

## [0.5.0](https://github.com/jlian/birddex/compare/v0.4.0...v0.5.0) (2026-02-13)

### Features
- consistent cards, animations, seed data, delete data ([59906bd](https://github.com/jlian/birddex/commit/59906bd))

### Bug Fixes
- consistent layout, hash routing, visual polish ([57ba8eb](https://github.com/jlian/birddex/commit/57ba8eb))

### Miscellaneous Chores
- Compact Merlin-style rows, sorting, tighter spacing, logo nav ([e4aacae](https://github.com/jlian/birddex/commit/e4aacae))

## [0.4.0](https://github.com/jlian/birddex/compare/v0.3.0...v0.4.0) (2026-02-13)

### Features
- outing detail view, saved locations UI, title/favicon, PRD updates ([1750b7a](https://github.com/jlian/birddex/commit/1750b7a))
- responsive desktop layout, top nav, homepage redesign, species detail view ([cb0a8b3](https://github.com/jlian/birddex/commit/cb0a8b3))

### Miscellaneous Chores
- add implementation status + priorities; stop persisting photo blobs to KV ([1371660](https://github.com/jlian/birddex/commit/1371660))

## [0.3.0](https://github.com/jlian/birddex/compare/v0.2.0...v0.3.0) (2026-02-13)

### Features
- Add Playwright smoke tests (7 tests: load, nav, dialog, mobile viewport) ([11161ea](https://github.com/jlian/birddex/commit/11161ea))

### Miscellaneous Chores
- UX overhaul: reverse-birding identity, Wikimedia images, outing merging, 8hr clustering ([70623fa](https://github.com/jlian/birddex/commit/70623fa))

## [0.2.0](https://github.com/jlian/birddex/compare/v0.1.0...v0.2.0) (2026-02-13)

### Bug Fixes
- Fix mobile crop, rework bird ID flow, add AI zoom, add tests ([ed04cbc](https://github.com/jlian/birddex/commit/ed04cbc))
- Fix 11 UX issues: crop overlay, back nav, accessibility, error handling ([a8a4c9a](https://github.com/jlian/birddex/commit/a8a4c9a))
- Fix AI zoom: use canvas crop instead of broken CSS percentage math ([b61dbc8](https://github.com/jlian/birddex/commit/b61dbc8))

## [0.1.0](https://github.com/jlian/birddex/releases/tag/v0.1.0) (2026-02-12)

### Highlights
- Bootstrapped the first working BirdDex prototype in Spark, including initial app structure and storage setup.
- Iterated rapidly on crop, identification, and outing-detection behavior during early product discovery.

<details>
<summary>Historical commit details (0.1.0)</summary>

### Features
- Add spark configuration ([b9fe63b](https://github.com/jlian/birddex/commit/b9fe63b))

### Miscellaneous Chores
- Initial commit ([13403ed](https://github.com/jlian/birddex/commit/13403ed))
- Generated by Spark: Build a mobile-first web app called “Bird-Dex” that is its own bird life-list + sighting tracker, and is compatible with eBird (import/export) and Merlin (Merlin-like life list UX + optional eBird bridge). ([0e67380](https://github.com/jlian/birddex/commit/0e67380))
- Generated by Spark: Fix all reported errors. ([13e67e9](https://github.com/jlian/birddex/commit/13e67e9))
- Generated by Spark: How is the list stored? Just on the VM? Or can we have the list be stored in the user GitHub profile, maybe as a gist that could be either public or private? ([d73d091](https://github.com/jlian/birddex/commit/d73d091))
- Generated by Spark: Ok first the outing identification should be automatic via EXIF ([1c8009b](https://github.com/jlian/birddex/commit/1c8009b))
- Generated by Spark: The cropping didn't happen. The birds were not identified. The outing parsing also didn't work, it should mention a place and then ask the user to confirm or edit ([b917f0f](https://github.com/jlian/birddex/commit/b917f0f))
- Generated by Spark: Ok still no cropping and still no bird ID ([2621561](https://github.com/jlian/birddex/commit/2621561))
- Generated by Spark: Why is there still no crop? Are we doing AI crop? I was thinking user crop. Maybe it could be AI crop first and then user confirm? ([ddab6d4](https://github.com/jlian/birddex/commit/ddab6d4))
- Edited Spark ([6dcd4ef](https://github.com/jlian/birddex/commit/6dcd4ef))
- Generated by Spark: I'm still not seeing a crop box or any indication of AI crop ([250f892](https://github.com/jlian/birddex/commit/250f892))
- Generated by Spark: Nope, all the same issues I just mentioned none are fixed, no crop, no outing location detection, and no bird ID ([e132657](https://github.com/jlian/birddex/commit/e132657))
- Edited Spark ([aa1289d](https://github.com/jlian/birddex/commit/aa1289d))
- Generated by Spark: Alright I was just in code spaces making a bunch of changes. Now can you just commit it ([ce1e3da](https://github.com/jlian/birddex/commit/ce1e3da))
- Edited Spark ([4240782](https://github.com/jlian/birddex/commit/4240782))
- Generated by Spark: Please commit ([bd76c39](https://github.com/jlian/birddex/commit/bd76c39))
- Edited Spark ([b87b4e5](https://github.com/jlian/birddex/commit/b87b4e5))
- Generated by Spark: Please commit we fixed the storage situation. Why is it not possible to commit in the codespace ([acd4d27](https://github.com/jlian/birddex/commit/acd4d27))
- Edited Spark ([1336bea](https://github.com/jlian/birddex/commit/1336bea))
- Generated by Spark: Please commit again ([9a89471](https://github.com/jlian/birddex/commit/9a89471))

</details>
