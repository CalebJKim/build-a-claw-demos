#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const dataDir = path.join(root, "data");
const outputDir = path.join(root, "output");
const runDate = new Date("2026-05-11T12:00:00-05:00");

const validModes = new Set(["all", "maintenance", "quality", "schedule", "supplier", "diagnostics", "triage"]);
const languageAliases = new Map([
  ["bilingual", "bilingual"],
  ["both", "bilingual"],
  ["en", "en"],
  ["english", "en"],
  ["zh", "zh-TW"],
  ["zh-tw", "zh-TW"],
  ["zh_tw", "zh-TW"],
  ["zh-hant", "zh-TW"],
  ["traditional", "zh-TW"],
  ["traditional-mandarin", "zh-TW"],
  ["traditional-chinese", "zh-TW"]
]);

function parseArgs(argv) {
  let requested = "all";
  let lang = "bilingual";
  let writeReport = true;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--no-write") {
      writeReport = false;
      continue;
    }
    if (arg === "--lang" || arg === "-l") {
      i += 1;
      lang = argv[i] || lang;
      continue;
    }
    if (arg.startsWith("--lang=")) {
      lang = arg.slice("--lang=".length);
      continue;
    }
    if (arg === "--zh-tw" || arg === "--zh") {
      lang = "zh-TW";
      continue;
    }
    if (arg === "--en") {
      lang = "en";
      continue;
    }
    requested = arg.toLowerCase();
  }

  const normalizedLang = languageAliases.get(String(lang).toLowerCase());
  if (!normalizedLang) {
    console.error(`Unknown language: ${lang}`);
    console.error("Use one of: bilingual, en, zh-TW");
    process.exit(1);
  }

  if (!validModes.has(requested)) {
    console.error(`Unknown mode: ${requested}`);
    console.error("Use one of: all, maintenance, quality, schedule, supplier, diagnostics, triage");
    process.exit(1);
  }

  return { requested, lang: normalizedLang, writeReport };
}

const { requested, lang, writeReport } = parseArgs(process.argv.slice(2));

const readJson = (name) => JSON.parse(fs.readFileSync(path.join(dataDir, name), "utf8"));

const machines = readJson("machines.json");
const qualitySamples = readJson("quality_samples.json");
const workOrders = readJson("work_orders.json");
const inventory = readJson("inventory.json");
const shipments = readJson("supplier_shipments.json");
const diagnosticsEvents = readJson("diagnostics_events.json");
const triageCases = readJson("triage_cases.json");

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const round = (value, digits = 1) => Number(value.toFixed(digits));
const daysBetween = (a, b) => Math.ceil((new Date(a).getTime() - new Date(b).getTime()) / 86400000);
const plural = (count, singular, pluralValue = `${singular}s`) => `${count} ${count === 1 ? singular : pluralValue}`;
const listOrNone = (items, language) => items.length ? items.join(", ") : language === "zh-TW" ? "無" : "none";

function localText(value, language = lang) {
  if (typeof value === "string") return value;
  return value[language] || value.en;
}

function riskBand(score) {
  if (score >= 80) return "critical";
  if (score >= 60) return "high";
  if (score >= 35) return "watch";
  return "normal";
}

function riskLabel(band, language = lang) {
  const labels = {
    critical: { en: "critical", "zh-TW": "嚴重" },
    high: { en: "high", "zh-TW": "高" },
    watch: { en: "watch", "zh-TW": "觀察" },
    normal: { en: "normal", "zh-TW": "正常" }
  };
  return labels[band]?.[language] || band;
}

function priorityLabel(priority, language = lang) {
  const labels = {
    expedite: { en: "expedite", "zh-TW": "急件" },
    standard: { en: "standard", "zh-TW": "標準" }
  };
  return labels[priority]?.[language] || priority;
}

function severityLabel(severity, language = lang) {
  const labels = {
    critical: { en: "critical", "zh-TW": "嚴重" },
    high: { en: "high", "zh-TW": "高" },
    watch: { en: "watch", "zh-TW": "觀察" },
    normal: { en: "normal", "zh-TW": "正常" }
  };
  return labels[severity]?.[language] || severity;
}

