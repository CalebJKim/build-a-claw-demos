# Semiconductor Manufacturing Ops Agent Report
# 半導體製造營運代理報告

Generated: 2026-05-11T17:00:00.000Z
產生時間：2026-05-11T17:00:00.000Z

This report uses synthetic fab data for a NemoClaw/OpenShell semiconductor manufacturing agent demo.
本報告使用合成晶圓廠資料，用於 NemoClaw/OpenShell 半導體製造代理示範。

The agent recommends actions but does not execute production, quality, safety, recipe, equipment-control, purchasing, or WIP dispatch changes.
代理會提出建議行動，但不會執行任何生產、品質、安全、recipe、設備控制、採購或 WIP 派工變更。

## Fab Tool Health Triage
## 晶圓廠設備健康分級

**Summary:** ETCH-07B is the highest fab tool risk at 100/100 (critical) for RF-PMIC-M1 metal etch.
**摘要：** ETCH-07B 是 RF-PMIC-M1 metal etch 的最高晶圓廠設備風險，分數為 100/100（嚴重）。

**Facts**
**事實**
- ETCH-07B RF reflected power is 1380 W and ESC helium leak is 5.8 sccm.
- ETCH-07B 的 RF 反射功率為 1380 W，ESC 氦氣洩漏為 5.8 sccm。
- ETCH-07B has 28 particle adders per wafer and 1420/1500 wafers since PM.
- ETCH-07B 每片晶圓新增粒子數為 28，且 PM 後已處理 1420/1500 片晶圓。
- Faults: RF_MATCH_DRIFT, ESC_HE_LEAK_TREND_UP, PARTICLE_ADDER_ALARM.
- 故障碼：RF_MATCH_DRIFT, ESC_HE_LEAK_TREND_UP, PARTICLE_ADDER_ALARM。
- Active wafer lots routed through ETCH-07B: LOT-10481, LOT-10482.
- 經過 ETCH-07B 的進行中晶圓批次：LOT-10481, LOT-10482。

**Inference**
**推論**
- Pattern is consistent with RF match drift, chamber polymer buildup, or an ESC helium leak.
- 此模式與 RF 匹配漂移、腔體聚合物堆積或 ESC 氦氣洩漏相符。

**Recommended Actions**
**建議行動**
- Create an equipment diagnostic report draft for ETCH-07B before 2026-05-13T03:00:00-05:00.
- 在 2026-05-13T03:00:00-05:00 前，為 ETCH-07B 建立設備診斷報告草稿。
- Ask equipment engineering to inspect RF match tuning, chamber kit condition, ESC helium seal, and endpoint trace drift.
- 請設備工程檢查 RF 匹配調校、腔體套件狀況、ESC 氦氣密封與 endpoint trace 漂移。
- Run monitor wafer and increase CD-SEM sampling until equipment engineering clears the chamber.
- 在設備工程確認腔體狀態前，執行 monitor wafer 並提高 CD-SEM 抽測頻率。

**Approval Gates**
**核准關卡**
- Equipment engineer approval required before taking the chamber down.
- 腔體停機前需要設備工程師核准。
- Manufacturing supervisor approval required before rerouting active wafer lots.
- 變更進行中晶圓批次路線前需要製造主管核准。

## Wafer Quality Excursion Containment
## 晶圓品質異常圍堵

**Summary:** ETCH-07B shows post_etch_cd_nm drift of 1.6 nm with suspect wafer lots WAFERLOT-7782.
**摘要：** ETCH-07B 的 post_etch_cd_nm 出現 1.6 nm 漂移，疑似晶圓批號為 WAFERLOT-7782。

**Facts**
**事實**
- post_etch_cd_nm moved from 38.2 nm to 39.8 nm.
- post_etch_cd_nm 從 38.2 nm 移動到 39.8 nm。
- 1 sample is out of specification and 2 are near limit.
- 1 筆樣本超出規格，2 筆接近規格界限。
- Impacted wafer lot run(s): LOT-10481.
- 受影響晶圓批次執行單：LOT-10481。

**Inference**
**推論**
- CD drift aligns with the same etch chamber highlighted by tool health risk, so a chamber-condition root cause is plausible.
- CD 漂移與設備健康風險所指向的同一蝕刻腔體一致，因此腔體狀態根因是合理假設。

**Recommended Actions**
**建議行動**
- Place a quality review hold on wafer lots WAFERLOT-7782 pending disposition.
- 對晶圓批號 WAFERLOT-7782 建議品質審查暫停，等待處置決策。
- Increase CD-SEM sampling for the next two wafer lots from the same chamber.
- 針對同一腔體接下來兩個晶圓批次提高 CD-SEM 抽樣頻率。
- Compare recipe, endpoint, RF, and chamber-clean history against the last known-good lot.
- 將 recipe、endpoint、RF 與腔體清潔歷史與上一個已知良好批次進行比對。

