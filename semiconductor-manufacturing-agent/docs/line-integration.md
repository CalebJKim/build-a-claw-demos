# LINE Integration
# LINE 整合

This project can expose the semiconductor Manufacturing Ops agent demo as a LINE Messaging API bot.
此專案可將半導體 Manufacturing Ops 代理示範公開為 LINE Messaging API bot。

The integration is implemented in `scripts/line-webhook.mjs`.
整合實作位於 `scripts/line-webhook.mjs`。

It uses only Node.js built-in modules.
它只使用 Node.js 內建模組。

## What The Webhook Does
## Webhook 功能

The webhook receives LINE webhook events at `/line/webhook`.
Webhook 會在 `/line/webhook` 接收 LINE webhook event。

It verifies the `x-line-signature` header before parsing the JSON body.
它會在解析 JSON body 前驗證 `x-line-signature` header。

It maps text messages to the demo modes `all`, `maintenance`, `quality`, `schedule`, `supplier`, `diagnostics`, and `triage`.
它會將文字訊息對應到 `all`、`maintenance`、`quality`、`schedule`、`supplier`、`diagnostics` 與 `triage` 等示範模式。

It runs `scripts/demo-runner.mjs` with `--no-write` so chat requests do not overwrite the saved report.
它會用 `--no-write` 執行 `scripts/demo-runner.mjs`，因此聊天請求不會覆寫已儲存的報告。

It replies through the LINE reply message endpoint using the event `replyToken`.
它會使用 event 的 `replyToken`，透過 LINE reply message endpoint 回覆。

## Configure LINE
## 設定 LINE

Create a LINE Messaging API channel in the LINE Developers Console.
請在 LINE Developers Console 建立 LINE Messaging API channel。

Enable webhooks for the channel.
請為該 channel 啟用 webhook。

Copy the channel secret from the channel basic settings.
請從 channel basic settings 複製 channel secret。

Issue or copy a channel access token from the Messaging API settings.
請從 Messaging API settings 發行或複製 channel access token。

Create a local `.env` file from the sample file.
請從範例檔建立本機 `.env` 檔案。

```bash
cp .env.example .env
```

Fill in these values.
填入下列值。

```bash
LINE_CHANNEL_SECRET=replace-with-line-channel-secret
LINE_CHANNEL_ACCESS_TOKEN=replace-with-line-channel-access-token
PORT=3000
HOST=0.0.0.0
LINE_WEBHOOK_PATH=/line/webhook
LINE_DEFAULT_LANG=bilingual
```

Do not commit `.env`.
請不要提交 `.env`。

## Run Locally
## 本機執行

Export the environment variables or load them with your preferred shell tooling.
請匯出環境變數，或用你偏好的 shell 工具載入它們。

The webhook also loads `.env` from the project root automatically.
Webhook 也會自動從專案根目錄載入 `.env`。

Start the webhook server.
啟動 webhook 伺服器。

```bash
npm run line:webhook
```

Open `http://localhost:3000/health` to confirm the process is running.
開啟 `http://localhost:3000/health` 確認程序正在執行。

Expose the server through an HTTPS tunnel.
請透過 HTTPS tunnel 公開此伺服器。

Set the LINE webhook URL to the public tunnel URL plus `/line/webhook`.
請將 LINE webhook URL 設為公開 tunnel URL 加上 `/line/webhook`。

For example, if the tunnel URL is `https://example-tunnel.ngrok-free.app`, the LINE webhook URL is `https://example-tunnel.ngrok-free.app/line/webhook`.
例如，如果 tunnel URL 是 `https://example-tunnel.ngrok-free.app`，則 LINE webhook URL 為 `https://example-tunnel.ngrok-free.app/line/webhook`。

## Chat Commands
## 聊天指令

Send `all` to get the full bilingual report.
傳送 `all` 可取得完整雙語報告。

Send `maintenance` to run fab tool health triage.
傳送 `maintenance` 可執行晶圓廠設備健康分級。

Send `quality` to run wafer quality excursion containment.
傳送 `quality` 可執行晶圓品質異常圍堵。

Send `schedule` to run fab WIP dispatch recovery.
傳送 `schedule` 可執行晶圓廠 WIP 派工復原。

Send `supplier` to run critical materials disruption response.
傳送 `supplier` 可執行關鍵物料中斷應變。

Send `diagnostics` to generate a diagnostics report.
傳送 `diagnostics` 可產生診斷報告。

Send `triage` to generate automated triage and resolution recommendations.
傳送 `triage` 可產生自動化分級與解決建議。

Add `en`, `zh`, or `bilingual` to request a specific output language.
加入 `en`、`zh` 或 `bilingual` 可指定輸出語言。

For example, send `zh diagnostics` for a Traditional Mandarin diagnostics response.
例如，傳送 `zh diagnostics` 可取得繁體中文診斷回覆。

## Local Dry Run
## 本機 Dry Run

Use dry-run mode to test without sending replies to LINE.
使用 dry-run 模式可在不傳送 LINE 回覆的情況下測試。

```bash
LINE_CHANNEL_SECRET=test-secret LINE_REPLY_DRY_RUN=1 PORT=3000 npm run line:webhook
```

When dry-run mode is enabled, the server logs the reply text instead of calling the LINE reply API.
啟用 dry-run 模式時，伺服器會將回覆文字寫入 log，而不是呼叫 LINE reply API。

Use `LINE_SKIP_SIGNATURE=1` only for local webhook experiments.
只有在本機 webhook 實驗時才使用 `LINE_SKIP_SIGNATURE=1`。

Do not use `LINE_SKIP_SIGNATURE=1` for a real LINE webhook.
請勿在真實 LINE webhook 中使用 `LINE_SKIP_SIGNATURE=1`。

## Security Notes
## 安全注意事項

The webhook verifies the raw request body before parsing it.
Webhook 會在解析前驗證原始 request body。

This is required because changing the body before signature verification will make the LINE signature invalid.
這是必要的，因為在簽章驗證前變更 body 會導致 LINE 簽章失效。

The channel access token is used only when replying to LINE.
Channel access token 只會在回覆 LINE 時使用。

The webhook does not modify production, quality, safety, recipe, equipment-control, purchasing, or WIP dispatch systems.
Webhook 不會修改生產、品質、安全、recipe、設備控制、採購或 WIP 派工系統。