function riskReason(reason, language = lang) {
  const labels = {
    "carrier delay at cross-dock": {
      en: "carrier delay at cross-dock",
      "zh-TW": "轉運站承運商延誤"
    },
    "cold-chain hold at Taoyuan customs": {
      en: "cold-chain hold at Taoyuan customs",
      "zh-TW": "桃園海關冷鏈查驗暫停"
    },
    "none reported": {
      en: "none reported",
      "zh-TW": "未回報"
    },
    unknown: {
      en: "unknown",
      "zh-TW": "未知"
    }
  };
  return labels[reason]?.[language] || reason;
}

function maintenanceAnalysis() {
  const ranked = machines
    .map((machine) => {
      const wafersSincePm = machine.wafers_since_pm || 0;
      const pmInterval = machine.pm_interval_wafers || 1;
      const tempScore = clamp(((machine.chuck_temp_c || 0) - 65) / 20, 0, 1);
      const rfScore = clamp(((machine.rf_reflected_power_w || 0) - 500) / 900, 0, 1);
      const heliumScore = clamp(((machine.helium_leak_sccm || 0) - 2) / 4, 0, 1);
      const particleScore = clamp(((machine.particle_adders || 0) - 8) / 25, 0, 1);
      const pmScore = clamp((wafersSincePm - (pmInterval * 0.65)) / (pmInterval * 0.35), 0, 1);
      const availabilityScore = clamp((0.9 - machine.availability) / 0.25, 0, 1);
      const faultScore = clamp(machine.faults.length * 0.18, 0, 0.36);
      const score = round(100 * clamp((0.18 * tempScore) + (0.22 * rfScore) + (0.18 * heliumScore) + (0.16 * particleScore) + (0.14 * pmScore) + (0.08 * availabilityScore) + faultScore, 0, 1), 0);

      return {
        ...machine,
        wafersSincePm,
        risk_score: score,
        risk_band: riskBand(score)
      };
    })
    .sort((a, b) => b.risk_score - a.risk_score);

  const top = ranked[0];
  const impacted = workOrders.filter((order) => order.route.includes(top.id));

  return {
    title: {
      en: "Fab Tool Health Triage",
      "zh-TW": "晶圓廠設備健康分級"
    },
    summary: {
      en: `${top.id} is the highest fab tool risk at ${top.risk_score}/100 (${riskLabel(top.risk_band, "en")}) for ${top.product} ${top.process_family}.`,
      "zh-TW": `${top.id} 是 ${top.product} ${top.process_family} 的最高晶圓廠設備風險，分數為 ${top.risk_score}/100（${riskLabel(top.risk_band, "zh-TW")}）。`
    },
    facts: {
      en: [
        `${top.id} RF reflected power is ${top.rf_reflected_power_w} W and ESC helium leak is ${top.helium_leak_sccm} sccm.`,
        `${top.id} has ${top.particle_adders} particle adders per wafer and ${top.wafers_since_pm}/${top.pm_interval_wafers} wafers since PM.`,
        `Faults: ${listOrNone(top.faults, "en")}.`,
        `Active wafer lots routed through ${top.id}: ${listOrNone(impacted.map((order) => order.id), "en")}.`
      ],
      "zh-TW": [
        `${top.id} 的 RF 反射功率為 ${top.rf_reflected_power_w} W，ESC 氦氣洩漏為 ${top.helium_leak_sccm} sccm。`,
        `${top.id} 每片晶圓新增粒子數為 ${top.particle_adders}，且 PM 後已處理 ${top.wafers_since_pm}/${top.pm_interval_wafers} 片晶圓。`,
        `故障碼：${listOrNone(top.faults, "zh-TW")}。`,
        `經過 ${top.id} 的進行中晶圓批次：${listOrNone(impacted.map((order) => order.id), "zh-TW")}。`
      ]
    },
    inference: {
      en: [
        top.id === "ETCH-07B"
          ? "Pattern is consistent with RF match drift, chamber polymer buildup, or an ESC helium leak."
          : "Pattern warrants equipment engineering review before risk becomes yield-impacting."
      ],
      "zh-TW": [
        top.id === "ETCH-07B"
          ? "此模式與 RF 匹配漂移、腔體聚合物堆積或 ESC 氦氣洩漏相符。"
          : "此模式需要在風險影響良率前由設備工程進行審查。"
      ]
    },
    recommendations: {
      en: [
        `Create an equipment diagnostic report draft for ${top.id} before ${top.next_planned_downtime}.`,
        "Ask equipment engineering to inspect RF match tuning, chamber kit condition, ESC helium seal, and endpoint trace drift.",
        "Run monitor wafer and increase CD-SEM sampling until equipment engineering clears the chamber."
      ],
      "zh-TW": [
        `在 ${top.next_planned_downtime} 前，為 ${top.id} 建立設備診斷報告草稿。`,
        "請設備工程檢查 RF 匹配調校、腔體套件狀況、ESC 氦氣密封與 endpoint trace 漂移。",
        "在設備工程確認腔體狀態前，執行 monitor wafer 並提高 CD-SEM 抽測頻率。"
      ]
    },
    approvals: {
      en: [
        "Equipment engineer approval required before taking the chamber down.",
        "Manufacturing supervisor approval required before rerouting active wafer lots."
      ],
      "zh-TW": [
        "腔體停機前需要設備工程師核准。",
        "變更進行中晶圓批次路線前需要製造主管核准。"
      ]
    },
    data: ranked
  };
}

