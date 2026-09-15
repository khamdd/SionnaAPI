const METRIC_LABELS = {
  covered_area_percent: "Covered area",
  uncovered_area_percent: "Uncovered area",
  overlap_area_percent: "Overlap area",
  average_overlap_count: "Average overlap",
  rsrp_dbm_p10: "P10 RSRP",
  sinr_db_p10: "P10 SINR",
  throughput_mbps_p10: "P10 throughput",
};

export function buildOptimizationReport({ result, scene, generatedAt = new Date() }) {
  const optimization = result?.optimization || {};
  const baseline = optimization.baseline || {};
  const recommended = optimization.recommended_candidate || optimization.best || {};
  const objectives = optimization.objectives || [];
  const baselineGrid = optimization.comparison?.baseline_grid;
  const recommendedGrid = result?.grid;
  const targetRows = objectives.map((objective, index) => {
    const before = baseline.evaluation?.evaluations?.[index];
    const after = recommended.evaluation?.evaluations?.[index];
    return `<tr><td>${escapeHtml(objectiveName(objective))}</td><td>${display(before?.actual)}</td><td>${display(after?.actual)}</td><td>${escapeHtml(objectiveTarget(objective))}</td><td class="${after?.passed ? "pass" : "fail"}">${after?.passed ? "Pass" : "Miss"}</td></tr>`;
  }).join("");
  const changeRows = (recommended.changes || []).map((change) =>
    `<tr><td>${escapeHtml(change.antenna_id)}</td><td>${escapeHtml(fieldName(change.field))}</td><td>${display(change.from)}</td><td>${display(change.to)}</td><td>${signed(change.delta)}</td></tr>`
  ).join("") || `<tr><td colspan="5">The starting antenna settings remain recommended.</td></tr>`;
  const settingIds = [...new Set([
    ...Object.keys(baseline.settings || {}),
    ...Object.keys(recommended.settings || {}),
  ])].sort();
  const settingRows = settingIds.map((antennaId) =>
    `<tr><td>${escapeHtml(antennaId)}</td><td>${escapeHtml(settingsText(baseline.settings?.[antennaId]))}</td><td>${escapeHtml(settingsText(recommended.settings?.[antennaId]))}</td></tr>`
  ).join("") || `<tr><td colspan="3">Full antenna settings are unavailable.</td></tr>`;
  const guardrailRows = (recommended.evaluation?.guardrails || []).map((guardrail) =>
    `<tr><td>${escapeHtml(METRIC_LABELS[guardrail.metric] || guardrail.metric)}</td><td>${display(guardrail.baseline)}</td><td>${display(guardrail.actual)}</td><td>${display(guardrail.max_regression)}</td><td class="${guardrail.passed ? "pass" : "fail"}">${guardrail.passed ? "Pass" : "Violated"}</td></tr>`
  ).join("") || `<tr><td colspan="5">No guardrails configured.</td></tr>`;
  const alternativeRows = (optimization.alternatives || []).map((candidate, index) => {
    const evaluations = candidate.evaluation?.evaluations || [];
    return `<tr><td>Alternative ${index + 1}</td><td>${evaluations.filter((item) => item.passed).length}/${evaluations.length}</td><td>${candidate.evaluation?.guardrails?.length ? (candidate.evaluation.guardrails_passed ? "Pass" : "Violated") : "None"}</td><td>${candidate.change_cost?.changed_antennas ?? 0}</td><td>${(candidate.changes || []).length}</td></tr>`;
  }).join("") || `<tr><td colspan="5">No alternative setup available.</td></tr>`;
  const decision = recommended.evaluation?.passed ? "Targets and safety checks passed" : "Engineering review required";
  const decisionClass = recommended.evaluation?.passed ? "pass" : "review";
  const mapSection = baselineGrid?.cells?.length && recommendedGrid?.cells?.length
    ? `<div class="maps"><figure><figcaption>Starting RSRP</figcaption>${gridSvg(baselineGrid, "signal_dbm")}</figure><figure><figcaption>Recommended RSRP</figcaption>${gridSvg(recommendedGrid, "signal_dbm")}</figure><figure><figcaption>RSRP change</figcaption>${gridSvg(recommendedGrid, "signal_dbm", baselineGrid)}</figure></div><p class="legend"><span class="blue">Improved</span><span class="gray">Unchanged / missing</span><span class="red">Regressed</span></p>`
    : `<p class="notice">RF comparison grids are unavailable for this result.</p>`;

  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Optimization report — ${escapeHtml(scene?.name || scene?.id || "Scene")}</title><style>${REPORT_CSS}</style></head><body><main>
  <header class="report-head"><div><p>Network coverage optimization</p><h1>${escapeHtml(scene?.name || "Engineering report")}</h1><small>Scene ${escapeHtml(scene?.id || "—")} · Generated ${escapeHtml(generatedAt.toISOString())}</small></div><strong class="decision ${decisionClass}">${decision}</strong></header>
  <p class="notice">This report contains simulated predictions, not measured live-network values. Engineering review and field validation are required before operational use.</p>
  <section><h2>Recommendation</h2><p>${escapeHtml(optimization.recommendation_reason || "This setup ranked highest against the configured targets.")}</p><dl><div><dt>Tested</dt><dd>${display(optimization.tested_count)} setups</dd></div><div><dt>Budget</dt><dd>${display(optimization.budget_limit)}</dd></div><div><dt>Saved</dt><dd>${display(optimization.budget_saved || 0)} simulations</dd></div><div><dt>Stopped because</dt><dd>${escapeHtml(stopReason(optimization.stop_reason))}</dd></div></dl></section>
  <section><h2>Target results</h2><table><thead><tr><th>Target</th><th>Before</th><th>After</th><th>Required</th><th>Status</th></tr></thead><tbody>${targetRows}</tbody></table></section>
  <section><h2>Antenna settings</h2><table><thead><tr><th>Antenna</th><th>Starting setup</th><th>Recommended setup</th></tr></thead><tbody>${settingRows}</tbody></table><h3>Changed fields</h3><table><thead><tr><th>Antenna</th><th>Setting</th><th>Before</th><th>After</th><th>Change</th></tr></thead><tbody>${changeRows}</tbody></table></section>
  <section><h2>Safety guardrails</h2><table><thead><tr><th>KPI</th><th>Baseline</th><th>Candidate</th><th>Max regression</th><th>Status</th></tr></thead><tbody>${guardrailRows}</tbody></table></section>
  <section><h2>RF grid comparison</h2>${mapSection}</section>
  <section><h2>Alternative setups</h2><table><thead><tr><th>Option</th><th>Targets met</th><th>Guardrails</th><th>Antennas changed</th><th>Adjustments</th></tr></thead><tbody>${alternativeRows}</tbody></table></section>
  </main></body></html>`;
}

export function downloadOptimizationReport(result, scene) {
  const html = buildOptimizationReport({ result, scene });
  const url = URL.createObjectURL(new Blob([html], { type: "text/html;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = `optimization-${safeFilename(scene?.name || scene?.id || "report")}.html`;
  link.click();
  URL.revokeObjectURL(url);
}

function gridSvg(grid, measurement, baselineGrid = null) {
  const cells = grid.cells || [];
  const rows = Number(grid.rows) || Math.max(1, ...cells.map((cell) => Number(cell.row) + 1 || 1));
  const cols = Number(grid.cols) || Math.max(1, ...cells.map((cell) => Number(cell.col) + 1 || 1));
  const baseline = new Map((baselineGrid?.cells || []).map((cell, index) => [cellKey(cell, index), cell]));
  const rects = cells.map((cell, index) => {
    const row = Number.isFinite(Number(cell.row)) ? Number(cell.row) : Math.floor(index / cols);
    const col = Number.isFinite(Number(cell.col)) ? Number(cell.col) : index % cols;
    const value = numeric(cell[measurement]);
    const before = numeric(baseline.get(cellKey(cell, index))?.[measurement]);
    const color = baselineGrid ? deltaColor(value, before) : rsrpColor(value);
    return `<rect x="${col}" y="${rows - row - 1}" width="1" height="1" fill="${color}"/>`;
  }).join("");
  return `<svg viewBox="0 0 ${cols} ${rows}" role="img" aria-label="RF grid heatmap" preserveAspectRatio="none">${rects}</svg>`;
}

function cellKey(cell, index) {
  return Number.isFinite(Number(cell?.row)) && Number.isFinite(Number(cell?.col)) ? `${cell.row}:${cell.col}` : String(index);
}
function numeric(value) { return typeof value === "number" && Number.isFinite(value) ? value : null; }
function rsrpColor(value) { return value === null ? "#cbd3d8" : value < -110 ? "#b84a4a" : value < -95 ? "#d9a441" : value < -80 ? "#6eaa78" : "#267da8"; }
function deltaColor(after, before) { return after === null || before === null || Math.abs(after - before) <= 0.1 ? "#c5ccd1" : after > before ? "#267da8" : "#c35b54"; }
function display(value) { return typeof value === "number" && Number.isFinite(value) ? escapeHtml(Number(value.toFixed(3))) : "—"; }
function signed(value) { const number = Number(value); return Number.isFinite(number) ? `${number > 0 ? "+" : ""}${display(number)}` : "—"; }
function fieldName(field) { return { tilt: "Tilt", tx_power: "Transmit power", azimuth: "Azimuth" }[field] || field || "Setting"; }
function settingsText(settings) { return settings ? `Tilt ${display(settings.tilt)}°, power ${display(settings.tx_power)} dBm, azimuth ${display(settings.azimuth)}°` : "Unavailable"; }
function objectiveName(objective) { if (objective.kind === "threshold_area") return `${String(objective.measurement).replaceAll("_", " ")} threshold area`; if (objective.kind === "percentile") return `P${objective.percentile} ${String(objective.measurement).replaceAll("_", " ")}`; return METRIC_LABELS[objective.metric] || objective.metric || "Objective"; }
function objectiveTarget(objective) { return `${objective.operator || ""} ${display(objective.target)}`.trim(); }
function stopReason(reason) { return { targets_met: "targets met", budget_exhausted: "budget exhausted", refinement_stalled: "local refinement stopped improving", search_space_exhausted: "search space exhausted" }[reason] || reason || "not reported"; }
function safeFilename(value) { return String(value).trim().replace(/[^a-z0-9_-]+/gi, "-").replace(/^-+|-+$/g, "").toLowerCase() || "report"; }
function escapeHtml(value) { return String(value ?? "").replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" })[character]); }

const REPORT_CSS = `:root{color:#20313c;background:#edf1f3;font:14px/1.5 Arial,sans-serif}*{box-sizing:border-box}body{margin:0}main{width:min(1080px,100%);margin:auto;background:#fff;padding:42px}.report-head{display:flex;justify-content:space-between;gap:30px;border-bottom:3px solid #17698a;padding-bottom:18px}.report-head p{margin:0;color:#526773}.report-head h1{margin:3px 0;font-size:28px}.report-head small{color:#6b7880}.decision{align-self:start;border:1px solid;padding:8px 12px}.decision.pass,.pass{color:#18734b}.decision.review,.fail{color:#a33d36}.notice{border-left:3px solid #d09a32;background:#fff8e9;padding:10px 12px}section{margin-top:28px}h2{font-size:17px;border-bottom:1px solid #ccd6db;padding-bottom:6px}table{width:100%;border-collapse:collapse;font-size:12px}th,td{border:1px solid #d4dde1;padding:7px 8px;text-align:left}th{background:#eef3f5}dl{display:grid;grid-template-columns:repeat(4,1fr);border:1px solid #d4dde1}dl div{padding:9px;border-right:1px solid #d4dde1}dt{color:#65747c;font-size:11px}dd{margin:2px 0 0;font-weight:700}.maps{display:grid;grid-template-columns:repeat(3,1fr);gap:10px}.maps figure{margin:0}.maps figcaption{font-size:12px;font-weight:700;margin-bottom:5px}.maps svg{display:block;width:100%;height:190px;border:1px solid #cbd6dc;background:#e8ecef}.legend{display:flex;gap:16px;font-size:11px}.legend span:before{display:inline-block;width:9px;height:9px;margin-right:5px;content:""}.blue:before{background:#267da8}.gray:before{background:#c5ccd1}.red:before{background:#c35b54}@media print{:root{background:#fff}main{padding:0}.report-head{break-after:avoid}section{break-inside:avoid}}@media(max-width:700px){main{padding:20px}.report-head{display:block}.decision{display:inline-block;margin-top:12px}dl,.maps{grid-template-columns:1fr}dl div{border-bottom:1px solid #d4dde1}}`;