**Approval Gates**
**核准關卡**
- Quality owner approval required for wafer lot hold or release.
- 晶圓批次暫停或放行需要品質負責人核准。
- Process engineer approval required before changing recipe parameters or route qualification.
- 變更 recipe 參數或路線資格前需要製程工程師核准。

## Fab WIP Dispatch Recovery
## 晶圓廠 WIP 派工復原

**Summary:** 2 active wafer lot run(s) are exposed to ETCH-07B; ETCH-09B is the best alternate chamber option.
**摘要：** 2 張進行中晶圓批次執行單暴露於 ETCH-07B 風險；ETCH-09B 是最佳替代腔體選項。

**Facts**
**事實**
- LOT-10481: 15 wafers remaining, due in 1 day, priority expedite.
- LOT-10481：剩餘 15 片晶圓，1 天後到期，優先級為急件。
- LOT-10482: 25 wafers remaining, due in 2 days, priority standard.
- LOT-10482：剩餘 25 片晶圓，2 天後到期，優先級為標準。

**Inference**
**推論**
- ETCH-09B can absorb RF-PMIC-M1 metal etch lots after chamber matching and golden-recipe validation.
- ETCH-09B 可在完成腔體匹配與 golden recipe 驗證後承接 RF-PMIC-M1 metal etch 批次。

**Recommended Actions**
**建議行動**
- Move the next standard RF-PMIC-M1 lot to ETCH-09B and reserve ETCH-07B for expedite exposure only until diagnostics are complete.
- 將下一個標準 RF-PMIC-M1 批次移至 ETCH-09B，在診斷完成前僅保留 ETCH-07B 處理急件暴露量。
- Protect METRO-01 CD-SEM capacity for containment inspection before releasing suspect wafer lots.
- 在疑似晶圓批次放行前，保留 METRO-01 CD-SEM 產能用於圍堵檢查。
- Recalculate WIP dispatch after equipment diagnostics and CD-SEM disposition are known.
- 設備診斷與 CD-SEM 處置確認後重新計算 WIP 派工。

**Approval Gates**
**核准關卡**
- Production control approval required for WIP dispatch changes.
- WIP 派工變更需要生產管制核准。
- Quality approval required before moving any wafer lot under containment review.
- 任何處於圍堵審查中的晶圓批次移轉前需要品質核准。

## Critical Materials Disruption Response
## 關鍵物料中斷應變

**Summary:** PR-193I-248 is the highest semiconductor material risk with 0.33 days of unallocated cover and ETA 2026-05-13.
**摘要：** PR-193I-248 是最高半導體物料風險，未分配庫存覆蓋天數為 0.33 天，最新 ETA 為 2026-05-13。

**Facts**
**事實**
- Formosa Electronic Materials shipment is delayed by 2 days; reason: cold-chain hold at Taoyuan customs.
- Formosa Electronic Materials 出貨延遲 2 天；原因：桃園海關冷鏈查驗暫停。
- Net available after allocation: 4 liters.
- 分配後淨可用量：4 公升。
- Impacted wafer lot run(s): LOT-10481, LOT-10482.
- 受影響晶圓批次執行單：LOT-10481, LOT-10482。

**Inference**
**推論**
- Material risk compounds the RF-PMIC-M1 WIP risk because the same lots depend on the constrained 193 nm immersion photoresist for RF-PMIC-M1 metal layer.
- 物料風險會放大 RF-PMIC-M1 WIP 風險，因為相同批次依賴受限的用於 RF-PMIC-M1 金屬層的 193 nm 浸潤式光阻。

**Recommended Actions**
**建議行動**
- Ask Formosa Electronic Materials for partial release, cold-chain evidence, and a firm dock appointment.
- 要求 Formosa Electronic Materials 提供部分放行、冷鏈證據與確定的到廠預約。
- Check approved alternate Shin-Etsu Taiwan for emergency qualification coverage.
- 確認核准替代供應商 Shin-Etsu Taiwan 是否可提供緊急資格覆蓋。
- Avoid starting additional RF-PMIC-M1 lots until quality containment and material coverage are confirmed.
- 在品質圍堵與物料覆蓋確認前，避免啟動額外 RF-PMIC-M1 批次。

**Approval Gates**
**核准關卡**
- Buyer approval required before supplier expedite commitment.
- 承諾供應商急件前需要採購人員核准。
- Supply chain manager approval required before alternate-source pull-in.
- 拉入替代來源前需要供應鏈經理核准。