function qualityAnalysis() {
  const byMachineFeature = new Map();
  for (const sample of qualitySamples) {
    const key = `${sample.machine_id}:${sample.feature}`;
    if (!byMachineFeature.has(key)) byMachineFeature.set(key, []);
    byMachineFeature.get(key).push(sample);
  }

  const findings = [];
  for (const [key, samples] of byMachineFeature) {
    samples.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
    const first = samples[0];
    const last = samples[samples.length - 1];
    const trend = last.actual - first.actual;
    const unit = first.unit || "";
    const toleranceWidth = Math.abs(first.usl - first.lsl);
    const nearLimitBand = toleranceWidth * 0.1;
    const trendThreshold = Math.max(toleranceWidth * 0.2, 0.001);
    const outOfSpec = samples.filter((sample) => sample.actual < sample.lsl || sample.actual > sample.usl);
    const nearLimit = samples.filter((sample) => sample.actual > sample.usl - nearLimitBand || sample.actual < sample.lsl + nearLimitBand);
    const suspectLots = [...new Set([...outOfSpec, ...nearLimit].map((sample) => sample.lot))];

    if (Math.abs(trend) >= trendThreshold || outOfSpec.length || nearLimit.length) {
      findings.push({
        key,
        machine_id: first.machine_id,
        feature: first.feature,
        unit,
        first_actual: first.actual,
        last_actual: last.actual,
        trend: round(trend, 4),
        out_of_spec_count: outOfSpec.length,
        near_limit_count: nearLimit.length,
        suspect_lots: suspectLots,
        work_orders: [...new Set(samples.filter((sample) => suspectLots.includes(sample.lot)).map((sample) => sample.work_order))]
      });
    }
  }

  const primary = findings[0];
  return {
    title: {
      en: "Wafer Quality Excursion Containment",
      "zh-TW": "晶圓品質異常圍堵"
    },
    summary: {
      en: primary
        ? `${primary.machine_id} shows ${primary.feature} drift of ${primary.trend} ${primary.unit} with suspect wafer lots ${primary.suspect_lots.join(", ")}.`
        : "No wafer quality excursion found in the sample set.",
      "zh-TW": primary
        ? `${primary.machine_id} 的 ${primary.feature} 出現 ${primary.trend} ${primary.unit} 漂移，疑似晶圓批號為 ${primary.suspect_lots.join(", ")}。`
        : "樣本集中未發現晶圓品質異常。"
    },
    facts: {
      en: primary
        ? [
            `${primary.feature} moved from ${primary.first_actual} ${primary.unit} to ${primary.last_actual} ${primary.unit}.`,
            `${plural(primary.out_of_spec_count, "sample")} ${primary.out_of_spec_count === 1 ? "is" : "are"} out of specification and ${primary.near_limit_count} ${primary.near_limit_count === 1 ? "is" : "are"} near limit.`,
            `Impacted wafer lot run(s): ${primary.work_orders.join(", ")}.`
          ]
        : ["All wafer metrology samples are within the defined limits."],
      "zh-TW": primary
        ? [
            `${primary.feature} 從 ${primary.first_actual} ${primary.unit} 移動到 ${primary.last_actual} ${primary.unit}。`,
            `${primary.out_of_spec_count} 筆樣本超出規格，${primary.near_limit_count} 筆接近規格界限。`,
            `受影響晶圓批次執行單：${primary.work_orders.join(", ")}。`
          ]
        : ["所有晶圓量測樣本皆在定義的規格界限內。"]
    },
    inference: {
      en: primary
        ? ["CD drift aligns with the same etch chamber highlighted by tool health risk, so a chamber-condition root cause is plausible."]
        : ["No containment action is indicated by the synthetic wafer metrology data."],
      "zh-TW": primary
        ? ["CD 漂移與設備健康風險所指向的同一蝕刻腔體一致，因此腔體狀態根因是合理假設。"]
        : ["合成晶圓量測資料未顯示需要圍堵行動。"]
    },
    recommendations: {
      en: primary
        ? [
            `Place a quality review hold on wafer lots ${primary.suspect_lots.join(", ")} pending disposition.`,
            "Increase CD-SEM sampling for the next two wafer lots from the same chamber.",
            "Compare recipe, endpoint, RF, and chamber-clean history against the last known-good lot."
          ]
        : ["Continue normal control-plan metrology sampling."],
      "zh-TW": primary
        ? [
            `對晶圓批號 ${primary.suspect_lots.join(", ")} 建議品質審查暫停，等待處置決策。`,
            "針對同一腔體接下來兩個晶圓批次提高 CD-SEM 抽樣頻率。",
            "將 recipe、endpoint、RF 與腔體清潔歷史與上一個已知良好批次進行比對。"
          ]
        : ["維持正常控制計畫量測抽樣。"]
    },
    approvals: {
      en: primary
        ? [
            "Quality owner approval required for wafer lot hold or release.",
            "Process engineer approval required before changing recipe parameters or route qualification."
          ]
        : [],
      "zh-TW": primary
        ? [
            "晶圓批次暫停或放行需要品質負責人核准。",
            "變更 recipe 參數或路線資格前需要製程工程師核准。"
          ]
        : []
    },
    data: findings
  };
}

