import { mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";

const workflow = readFileSync(resolve(".github/workflows/frontend-ci.yml"), "utf8");
const scripts = JSON.parse(readFileSync(resolve("package.json"), "utf8")).scripts;
const shardCommand = workflow.match(
  /name: Run test shard with coverage\n\s+run: >-\n((?: {10}[^\n]+\n)+)/,
)?.[1];
const mergeCommand = workflow.match(
  /name: Merge reports and enforce original coverage thresholds\n\s+run: ([^\n]+)/,
)?.[1];

// Execute the workflow's actual npm wrappers, not a reimplementation of Vitest's
// CLI parsing. Separate executions model the four independent CI machines.
describe("frontend CI coverage shards", () => {
  it("merges every shard without losing files and still rejects low coverage", () => {
    expect(shardCommand).toBeTruthy();
    expect(mergeCommand).toBeTruthy();
    const root = mkdtempSync(join(tmpdir(), "codevo-frontend-ci-"));
    const run = (command) => {
      const result = spawnSync("bash", ["-eu", "-o", "pipefail", "-c", command], {
        cwd: root,
        encoding: "utf8",
        timeout: 30_000,
        maxBuffer: 4 * 1024 * 1024,
      });
      if (result.error) throw result.error;
      return result;
    };
    try {
      mkdirSync(join(root, "src"));
      symlinkSync(resolve("node_modules"), join(root, "node_modules"), "dir");
      writeFileSync(join(root, "package.json"), JSON.stringify({ type: "module", scripts }));
      writeFileSync(
        join(root, "vitest.config.mjs"),
        `export default { test: { coverage: {
          provider: "v8", reporter: ["json-summary"]
        } } };`,
      );
      for (let index = 1; index <= 4; index++) {
        writeFileSync(join(root, `src/value${index}.ts`), `export const value = () => ${index};\n`);
        writeFileSync(
          join(root, `value${index}.test.ts`),
          `import { test, expect } from "vitest";
           import { value } from "./src/value${index}";
           test("value ${index}", () => expect(value()).toBe(${index}));`,
        );
      }
      for (let shard = 1; shard <= 4; shard++) {
        const command = shardCommand
          .replaceAll("${{ matrix.shard }}", String(shard))
          .trim()
          .replace(/\n\s*/g, " ");
        const result = run(command);
        expect(result.status, result.stdout + result.stderr).toBe(0);
      }
      const merged = run(mergeCommand);
      expect(merged.status, merged.stdout + merged.stderr).toBe(0);
      const summary = JSON.parse(
        readFileSync(join(root, "coverage/coverage-summary.json"), "utf8"),
      );
      expect(summary.total.lines.pct).toBe(100);
      expect(Object.keys(summary).filter((key) => key !== "total")).toHaveLength(4);
      // Every shard includes uncovered source. One shard alone has 25% coverage,
      // below the unchanged package.json thresholds enforced by the merge job.
      for (const shard of [2, 3, 4]) rmSync(join(root, `.vitest-reports/blob-${shard}-4.json`));
      const incomplete = run(mergeCommand);
      expect(incomplete.status, incomplete.stdout + incomplete.stderr).not.toBe(0);
      expect(incomplete.stdout + incomplete.stderr).toContain("does not meet global threshold");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }, 120_000);
});