## Diagnostics Reporting
## 診斷報告

**Summary:** DIA-9001 flags ETCH-07B RF match network as critical; rf_reflected_power_w is 1380 versus limit 900.
**摘要：** DIA-9001 將 ETCH-07B 的「RF 匹配網路」標示為嚴重；rf_reflected_power_w 為 1380，限制值為 900。

**Facts**
**事實**
- Impacted wafer lot: WAFERLOT-7782.
- 受影響晶圓批次：WAFERLOT-7782。
- Baseline for rf_reflected_power_w is 420; observed value is 1380.
- rf_reflected_power_w 的基準值為 420；觀測值為 1380。
- Evidence: RF reflected power is 3.3x baseline. Endpoint time increased by 7.5%. Particle adders increased to 28 per wafer.
- 證據：RF 反射功率為基準值的 3.3 倍。Endpoint 時間增加 7.5%。每片晶圓新增粒子數增加到 28。

**Inference**
**推論**
- Likely causes are RF match drift, polymer buildup on chamber kit, ESC helium leak.
- 可能原因為 RF 匹配漂移、腔體套件聚合物堆積、ESC 氦氣洩漏。

**Recommended Actions**
**建議行動**
- Publish a shift diagnostics report owned by equipment engineering.
- 發布由設備工程負責的班別診斷報告。
- Attach FDC traces, SPC trend charts, wafer lot genealogy, and recent chamber PM history.
- 附上 FDC trace、SPC 趨勢圖、晶圓批次履歷與近期腔體 PM 歷史。
- Tag the report as yield-impacting until CD-SEM disposition and chamber checks are complete.
- 在 CD-SEM 處置與腔體檢查完成前，將報告標示為可能影響良率。

**Approval Gates**
**核准關卡**
- Equipment engineering approval required before chamber intervention.
- 腔體介入前需要設備工程核准。
- Process engineering approval required before recipe or route qualification changes.
- 變更 recipe 或路線資格前需要製程工程核准。

## Automated Triage And Resolution
## 自動化分級與解決建議

**Summary:** TRIAGE-5107 recommends governed automated triage for ETCH-07B and WAFERLOT-7782, while keeping resolution actions behind approval gates.
**摘要：** TRIAGE-5107 建議對 ETCH-07B 與 WAFERLOT-7782 進行受治理的自動化分級，同時將解決行動保留在核准關卡後。

**Facts**
**事實**
- Source: FDC and SPC correlation.
- 來源：FDC 與 SPC 關聯分析。
- Containment: Hold WAFERLOT-7782 for CD-SEM review and block release to implant until disposition.
- 圍堵：暫停 WAFERLOT-7782 以進行 CD-SEM 審查，並在處置前禁止放行到離子植入站點。
- Blocked automation: Do not change recipe parameters automatically. Do not release wafer lots from quality hold automatically. Do not put ETCH-07B into maintenance downtime without human approval.
- 被禁止的自動化行動：不得自動變更 recipe 參數。 不得自動將晶圓批次從品質暫停中放行。 不得在沒有人工作業核准的情況下將 ETCH-07B 轉入維護停機。

**Inference**
**推論**
- Suspected root cause: RF match drift with chamber polymer buildup and possible ESC helium leak.
- 疑似根因：RF 匹配漂移伴隨腔體聚合物堆積，且可能存在 ESC 氦氣洩漏。

**Recommended Actions**
**建議行動**
- Create a draft equipment diagnostic report for ETCH-07B.
- 建立 ETCH-07B 的設備診斷報告草稿。
- Open a draft eDHR annotation linking WAFERLOT-7782, SPC drift, and FDC trace IDs.
- 建立 eDHR 註記草稿，連結 WAFERLOT-7782、SPC 漂移與 FDC trace ID。
- Notify shift lead, equipment engineering, process engineering, and production control.
- 通知班別主管、設備工程、製程工程與生產管制。
- Run monitor wafer after chamber clean and RF match verification.
- 在腔體清潔與 RF match 驗證後執行 monitor wafer。
- Qualify ETCH-09B with golden recipe before rerouting expedite lots.
- 在轉派急件批次前，以 golden recipe 驗證 ETCH-09B。
- Escalate to hold-disposition meeting if CD-SEM confirms out-of-control drift.
- 若 CD-SEM 確認失控漂移，升級到 hold-disposition 會議。

**Approval Gates**
**核准關卡**
- Equipment engineer approval required before chamber intervention.
- 腔體介入前需要設備工程師核准。
- Process engineer approval required before recipe or route changes.
- 變更 recipe 或路線前需要製程工程師核准。
- Quality owner approval required before lot release.
- 晶圓批次放行前需要品質負責人核准。