function scheduleAnalysis(maintenance) {
  const riskyAsset = maintenance.data[0];
  const threatened = workOrders
    .filter((order) => order.route.includes(riskyAsset.id) && order.completed < order.quantity)
    .map((order) => ({
      ...order,
      remaining: order.quantity - order.completed,
      days_until_due: daysBetween(order.due, runDate)
    }));

  const alternate = machines.find((machine) => machine.id !== riskyAsset.id && machine.process_family === riskyAsset.process_family && machine.status === "available");

  return {
    title: {
      en: "Fab WIP Dispatch Recovery",
      "zh-TW": "晶圓廠 WIP 派工復原"
    },
    summary: {
      en: `${threatened.length} active wafer lot run(s) are exposed to ${riskyAsset.id}; ${alternate ? alternate.id : "no alternate"} is the best alternate chamber option.`,
      "zh-TW": `${threatened.length} 張進行中晶圓批次執行單暴露於 ${riskyAsset.id} 風險；${alternate ? alternate.id : "無替代腔體"} 是最佳替代腔體選項。`
    },
    facts: {
      en: threatened.map((order) => `${order.id}: ${plural(order.remaining, "wafer")} remaining, due in ${plural(order.days_until_due, "day")}, priority ${priorityLabel(order.priority, "en")}.`),
      "zh-TW": threatened.map((order) => `${order.id}：剩餘 ${order.remaining} 片晶圓，${order.days_until_due} 天後到期，優先級為${priorityLabel(order.priority, "zh-TW")}。`)
    },
    inference: {
      en: [
        alternate
          ? `${alternate.id} can absorb ${riskyAsset.product} ${riskyAsset.process_family} lots after chamber matching and golden-recipe validation.`
          : "No qualified alternate chamber is available in the sample data."
      ],
      "zh-TW": [
        alternate
          ? `${alternate.id} 可在完成腔體匹配與 golden recipe 驗證後承接 ${riskyAsset.product} ${riskyAsset.process_family} 批次。`
          : "樣本資料中沒有合格的替代腔體。"
      ]
    },
    recommendations: {
      en: [
        alternate
          ? `Move the next standard ${riskyAsset.product} lot to ${alternate.id} and reserve ${riskyAsset.id} for expedite exposure only until diagnostics are complete.`
          : "Prepare WIP hold and customer-date recovery options.",
        "Protect METRO-01 CD-SEM capacity for containment inspection before releasing suspect wafer lots.",
        "Recalculate WIP dispatch after equipment diagnostics and CD-SEM disposition are known."
      ],
      "zh-TW": [
        alternate
          ? `將下一個標準 ${riskyAsset.product} 批次移至 ${alternate.id}，在診斷完成前僅保留 ${riskyAsset.id} 處理急件暴露量。`
          : "準備 WIP 暫停與客戶交期復原方案。",
        "在疑似晶圓批次放行前，保留 METRO-01 CD-SEM 產能用於圍堵檢查。",
        "設備診斷與 CD-SEM 處置確認後重新計算 WIP 派工。"
      ]
    },
    approvals: {
      en: [
        "Production control approval required for WIP dispatch changes.",
        "Quality approval required before moving any wafer lot under containment review."
      ],
      "zh-TW": [
        "WIP 派工變更需要生產管制核准。",
        "任何處於圍堵審查中的晶圓批次移轉前需要品質核准。"
      ]
    },
    data: threatened
  };
}

