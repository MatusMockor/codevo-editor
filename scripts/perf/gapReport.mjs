export const DEFAULT_TOLERANCES = [
  { pattern: /^(typing|tab-switch|quickopen|completion|definition)/, budget: 1.25 },
  { pattern: /^(references|rename)/, budget: 1.5 },
];

const MEMORY_SAMPLE_ID = "memory-sample";

export function buildGapReport({ codevo, baseline, tolerances }) {
  const baselineById = new Map(baseline.scenarios.map((scenario) => [scenario.id, scenario]));
  const codevoById = new Map(
    codevo.scenarios
      .filter((scenario) => scenario.id !== MEMORY_SAMPLE_ID)
      .map((scenario) => [scenario.id, scenario]),
  );
  const forwardRows = [...codevoById.values()].map((scenario) =>
    buildRow(scenario, baselineById.get(scenario.id), tolerances),
  );
  const missingRows = baseline.scenarios
    .filter((scenario) => !codevoById.has(scenario.id))
    .map((scenario) => buildMissingCodevoRow(scenario, tolerances));
  const rows = [...forwardRows, ...missingRows];
  const failures = rows.filter((row) => row.status === "fail");
  const failedPaths = Array.isArray(codevo.failedPaths) ? codevo.failedPaths : [];

  return { rows, failures, failedPaths };
}

function buildRow(codevoScenario, baselineScenario, tolerances) {
  const id = codevoScenario.id;
  const codevoP95 = normalizedNumber(codevoScenario.p95);
  const vscodeP95 = normalizedNumber(baselineScenario?.p95);
  const ratio = ratioFor(codevoP95, vscodeP95);
  const budget = budgetForId(id, tolerances);
  const status = statusFor({ codevoScenario, baselineScenario, ratio, budget });

  return { id, codevoP95, vscodeP95, ratio, budget, status };
}

function buildMissingCodevoRow(baselineScenario, tolerances) {
  const id = baselineScenario.id;

  return {
    id,
    codevoP95: null,
    vscodeP95: normalizedNumber(baselineScenario.p95),
    ratio: null,
    budget: budgetForId(id, tolerances),
    status: "no-result",
  };
}

function normalizedNumber(value) {
  return typeof value === "number" ? value : null;
}

function ratioFor(codevoP95, vscodeP95) {
  if (typeof codevoP95 === "number" && typeof vscodeP95 === "number" && vscodeP95 > 0) {
    return codevoP95 / vscodeP95;
  }

  return null;
}

function budgetForId(id, tolerances) {
  const tolerance = tolerances.find((entry) => entry.pattern.test(id));

  return tolerance ? tolerance.budget : null;
}

function statusFor({ codevoScenario, baselineScenario, ratio, budget }) {
  if (codevoScenario.status === "not-run") {
    return "not-run";
  }

  if (codevoScenario.skipped === true || codevoScenario.status === "skipped") {
    return "skipped";
  }

  if (!baselineScenario) {
    return "no-baseline";
  }

  if (budget === null) {
    return "no-budget";
  }

  if (ratio !== null && ratio > budget) {
    return "fail";
  }

  return "pass";
}

export function renderGapReportMarkdown(report) {
  const header = "| Scenario | Codevo p95 | VS Code p95 | Ratio | Budget | Status |";
  const divider = "| --- | --- | --- | --- | --- | --- |";
  const rows = report.rows.map(renderRow);
  const lines = [header, divider, ...rows];

  if (report.failedPaths?.length > 0) {
    lines.push("", renderFailedPaths(report.failedPaths));
  }

  return lines.join("\n");
}

function renderFailedPaths(failedPaths) {
  return `Failed paths: ${failedPaths.length} (${failedPaths.join(", ")})`;
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
