# Changelog

## [0.2.2](https://github.com/vertracloud/mcp/compare/v0.2.1...v0.2.2) (2026-10-18)


### Bug Fixes

* **apps:** handle asynchronous app creation with wait_for_app and build error guidance ([e97349d](https://github.com/vertracloud/mcp/commit/e97349d130037f2644cf727014036714475fb140))
* **deps:** bump @vertracloud/api-types to 0.4.3 ([751ccbf](https://github.com/vertracloud/mcp/commit/751ccbf8961679a447b2240e8beb9b1222b4a927))

## [0.2.1](https://github.com/vertracloud/mcp/compare/v0.2.0...v0.2.1) (2026-10-15)


### Features

* **blob:** add rename_on_conflict to upload_blob ([ae6f71b](https://github.com/vertracloud/mcp/commit/ae6f71bcbd603794738003728440df6951a9d78d))

## [0.2.0](https://github.com/vertracloud/mcp/compare/v0.1.3...v0.2.0) (2026-10-15)


### Features

* add Blob Storage tools ([cde0037](https://github.com/vertracloud/mcp/commit/cde0037ccf76d48530a078f334f1ac76eae7ddf9))
* describe Pix QR and invoice expiry in billing tools ([d0f4e77](https://github.com/vertracloud/mcp/commit/d0f4e7785d2c096c7484e14140070ff433234313))


### Bug Fixes

* resolve local paths before checking the root and the sensitive-file list ([aa58af5](https://github.com/vertracloud/mcp/commit/aa58af583128abbd4bb2bf8ce3d6a41200bd99c9))

## [0.1.3](https://github.com/vertracloud/mcp/compare/v0.1.2...v0.1.3) (2026-10-12)


### Features

* **tools:** releases, rollback and deploy settings ([4946149](https://github.com/vertracloud/mcp/commit/4946149730ebba4f850d9473f6537f29eeaaed89))

## [0.1.2](https://github.com/vertracloud/mcp/compare/v0.1.1...v0.1.2) (2026-10-05)


* release 0.1.2 ([2b30de1](https://github.com/vertracloud/mcp/commit/2b30de18b3e464b87269a1effaca19bf58aad827))


### Features

* billing details tool, build command and FREE_PLAN_SUSPENDED hints ([bc53de4](https://github.com/vertracloud/mcp/commit/bc53de4e6073242c885d6a9e43d59cf6f803812d))

## [0.1.1](https://github.com/vertracloud/mcp/compare/v0.1.0...v0.1.1) (2026-09-23)


### Bug Fixes

* bump @vertracloud/api-types to 0.2.1 ([6f430aa](https://github.com/vertracloud/mcp/commit/6f430aa8df13f3a6187082eef28ce8baaba36fe5))
* drop resource-organization segment from folder and favorite routes ([5dab1a2](https://github.com/vertracloud/mcp/commit/5dab1a2039e8dd50deac854dcf9ca048fc82885f))
* regenerate lockfile to drop stale cross-repo entries ([aa393a1](https://github.com/vertracloud/mcp/commit/aa393a1b5cc1b6a8ab099af078b9e15e343e983b))

## 0.1.0 (2026-09-23)


### Features

* add local filesystem access and knowledge base fetcher ([9a43ecd](https://github.com/vertracloud/mcp/commit/9a43ecd060d410a08f694685b67e96f26c283d77))
* add MCP server, stdio transport and tool registry ([2658b0a](https://github.com/vertracloud/mcp/commit/2658b0aff3ed205e2929f83593580c086bb58832))
* add Vertra Cloud API client and tool result helpers ([d0a58c3](https://github.com/vertracloud/mcp/commit/d0a58c369a3d0c3ccaf269289e2909411f9871ce))


### Bug Fixes

* reject paths that escape the allowed root through symlinked directories ([3da07a8](https://github.com/vertracloud/mcp/commit/3da07a865432c72ae8f4c2e939af8bb3af087582))