function supplierAnalysis() {
  const findings = inventory.map((item) => {
    const shipment = shipments.find((entry) => entry.sku === item.sku);
    const netAvailable = item.on_hand - item.allocated;
    const daysOfCover = round(netAvailable / item.daily_usage, 2);
    const etaSlipDays = shipment ? daysBetween(shipment.latest_eta, shipment.original_eta) : 0;
    const impactedOrders = workOrders.filter((order) => order.required_material === item.sku).map((order) => order.id);
    const impactedProducts = [...new Set(workOrders.filter((order) => order.required_material === item.sku).map((order) => order.part))];
    const riskScore = clamp((daysOfCover < 1 ? 50 : 15) + (etaSlipDays * 15) + (shipment && shipment.otif_30d < 0.9 ? 20 : 0), 0, 100);

    return {
      sku: item.sku,
      description: item.description,
      description_zh: item.description_zh || item.description,
      supplier: item.primary_supplier,
      uom: item.uom || "units",
      uom_zh: item.uom_zh || item.uom || "件",
      net_available: netAvailable,
      days_of_cover: daysOfCover,
      latest_eta: shipment?.latest_eta || "unknown",
      eta_slip_days: etaSlipDays,
      risk: shipment?.risk || "unknown",
      otif_30d: shipment?.otif_30d || null,
      impacted_orders: impactedOrders,
      impacted_products: impactedProducts,
      approved_alternates: item.approved_alternates,
      risk_score: riskScore,
      risk_band: riskBand(riskScore)
    };
  }).sort((a, b) => b.risk_score - a.risk_score);

  const top = findings[0];

  return {
    title: {
      en: "Critical Materials Disruption Response",
      "zh-TW": "關鍵物料中斷應變"
    },
    summary: {
      en: `${top.sku} is the highest semiconductor material risk with ${top.days_of_cover} days of unallocated cover and ETA ${top.latest_eta}.`,
      "zh-TW": `${top.sku} 是最高半導體物料風險，未分配庫存覆蓋天數為 ${top.days_of_cover} 天，最新 ETA 為 ${top.latest_eta}。`
    },
    facts: {
      en: [
        `${top.supplier} shipment is delayed by ${plural(top.eta_slip_days, "day")}; reason: ${riskReason(top.risk, "en")}.`,
        `Net available after allocation: ${top.net_available} ${top.uom}.`,
        `Impacted wafer lot run(s): ${top.impacted_orders.join(", ")}.`
      ],
      "zh-TW": [
        `${top.supplier} 出貨延遲 ${top.eta_slip_days} 天；原因：${riskReason(top.risk, "zh-TW")}。`,
        `分配後淨可用量：${top.net_available} ${top.uom_zh}。`,
        `受影響晶圓批次執行單：${top.impacted_orders.join(", ")}。`
      ]
    },
    inference: {
      en: [
        `Material risk compounds the ${top.impacted_products.join(", ")} WIP risk because the same lots depend on the constrained ${top.description}.`
      ],
      "zh-TW": [
        `物料風險會放大 ${top.impacted_products.join(", ")} WIP 風險，因為相同批次依賴受限的${top.description_zh}。`
      ]
    },
    recommendations: {
      en: [
        `Ask ${top.supplier} for partial release, cold-chain evidence, and a firm dock appointment.`,
        `Check approved alternate ${top.approved_alternates[0]} for emergency qualification coverage.`,
        `Avoid starting additional ${top.impacted_products.join(", ")} lots until quality containment and material coverage are confirmed.`
      ],
      "zh-TW": [
        `要求 ${top.supplier} 提供部分放行、冷鏈證據與確定的到廠預約。`,
        `確認核准替代供應商 ${top.approved_alternates[0]} 是否可提供緊急資格覆蓋。`,
        `在品質圍堵與物料覆蓋確認前，避免啟動額外 ${top.impacted_products.join(", ")} 批次。`
      ]
    },
    approvals: {
      en: [
        "Buyer approval required before supplier expedite commitment.",
        "Supply chain manager approval required before alternate-source pull-in."
      ],
      "zh-TW": [
        "承諾供應商急件前需要採購人員核准。",
        "拉入替代來源前需要供應鏈經理核准。"
      ]
    },
    data: findings
  };
}

