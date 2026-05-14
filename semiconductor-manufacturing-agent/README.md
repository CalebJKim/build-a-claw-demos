# GTC Taipei NemoClaw Semiconductor Manufacturing Agent
# GTC Taipei NemoClaw 半導體製造代理

This workspace contains a semiconductor manufacturing OpenClaw agent demo designed to run inside a NemoClaw-managed OpenShell sandbox.
此工作區包含一個半導體製造 OpenClaw 代理示範，設計用於 NemoClaw 管理的 OpenShell 沙盒中執行。

The demo shows how an agent can assist a fab operations team without being allowed to act directly on production, quality, recipe, or equipment-control systems.
此示範展示代理如何協助晶圓廠營運團隊，而不直接操作生產、品質、recipe 或設備控制系統。

It reads synthetic fab data, reasons over semiconductor-specific use cases, and produces shift-ready recommendations with explicit approval gates.
代理會讀取合成晶圓廠資料、針對半導體專用使用案例進行推理，並產出適合班別團隊採用且明確標示核准關卡的建議。

## What Is Included
## 內容

- `openclaw-workspace/` - OpenClaw workspace files for the `manufacturing-ops` agent.
- `openclaw-workspace/` - `manufacturing-ops` 代理的 OpenClaw 工作區檔案。
- `agent/manufacturing-ops-agent.md` - Full agent design and operating instructions.
- `agent/manufacturing-ops-agent.md` - 完整代理設計與操作指引。
- `data/` - Synthetic fab tool, wafer lot, SPC, WIP, material, supplier, diagnostics, and triage data.
- `data/` - 合成晶圓廠設備、晶圓批次、SPC、WIP、物料、供應商、診斷與分級資料。
- `scripts/demo-runner.mjs` - Dependency-free demo tool that generates semiconductor manufacturing recommendations.
- `scripts/demo-runner.mjs` - 無外部相依的示範工具，用於產生半導體製造營運建議。
- `scripts/bootstrap-openclaw-agent.sh` - Run inside the sandbox to register the OpenClaw agent.
- `scripts/bootstrap-openclaw-agent.sh` - 在沙盒內註冊 OpenClaw 代理。
- `scripts/upload-to-openshell.sh` - Run on the host to upload this demo into an OpenShell sandbox.
- `scripts/upload-to-openshell.sh` - 在主機上執行，將此示範上傳到 OpenShell 沙盒。
- `policies/manufacturing-integrations.yaml` - OpenShell/NemoClaw policy preset for representative manufacturing integrations.
- `policies/manufacturing-integrations.yaml` - 代表性製造系統整合的 OpenShell/NemoClaw 政策預設範例。

## Run The Demo Locally
## 在本機執行示範

Run the full bilingual report.
執行完整的雙語報告。

```bash
node scripts/demo-runner.mjs all
```

or:
或：

```bash
npm run demo
```

The bilingual report is written to `output/manufacturing-agent-report.md`.
雙語報告會寫入 `output/manufacturing-agent-report.md`。

You can also run one use case at a time.
你也可以一次只執行一個使用案例。

```bash
node scripts/demo-runner.mjs maintenance
node scripts/demo-runner.mjs quality
node scripts/demo-runner.mjs schedule
node scripts/demo-runner.mjs supplier
node scripts/demo-runner.mjs diagnostics
node scripts/demo-runner.mjs triage
```

Optional single-language output is still available with `--lang en` or `--lang zh-TW`.
如需單一語言輸出，仍可使用 `--lang en` 或 `--lang zh-TW`。

## Chat With The Agent On LINE
## 透過 LINE 與代理對話

This project includes a dependency-free LINE Messaging API webhook.
此專案包含一個無外部相依的 LINE Messaging API webhook。

The webhook receives text messages from LINE, maps them to semiconductor manufacturing agent use cases, runs the local demo runner, and replies with the agent output.
Webhook 會接收來自 LINE 的文字訊息、對應到半導體製造代理使用案例、執行本機示範工具，並回覆代理輸出。

Create a `.env` file from `.env.example` and add your LINE channel secret and channel access token.
請從 `.env.example` 建立 `.env` 檔案，並填入你的 LINE channel secret 與 channel access token。

```bash
cp .env.example .env
```

Start the webhook server.
啟動 webhook 伺服器。

```bash
npm run line:webhook
```

Expose the local server through your preferred HTTPS tunnel, then set the LINE webhook URL to `/line/webhook`.
請使用你偏好的 HTTPS tunnel 公開本機伺服器，然後將 LINE webhook URL 設為 `/line/webhook`。

