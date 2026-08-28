import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  formatBundleBudgetReport,
  INITIAL_ASSET_LIMIT_BYTES,
  inspectBundleBudget,
} from "./check-initial-bundle-budget.mjs";

describe("initial bundle budget", () => {
  it("fails only oversized assets in the initial static graph and reports heavy on-demand assets", () => {
    const report = formatBundleBudgetReport([
      { bytes: INITIAL_ASSET_LIMIT_BYTES + 1, initial: true, name: "entry.js" },
      { bytes: INITIAL_ASSET_LIMIT_BYTES + 2, initial: false, name: "ts.worker.js" },
    ]);

    expect(report.oversizedInitial.map(({ name }) => name)).toEqual(["entry.js"]);
    expect(report.initialBudgetExceeded).toBe(true);
    expect(report.lines.join("\n")).toMatch(/ts\.worker\.js/);
  });

  it("fails an aggregate pre-paint closure over budget even when every asset is smaller", () => {
    const report = formatBundleBudgetReport([
      { bytes: 300 * 1024, initial: true, name: "entry.js" },
      { bytes: 300 * 1024, initial: true, name: "shared.js" },
    ]);

    expect(report.oversizedInitial).toHaveLength(0);
    expect(report.initialBytes).toBe(600 * 1024);
    expect(report.initialBudgetExceeded).toBe(true);
  });

  it("walks static imports without treating dynamic chunks as initial", async () => {
    const directory = await mkdtemp(join(tmpdir(), "codevo-bundle-budget-"));
    try {
      await mkdir(join(directory, "assets"));
      await writeFile(
        join(directory, "index.html"),
        '<script type="module" src="./assets/entry.js"></script>',
      );
      await writeFile(
        join(directory, "assets/entry.js"),
        'import "./static.js"; "codevo-startup-shell-painted"; import("./on-demand.js");',
      );
      await writeFile(join(directory, "assets/static.js"), "export const value = 1;");
      await writeFile(join(directory, "assets/on-demand.js"), "export const value = 2;");

      const assets = await inspectBundleBudget(directory);
      expect(assets.find(({ name }) => name === "entry.js")?.initial).toBe(true);
      expect(assets.find(({ name }) => name === "static.js")?.initial).toBe(true);
      expect(assets.find(({ name }) => name === "on-demand.js")?.initial).toBe(false);
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  });

  it("counts a dynamic import started before the startup paint mark as initial", async () => {
    const directory = await mkdtemp(join(tmpdir(), "codevo-bundle-budget-eager-"));
    try {
      await mkdir(join(directory, "assets"));
      await writeFile(
        join(directory, "index.html"),
        '<script type="module" src="./assets/entry.js"></script>',
      );
      await writeFile(
        join(directory, "assets/entry.js"),
        'import("./eager.js"); "codevo-startup-shell-painted";',
      );
      await writeFile(join(directory, "assets/eager.js"), "export const value = 1;");

      const assets = await inspectBundleBudget(directory);
      expect(assets.find(({ name }) => name === "eager.js")?.initial).toBe(true);
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  });

  it("counts modulepreload assets as part of the pre-paint closure", async () => {
    const directory = await mkdtemp(join(tmpdir(), "codevo-bundle-budget-preload-"));
    try {
      await mkdir(join(directory, "assets"));
      await writeFile(
        join(directory, "index.html"),
        [
          '<script type="module" src="./assets/entry.js"></script>',
          '<link href="./assets/preloaded.js" rel="modulepreload">',
        ].join(""),
      );
      await writeFile(join(directory, "assets/entry.js"), '"codevo-startup-shell-painted";');
      await writeFile(join(directory, "assets/preloaded.js"), "export const value = 1;");

      const assets = await inspectBundleBudget(directory);
      expect(assets.find(({ name }) => name === "preloaded.js")?.initial).toBe(true);
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  });

  it("counts immediate dynamic imports in statically reached helpers", async () => {
    const directory = await mkdtemp(join(tmpdir(), "codevo-bundle-budget-helper-"));
    try {
      await mkdir(join(directory, "assets"));
      await writeFile(
        join(directory, "index.html"),
        '<script type="module" src="./assets/entry.js"></script>',
      );
      await writeFile(
        join(directory, "assets/entry.js"),
        'import "./helper.js"; "codevo-startup-shell-painted";',
      );
      await writeFile(join(directory, "assets/helper.js"), 'import("./eager.js");');
      await writeFile(join(directory, "assets/eager.js"), "export const value = 1;");

      const assets = await inspectBundleBudget(directory);
      expect(assets.find(({ name }) => name === "eager.js")?.initial).toBe(true);
    } finally {
      await rm(directory, { force: true, recursive: true });
    }
  });
});