function diagnosticsAnalysis() {
  const severityRank = { critical: 3, high: 2, watch: 1, normal: 0 };
  const ranked = [...diagnosticsEvents].sort((a, b) => (severityRank[b.severity] || 0) - (severityRank[a.severity] || 0));
  const top = ranked[0];
  const evidence = top.evidence || [];
  const evidenceZh = top.evidence_zh || evidence;
  const causes = top.likely_causes || [];
  const causesZh = top.likely_causes_zh || causes;

  return {
    title: {
      en: "Diagnostics Reporting",
      "zh-TW": "診斷報告"
    },
    summary: {
      en: `${top.id} flags ${top.tool_id} ${top.subsystem} as ${top.severity}; ${top.metric} is ${top.observed} versus limit ${top.limit}.`,
      "zh-TW": `${top.id} 將 ${top.tool_id} 的「${top.subsystem_zh || top.subsystem}」標示為${severityLabel(top.severity, "zh-TW")}；${top.metric} 為 ${top.observed}，限制值為 ${top.limit}。`
    },
    facts: {
      en: [
        `Impacted wafer lot: ${top.lot}.`,
        `Baseline for ${top.metric} is ${top.baseline}; observed value is ${top.observed}.`,
        `Evidence: ${evidence.join(" ")}`
      ],
      "zh-TW": [
        `受影響晶圓批次：${top.lot}。`,
        `${top.metric} 的基準值為 ${top.baseline}；觀測值為 ${top.observed}。`,
        `證據：${evidenceZh.join("")}`
      ]
    },
    inference: {
      en: [
        `Likely causes are ${causes.join(", ")}.`
      ],
      "zh-TW": [
        `可能原因為 ${causesZh.join("、")}。`
      ]
    },
    recommendations: {
      en: [
        `Publish a shift diagnostics report owned by ${top.report_owner}.`,
        "Attach FDC traces, SPC trend charts, wafer lot genealogy, and recent chamber PM history.",
        "Tag the report as yield-impacting until CD-SEM disposition and chamber checks are complete."
      ],
      "zh-TW": [
        `發布由${top.report_owner_zh || top.report_owner}負責的班別診斷報告。`,
        "附上 FDC trace、SPC 趨勢圖、晶圓批次履歷與近期腔體 PM 歷史。",
        "在 CD-SEM 處置與腔體檢查完成前，將報告標示為可能影響良率。"
      ]
    },
    approvals: {
      en: [
        "Equipment engineering approval required before chamber intervention.",
        "Process engineering approval required before recipe or route qualification changes."
      ],
      "zh-TW": [
        "腔體介入前需要設備工程核准。",
        "變更 recipe 或路線資格前需要製程工程核准。"
      ]
    },
    data: ranked
  };
}

