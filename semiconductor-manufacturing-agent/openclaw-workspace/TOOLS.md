# TOOLS.md - Semiconductor Manufacturing Demo Tools
# TOOLS.md - 半導體製造示範工具

## Offline Demo Runner
## 離線示範執行器

Run from the demo root.
請從示範根目錄執行。

```bash
node scripts/demo-runner.mjs all
```

Single-use-case runs are available.
也可以執行單一使用案例。

```bash
node scripts/demo-runner.mjs maintenance
node scripts/demo-runner.mjs quality
node scripts/demo-runner.mjs schedule
node scripts/demo-runner.mjs supplier
node scripts/demo-runner.mjs diagnostics
node scripts/demo-runner.mjs triage
```

The default report is bilingual.
預設報告為雙語。

Use `--lang en` or `--lang zh-TW` only when a single-language output is explicitly requested.
只有在明確要求單一語言輸出時，才使用 `--lang en` 或 `--lang zh-TW`。

## Output
## 輸出

The runner writes the bilingual report here.
執行器會將雙語報告寫入此處。

```text
output/manufacturing-agent-report.md
```

Use this report as tool evidence when briefing the user.
向使用者簡報時，請將此報告作為工具證據。

## LINE Webhook
## LINE Webhook

Run the LINE Messaging API webhook from the demo root.
請從示範根目錄執行 LINE Messaging API webhook。

```bash
npm run line:webhook
```

The webhook accepts text commands such as `maintenance`, `quality`, `schedule`, `supplier`, `diagnostics`, `triage`, and `all`.
Webhook 接受 `maintenance`、`quality`、`schedule`、`supplier`、`diagnostics`、`triage` 與 `all` 等文字指令。

It verifies `x-line-signature`, runs the demo runner with `--no-write`, and replies through the LINE reply API.
它會驗證 `x-line-signature`、以 `--no-write` 執行示範工具，並透過 LINE reply API 回覆。

Use `.env.example` as the configuration template.
請使用 `.env.example` 作為設定範本。
