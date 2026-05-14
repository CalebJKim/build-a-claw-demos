# AGENTS.md - Semiconductor Manufacturing Ops Agent Instructions
# AGENTS.md - 半導體製造營運代理指引

## Local Demo Files
## 本機示範檔案

- `data/machines.json` - Fab tool, chamber, FDC, and equipment telemetry.
- `data/machines.json` - 晶圓廠設備、腔體、FDC 與設備遙測資料。
- `data/quality_samples.json` - SPC and wafer metrology sample history.
- `data/quality_samples.json` - SPC 與晶圓量測樣本歷史。
- `data/work_orders.json` - Active wafer lot runs and process routes.
- `data/work_orders.json` - 進行中晶圓批次執行單與製程路線。
- `data/inventory.json` - Critical cleanroom material position.
- `data/inventory.json` - 關鍵無塵室物料庫存狀態。
- `data/supplier_shipments.json` - Supplier delivery risk.
- `data/supplier_shipments.json` - 供應商交貨風險。
- `data/diagnostics_events.json` - FDC and diagnostics report signals.
- `data/diagnostics_events.json` - FDC 與診斷報告訊號。
- `data/triage_cases.json` - Automated triage and resolution candidates.
- `data/triage_cases.json` - 自動化分級與解決方案候選。
- `scripts/demo-runner.mjs` - Analysis runner.
- `scripts/demo-runner.mjs` - 分析執行器。

## Recommended Workflow
## 建議工作流程

Read the relevant files in `data/`.
讀取 `data/` 中的相關檔案。

Run `node scripts/demo-runner.mjs all` or a narrower use case.
執行 `node scripts/demo-runner.mjs all` 或更窄的單一使用案例。

Read `output/manufacturing-agent-report.md`.
讀取 `output/manufacturing-agent-report.md`。

Brief the user with facts, inferences, recommendations, and approvals.
以事實、推論、建議與核准關卡向使用者簡報。

## Approval Rules
## 核准規則

You may draft equipment diagnostic reports.
你可以起草設備診斷報告。

You may draft quality hold recommendations.
你可以起草品質暫停建議。

You may draft WIP dispatch recovery options.
你可以起草 WIP 派工復原選項。

You may draft supplier expedite messages.
你可以起草供應商急件訊息。

You may draft automated triage and resolution recommendations.
你可以起草自動化分級與解決建議。

You may draft manager briefings.
你可以起草管理者簡報。

You must not execute these actions directly.
你不得直接執行這些行動。

Ask for explicit approval and name the system owner.
請要求明確核准，並列出系統負責人。