function triageResolutionAnalysis() {
  const severityRank = { critical: 3, high: 2, watch: 1, normal: 0 };
  const ranked = [...triageCases].sort((a, b) => (severityRank[b.severity] || 0) - (severityRank[a.severity] || 0));
  const top = ranked[0];

  return {
    title: {
      en: "Automated Triage And Resolution",
      "zh-TW": "自動化分級與解決建議"
    },
    summary: {
      en: `${top.case_id} recommends governed automated triage for ${top.tool_id} and ${top.lot}, while keeping resolution actions behind approval gates.`,
      "zh-TW": `${top.case_id} 建議對 ${top.tool_id} 與 ${top.lot} 進行受治理的自動化分級，同時將解決行動保留在核准關卡後。`
    },
    facts: {
      en: [
        `Source: ${top.source}.`,
        `Containment: ${top.containment}`,
        `Blocked automation: ${top.blocked_actions.join(" ")}`
      ],
      "zh-TW": [
        `來源：${top.source_zh || top.source}。`,
        `圍堵：${top.containment_zh || top.containment}`,
        `被禁止的自動化行動：${(top.blocked_actions_zh || top.blocked_actions).join(" ")}`
      ]
    },
    inference: {
      en: [
        `Suspected root cause: ${top.suspected_root_cause}.`
      ],
      "zh-TW": [
        `疑似根因：${top.suspected_root_cause_zh || top.suspected_root_cause}。`
      ]
    },
    recommendations: {
      en: [
        ...top.automated_actions,
        ...top.resolution_candidates
      ],
      "zh-TW": [
        ...(top.automated_actions_zh || top.automated_actions),
        ...(top.resolution_candidates_zh || top.resolution_candidates)
      ]
    },
    approvals: {
      en: top.approval_required,
      "zh-TW": top.approval_required_zh || top.approval_required
    },
    data: ranked
  };
}

function localizedList(items, language) {
  return items.map((item) => localText(item, language));
}

function sectionMarkdownBilingual(section) {
  const lines = [];
  lines.push(`## ${section.title.en}`);
  lines.push(`## ${section.title["zh-TW"]}`);
  lines.push("");
  lines.push(`**Summary:** ${section.summary.en}`);
  lines.push(`**摘要：** ${section.summary["zh-TW"]}`);
  lines.push("");
  lines.push("**Facts**");
  lines.push("**事實**");
  for (let i = 0; i < section.facts.en.length; i += 1) {
    lines.push(`- ${section.facts.en[i]}`);
    lines.push(`- ${section.facts["zh-TW"][i] || section.facts.en[i]}`);
  }
  lines.push("");
  lines.push("**Inference**");
  lines.push("**推論**");
  for (let i = 0; i < section.inference.en.length; i += 1) {
    lines.push(`- ${section.inference.en[i]}`);
    lines.push(`- ${section.inference["zh-TW"][i] || section.inference.en[i]}`);
  }
  lines.push("");
  lines.push("**Recommended Actions**");
  lines.push("**建議行動**");
  for (let i = 0; i < section.recommendations.en.length; i += 1) {
    lines.push(`- ${section.recommendations.en[i]}`);
    lines.push(`- ${section.recommendations["zh-TW"][i] || section.recommendations.en[i]}`);
  }
  if (section.approvals.en.length) {
    lines.push("");
    lines.push("**Approval Gates**");
    lines.push("**核准關卡**");
    for (let i = 0; i < section.approvals.en.length; i += 1) {
      lines.push(`- ${section.approvals.en[i]}`);
      lines.push(`- ${section.approvals["zh-TW"][i] || section.approvals.en[i]}`);
    }
  }
  lines.push("");
  return lines.join("\n");
}

