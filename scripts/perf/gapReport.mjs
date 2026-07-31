export const DEFAULT_TOLERANCES = [
  { pattern: /^(typing|tab-switch|quickopen|completion|definition)/, budget: 1.25 },
  { pattern: /^(references|rename)/, budget: 1.5 },
];

const MEMORY_SAMPLE_ID = "memory-sample";

export function buildGapReport({ codevo, baseline, tolerances }) {
  const baselineById = new Map(baseline.scenarios.map((scenario) => [scenario.id, scenario]));
  const rows = codevo.scenarios
    .filter((scenario) => scenario.id !== MEMORY_SAMPLE_ID)
    .map((scenario) => buildRow(scenario, baselineById.get(scenario.id), tolerances));
  const failures = rows.filter((row) => row.status === "fail");

  return { rows, failures };
}

function buildRow(codevoScenario, baselineScenario, tolerances) {
  const id = codevoScenario.id;
  const codevoP95 = codevoScenario.p95;
  const vscodeP95 = baselineScenario?.p95;
  const ratio = typeof vscodeP95 === "number" && vscodeP95 > 0 ? codevoP95 / vscodeP95 : null;
  const budget = budgetForId(id, tolerances);
  const status = statusFor({ codevoScenario, baselineScenario, ratio, budget });

  return { id, codevoP95, vscodeP95: vscodeP95 ?? null, ratio, budget, status };
}

function budgetForId(id, tolerances) {
  const tolerance = tolerances.find((entry) => entry.pattern.test(id));

  return tolerance ? tolerance.budget : null;
}

function statusFor({ codevoScenario, baselineScenario, ratio, budget }) {
  if (codevoScenario.skipped === true) {
    return "skipped";
  }

  if (!baselineScenario) {
    return "no-baseline";
  }

  if (ratio !== null && budget !== null && ratio > budget) {
    return "fail";
  }

  return "pass";
}

export function renderGapReportMarkdown(report) {
  const header = "| Scenario | Codevo p95 | VS Code p95 | Ratio | Budget | Status |";
  const divider = "| --- | --- | --- | --- | --- | --- |";
  const rows = report.rows.map(renderRow);

  return [header, divider, ...rows].join("\n");
}

function renderRow(row) {
  const codevoP95 = formatNumber(row.codevoP95);
  const vscodeP95 = formatNumber(row.vscodeP95);
  const ratio = formatNumber(row.ratio);
  const budget = formatNumber(row.budget);

  return `| ${row.id} | ${codevoP95} | ${vscodeP95} | ${ratio} | ${budget} | ${row.status} |`;
}

function formatNumber(value) {
  if (typeof value !== "number") {
    return "n/a";
  }

  return value.toFixed(2);
}
