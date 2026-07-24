import { spawnSync } from "node:child_process";

const budget = Number.parseInt(process.env.CLIPPY_WARNING_BUDGET ?? "0", 10);
if (!Number.isSafeInteger(budget) || budget < 0) {
  console.error("CLIPPY_WARNING_BUDGET must be a non-negative integer.");
  process.exit(2);
}

const result = spawnSync(
  "cargo",
  [
    "clippy",
    "--manifest-path",
    "src-tauri/Cargo.toml",
    "--all-targets",
    "--all-features",
    "--message-format=json",
  ],
  {
    encoding: "utf8",
    maxBuffer: 128 * 1024 * 1024,
  },
);

if (result.stderr) {
  process.stderr.write(result.stderr);
}
if (result.error) {
  console.error(`Unable to run Clippy: ${result.error.message}`);
  process.exit(2);
}
const warnings = new Set();
const diagnostics = [];
for (const line of result.stdout.split("\n")) {
  if (!line.trim()) continue;

  let event;
  try {
    event = JSON.parse(line);
  } catch {
    continue;
  }

  if (event.reason !== "compiler-message") {
    continue;
  }

  diagnostics.push(event.message);
  if (event.message?.level !== "warning") continue;

  const span =
    event.message.spans?.find((candidate) => candidate.is_primary) ?? event.message.spans?.[0];
  warnings.add(
    JSON.stringify([
      event.message.code?.code ?? "",
      event.message.message ?? "",
      span?.file_name ?? "",
      span?.line_start ?? 0,
      span?.column_start ?? 0,
    ]),
  );
}

if (result.status !== 0) {
  for (const diagnostic of diagnostics) {
    if (diagnostic.level === "warning") continue;
    process.stderr.write(diagnostic.rendered ?? `${diagnostic.level}: ${diagnostic.message}\n`);
  }
  process.exit(result.status ?? 1);
}

console.log(`Clippy warning budget: ${warnings.size}/${budget}`);
if (warnings.size > budget) {
  console.error(
    `Clippy introduced ${warnings.size - budget} warning(s). Fix them or deliberately lower existing debt before updating the budget.`,
  );
  process.exit(1);
}