function sectionMarkdown(section, language = lang) {
  const labels = {
    summary: { en: "Summary", "zh-TW": "摘要" },
    facts: { en: "Facts", "zh-TW": "事實" },
    inference: { en: "Inference", "zh-TW": "推論" },
    recommendations: { en: "Recommended Actions", "zh-TW": "建議行動" },
    approvals: { en: "Approval Gates", "zh-TW": "核准關卡" }
  };

  const lines = [];
  lines.push(`## ${localText(section.title, language)}`);
  lines.push("");
  lines.push(`**${labels.summary[language]}:** ${localText(section.summary, language)}`);
  lines.push("");
  lines.push(`**${labels.facts[language]}**`);
  for (const fact of localizedList(section.facts[language] || section.facts.en, language)) lines.push(`- ${fact}`);
  lines.push("");
  lines.push(`**${labels.inference[language]}**`);
  for (const item of localizedList(section.inference[language] || section.inference.en, language)) lines.push(`- ${item}`);
  lines.push("");
  lines.push(`**${labels.recommendations[language]}**`);
  for (const item of localizedList(section.recommendations[language] || section.recommendations.en, language)) lines.push(`- ${item}`);
  const approvals = localizedList(section.approvals[language] || section.approvals.en, language);
  if (approvals.length) {
    lines.push("");
    lines.push(`**${labels.approvals[language]}**`);
    for (const item of approvals) lines.push(`- ${item}`);
  }
  lines.push("");
  return lines.join("\n");
}

function buildReport(sections, language = lang) {
  if (language === "bilingual") {
    const lines = [
      "# Semiconductor Manufacturing Ops Agent Report",
      "# 半導體製造營運代理報告",
      "",
      `Generated: ${runDate.toISOString()}`,
      `產生時間：${runDate.toISOString()}`,
      "",
      "This report uses synthetic fab data for a NemoClaw/OpenShell semiconductor manufacturing agent demo.",
      "本報告使用合成晶圓廠資料，用於 NemoClaw/OpenShell 半導體製造代理示範。",
      "",
      "The agent recommends actions but does not execute production, quality, safety, recipe, equipment-control, purchasing, or WIP dispatch changes.",
      "代理會提出建議行動，但不會執行任何生產、品質、安全、recipe、設備控制、採購或 WIP 派工變更。",
      ""
    ];
    for (const section of sections) lines.push(sectionMarkdownBilingual(section));
    return lines.join("\n");
  }

  const header = {
    en: [
      "# Semiconductor Manufacturing Ops Agent Report",
      "",
      `Generated: ${runDate.toISOString()}`,
      "",
      "This report uses synthetic fab data for a NemoClaw/OpenShell semiconductor manufacturing agent demo.",
      "",
      "The agent recommends actions but does not execute production, quality, safety, recipe, equipment-control, purchasing, or WIP dispatch changes.",
      ""
    ],
    "zh-TW": [
      "# 半導體製造營運代理報告",
      "",
      `產生時間：${runDate.toISOString()}`,
      "",
      "本報告使用合成晶圓廠資料，用於 NemoClaw/OpenShell 半導體製造代理示範。",
      "",
      "代理會提出建議行動，但不會執行任何生產、品質、安全、recipe、設備控制、採購或 WIP 派工變更。",
      ""
    ]
  };

  const lines = [...header[language]];
  for (const section of sections) lines.push(sectionMarkdown(section, language));
  return lines.join("\n");
}

const maintenance = maintenanceAnalysis();
const analyses = {
  maintenance,
  quality: qualityAnalysis(),
  schedule: scheduleAnalysis(maintenance),
  supplier: supplierAnalysis(),
  diagnostics: diagnosticsAnalysis(),
  triage: triageResolutionAnalysis()
};

const selected = requested === "all"
  ? [analyses.maintenance, analyses.quality, analyses.schedule, analyses.supplier, analyses.diagnostics, analyses.triage]
  : [analyses[requested]];

fs.mkdirSync(outputDir, { recursive: true });
const report = buildReport(selected, lang);
const reportFile = lang === "bilingual"
  ? "manufacturing-agent-report.md"
  : `manufacturing-agent-report.${lang}.md`;
const reportPath = path.join(outputDir, reportFile);
if (writeReport) fs.writeFileSync(reportPath, report);

console.log(report);
if (writeReport) {
  console.log(lang === "zh-TW"
    ? `報告已寫入 ${path.relative(root, reportPath)}`
    : `Report written to ${path.relative(root, reportPath)}`);
}