Example commands users can send in LINE are `maintenance`, `quality`, `schedule`, `supplier`, `diagnostics`, `triage`, and `all`.
使用者可在 LINE 中傳送的範例指令包括 `maintenance`、`quality`、`schedule`、`supplier`、`diagnostics`、`triage` 與 `all`。

Add `en`, `zh`, or `bilingual` to request a specific output language.
加入 `en`、`zh` 或 `bilingual` 可指定輸出語言。

See `docs/line-integration.md` for setup and local testing details.
設定與本機測試細節請參閱 `docs/line-integration.md`。

## Run Inside NemoClaw + OpenShell
## 在 NemoClaw + OpenShell 中執行

1. Confirm the NemoClaw sandbox exists.
1. 確認 NemoClaw 沙盒存在。

```bash
nemoclaw list
```

2. If needed, create or reconfigure a sandbox.
2. 如有需要，建立或重新設定沙盒。

```bash
nemoclaw onboard
```

3. Upload this demo into the sandbox.
3. 將此示範上傳到沙盒。

```bash
./scripts/upload-to-openshell.sh my-assistant
```

4. Connect to the sandbox.
4. 連線到沙盒。

```bash
nemoclaw my-assistant connect
```

5. Inside the sandbox, register the OpenClaw agent and run the demo.
5. 在沙盒中註冊 OpenClaw 代理並執行示範。

```bash
cd /sandbox/manufacturing-agent
./scripts/bootstrap-openclaw-agent.sh
node scripts/demo-runner.mjs all
```

6. Ask OpenClaw to use the registered agent.
6. 要求 OpenClaw 使用已註冊的代理。

```bash
openclaw agent --agent manufacturing-ops --message "Review the semiconductor fab demo output and brief a shift lead on the top tool, wafer quality, WIP, material, diagnostics, and triage risks."
```

## Apply Manufacturing Network Policy
## 套用製造網路政策

NemoClaw uses deny-by-default network policy through OpenShell.
NemoClaw 透過 OpenShell 使用預設拒絕的網路政策。

The policy preset in `policies/manufacturing-integrations.yaml` allows representative read-only access to the following systems.
`policies/manufacturing-integrations.yaml` 中的政策預設允許對下列代表性系統進行唯讀存取。

- MES and WIP dispatch API.
- MES 與 WIP 派工 API。
- QMS, SPC, and wafer disposition API.
- QMS、SPC 與晶圓處置 API。
- FDC, historian, and equipment telemetry API.
- FDC、歷史資料庫與設備遙測 API。
- Critical-material supplier visibility API.
- 關鍵物料供應商可視性 API。
- LINE Messaging API reply endpoint.
- LINE Messaging API 回覆端點。

For a persistent NemoClaw preset, copy the file to the NemoClaw preset directory on the host and apply it through `nemoclaw <sandbox> policy-add`.
若要建立持久的 NemoClaw 預設，請在主機上將檔案複製到 NemoClaw 預設目錄，並透過 `nemoclaw <sandbox> policy-add` 套用。

```bash
cp policies/manufacturing-integrations.yaml ~/.nemoclaw/source/nemoclaw-blueprint/policies/presets/manufacturing.yaml
nemoclaw my-assistant policy-add
```

For one-off evaluation, use the OpenShell TUI.
若只需一次性評估，可使用 OpenShell TUI。

```bash
openshell term
```

## Human Approval Model
## 人工核准模型

The agent may recommend, rank, draft, summarize, and create proposed fab operator actions.
代理可以建議、排序、起草、摘要並建立擬議的晶圓廠操作行動。

It must not change tool recipes, chamber settings, equipment-control state, AMHS state, or safety interlocks.
代理不得變更設備 recipe、腔體設定、設備控制狀態、AMHS 狀態或安全互鎖。

It must not release held material.
代理不得放行暫停物料。

It must not create or approve purchase orders.
代理不得建立或核准採購訂單。

It must not override QA disposition.
代理不得覆寫 QA 處置。

It must not modify WIP dispatch, route qualification, or production schedules without a named human approver.
代理不得在沒有具名人工核准者的情況下修改 WIP 派工、路線資格或生產排程。

That separation is the point of the demo: NemoClaw and OpenShell constrain the environment, while the agent demonstrates useful fab-floor reasoning inside those boundaries.
此分離正是示範的重點：NemoClaw 與 OpenShell 約束執行環境，而代理在這些邊界內展示有價值的晶圓廠現場推理能力。
