# C7.1 Measurement Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the C7 measurement foundation: deterministic perf fixtures, in-app latency exposure, a CDP scenario runner, a VS Code baseline harness, and a gap report comparing Codevo to VS Code.

**Architecture:** Extend the existing `latencyTracker` domain and QA-bridge/CDP patterns instead of inventing parallel systems. Interactive metrics that need frame timing (typing, tab switch) are measured by a new dev-only `window.__codevoPerf` bridge installed from the App composition root; LSP round-trip metrics reuse the existing per-root latency trackers with two new operation kinds (references, rename). A Node CDP runner drives scenarios and dumps JSON; a VS Code extension-development harness produces baseline numbers on the same fixtures; a report script merges both.

**Tech Stack:** TypeScript + React + Monaco + Tauri (existing), Node ESM scripts, Vitest, Chrome DevTools Protocol over WebSocket (same as `scripts/qa-project-scenarios.mjs`), VS Code extension API for the baseline.

## Global Constraints

- Follow the spec: `docs/superpowers/specs/2026-07-31-c7-performance-design.md`.
- No code comments (repo rule); guard clauses only, never `else`/`elseif`.
- Perf bridge and probes must be dev-only: gated like `editorQaBridgeEnabled` (`import.meta.env.DEV` plus `VITE_CODEVO_PERF_BRIDGE === "1"`, localStorage fallback `codevo.perfBridge`). Zero release overhead.
- Do not weaken workspace ownership, boundedness, or fail-closed rules.
- `perf/fixtures/` and `perf/results/` are gitignored; `perf/baselines/` is committed.
- Commit per task on `main` after a clean review, never push. `git add` ONLY the files you created or modified for your task - the worktree contains unrelated uncommitted changes from another agent (docs/*, scripts/check-hotspot-size-budget.*, src-tauri/src/js_ts_file_watcher.rs); never stage, revert, or touch them. No AI/Claude/Anthropic attribution or Co-Authored-By lines in commit messages.
- Do not run `coderabbit` in this repo. Review happens via a separate read-only subagent.
- Gates before calling the slice done: `npm run check`, `npm run lint -- --max-warnings 0`, `npm test -- --run`, `npm run size:hotspots`, `npm run format:check:changed`, and the Cargo matrix only if Rust files changed (none are planned).

---

### Task 1: Deterministic fixture generator core (seeded RNG + large TS files)

**Files:**
- Create: `scripts/perf/fixtureGenerator.mjs`
- Create: `scripts/perf/fixtureGenerator.test.mjs`
- Create: `scripts/perf/generate-fixtures.mjs` (CLI entry)
- Modify: `package.json` (add `"perf:fixtures": "node ./scripts/perf/generate-fixtures.mjs"`)
- Modify: `.gitignore` (add `perf/fixtures/` and `perf/results/`)

**Interfaces:**
- Produces: `createSeededRandom(seed: number): () => number`, `generateLargeTsFileContent({ lines, random }): string`, `generateMinifiedTsFileContent({ statements, random }): string`, `generateHugeUnionTsFileContent({ members }): string`, `writeLargeFileFixtures({ rootDir, fs })` writing `perf/fixtures/large-files/{large-5k.ts,large-20k.ts,large-100k.ts,minified.ts,huge-union.ts}`.

- [ ] **Step 1: Write the failing test**

```js
import { describe, expect, it } from "vitest";
import {
  createSeededRandom,
  generateHugeUnionTsFileContent,
  generateLargeTsFileContent,
  generateMinifiedTsFileContent,
} from "./fixtureGenerator.mjs";

describe("createSeededRandom", () => {
  it("is deterministic for the same seed", () => {
    const a = createSeededRandom(42);
    const b = createSeededRandom(42);
    expect([a(), a(), a()]).toEqual([b(), b(), b()]);
  });
});

describe("generateLargeTsFileContent", () => {
  it("produces the requested line count deterministically", () => {
    const first = generateLargeTsFileContent({ lines: 5000, random: createSeededRandom(1) });
    const second = generateLargeTsFileContent({ lines: 5000, random: createSeededRandom(1) });
    expect(first).toBe(second);
    expect(first.split("\n").length).toBe(5000);
  });

  it("contains realistic TS constructs", () => {
    const content = generateLargeTsFileContent({ lines: 5000, random: createSeededRandom(1) });
    expect(content).toContain("export interface ");
    expect(content).toContain("export function ");
    expect(content).toContain("export type ");
    expect(content).toContain("import ");
  });
});

describe("generateMinifiedTsFileContent", () => {
  it("emits a single line", () => {
    const content = generateMinifiedTsFileContent({ statements: 20000, random: createSeededRandom(7) });
    expect(content.includes("\n")).toBe(false);
    expect(content.length).toBeGreaterThan(100000);
  });
});

describe("generateHugeUnionTsFileContent", () => {
  it("emits the requested union member count", () => {
    const content = generateHugeUnionTsFileContent({ members: 2000 });
    expect(content.split("|").length).toBeGreaterThanOrEqual(2000);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run scripts/perf/fixtureGenerator.test.mjs`
Expected: FAIL (module does not exist).

- [ ] **Step 3: Write the implementation**

`scripts/perf/fixtureGenerator.mjs` - key content (mulberry32 PRNG; block-based file assembly; every block is pure string building):

```js
import path from "node:path";

export function createSeededRandom(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pick(random, items) {
  return items[Math.floor(random() * items.length)];
}

const TYPE_NAMES = ["User", "Order", "Invoice", "Widget", "Session", "Report", "Task", "Event"];

function interfaceBlock(random, index) {
  const name = `${pick(random, TYPE_NAMES)}Model${index}`;
  const fields = Array.from(
    { length: 3 + Math.floor(random() * 5) },
    (_, i) => `  readonly field${i}: ${pick(random, ["string", "number", "boolean", `${name}Kind`])};`,
  );
  return [
    `export type ${name}Kind = ${["\"a\"", "\"b\"", "\"c\""].join(" | ")};`,
    `export interface ${name} {`,
    ...fields,
    `}`,
  ];
}

function functionBlock(random, index) {
  const name = `process${pick(random, TYPE_NAMES)}${index}`;
  return [
    `export function ${name}(input: { id: number; label: string }): string {`,
    `  if (input.id < 0) {`,
    `    return "invalid";`,
    `  }`,
    `  const parts = [input.label, String(input.id)];`,
    `  return parts.join("-");`,
    `}`,
  ];
}

function typeAliasBlock(random, index) {
  const name = `${pick(random, TYPE_NAMES)}Union${index}`;
  const members = Array.from({ length: 4 + Math.floor(random() * 8) }, (_, i) => `"variant${i}"`);
  return [`export type ${name} = ${members.join(" | ")};`];
}

const BLOCK_BUILDERS = [interfaceBlock, functionBlock, typeAliasBlock];

export function generateLargeTsFileContent({ lines, random }) {
  const out = [`import { strict as assert } from "node:assert";`, `void assert;`];
  let index = 0;
  while (out.length < lines - 1) {
    const block = pick(random, BLOCK_BUILDERS)(random, index);
    out.push(...block, "");
    index += 1;
  }
  return out.slice(0, lines - 1).concat([""]).join("\n").split("\n").slice(0, lines).join("\n");
}

export function generateMinifiedTsFileContent({ statements, random }) {
  const parts = Array.from(
    { length: statements },
    (_, i) => `export const v${i}=${Math.floor(random() * 1000)};`,
  );
  return parts.join("");
}

export function generateHugeUnionTsFileContent({ members }) {
  const values = Array.from({ length: members }, (_, i) => `"member_${i}"`);
  return [
    `export type HugeUnion =`,
    `  | ${values.join("\n  | ")};`,
    `export function isHugeUnion(value: string): value is HugeUnion {`,
    `  return value.startsWith("member_");`,
    `}`,
    ``,
  ].join("\n");
}

export const LARGE_FILE_SPECS = [
  { name: "large-5k.ts", lines: 5000, seed: 5 },
  { name: "large-20k.ts", lines: 20000, seed: 20 },
  { name: "large-100k.ts", lines: 100000, seed: 100 },
];

export function writeLargeFileFixtures({ rootDir, fs }) {
  const dir = path.join(rootDir, "large-files");
  fs.mkdirSync(dir, { recursive: true });
  for (const spec of LARGE_FILE_SPECS) {
    fs.writeFileSync(
      path.join(dir, spec.name),
      generateLargeTsFileContent({ lines: spec.lines, random: createSeededRandom(spec.seed) }),
    );
  }
  fs.writeFileSync(
    path.join(dir, "minified.ts"),
    generateMinifiedTsFileContent({ statements: 20000, random: createSeededRandom(9) }),
  );
  fs.writeFileSync(path.join(dir, "huge-union.ts"), generateHugeUnionTsFileContent({ members: 2000 }));
}
```

Adjust `generateLargeTsFileContent` if the exact-line-count assertion needs padding lines; the test is the contract.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run scripts/perf/fixtureGenerator.test.mjs`
Expected: PASS.

- [ ] **Step 5: CLI entry, npm script, gitignore**

`scripts/perf/generate-fixtures.mjs`:

```js
#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { writeLargeFileFixtures } from "./fixtureGenerator.mjs";
import { writeMonorepoFixture } from "./monorepoFixture.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const fixturesRoot = path.join(repoRoot, "perf", "fixtures");
fs.rmSync(fixturesRoot, { recursive: true, force: true });
fs.mkdirSync(fixturesRoot, { recursive: true });
writeLargeFileFixtures({ rootDir: fixturesRoot, fs });
writeMonorepoFixture({ rootDir: fixturesRoot, fs });
console.log(`Fixtures written to ${fixturesRoot}`);
```

Until Task 2 exists, stub `monorepoFixture.mjs` is NOT created; instead comment out nothing - simply write the import only in Task 2 and keep the CLI in this task limited to `writeLargeFileFixtures`. Concretely: in this task the CLI contains only the large-files call; Task 2 adds the monorepo import and call.

Add to `package.json` scripts: `"perf:fixtures": "node ./scripts/perf/generate-fixtures.mjs"`.
Append to `.gitignore`:

```
perf/fixtures/
perf/results/
```

Run: `npm run perf:fixtures` and `ls perf/fixtures/large-files` - expect the five files; open `large-100k.ts` size roughly 2-4 MB.

---

### Task 2: Monorepo fixture (50 packages, project references, barrel exports)

**Files:**
- Create: `scripts/perf/monorepoFixture.mjs`
- Create: `scripts/perf/monorepoFixture.test.mjs`
- Modify: `scripts/perf/generate-fixtures.mjs` (add monorepo call)

**Interfaces:**
- Consumes: `createSeededRandom`, `generateLargeTsFileContent` from `scripts/perf/fixtureGenerator.mjs`.
- Produces: `writeMonorepoFixture({ rootDir, fs })` creating `perf/fixtures/monorepo/` with root `package.json` (npm workspaces `packages/*`), root `tsconfig.json` with `references`, and 50 packages `packages/pkg-00 .. pkg-49`, each with `package.json`, `tsconfig.json` (composite, references to two earlier packages), `src/index.ts` barrel re-exporting `src/moduleA.ts` and `src/moduleB.ts` (~200 lines each, generated), where `moduleA.ts` imports from up to two earlier packages (`@perf/pkg-NN`). Total roughly 10k files achieved by also generating `src/extra/file-000.ts .. file-N.ts` (60 small generated files per package).

- [ ] **Step 1: Write the failing test**

```js
import { describe, expect, it } from "vitest";
import path from "node:path";
import { Volume } from "memfs";
import { writeMonorepoFixture, MONOREPO_PACKAGE_COUNT } from "./monorepoFixture.mjs";

function memFs() {
  const volume = new Volume();
  return {
    volume,
    fs: {
      mkdirSync: (p, o) => volume.mkdirSync(p, o),
      writeFileSync: (p, c) => volume.writeFileSync(p, c),
    },
  };
}

describe("writeMonorepoFixture", () => {
  it("creates the workspace root and all packages", () => {
    const { volume, fs } = memFs();
    writeMonorepoFixture({ rootDir: "/fx", fs });
    const rootPkg = JSON.parse(volume.readFileSync("/fx/monorepo/package.json", "utf8"));
    expect(rootPkg.workspaces).toEqual(["packages/*"]);
    expect(MONOREPO_PACKAGE_COUNT).toBe(50);
    const pkg = JSON.parse(volume.readFileSync("/fx/monorepo/packages/pkg-49/package.json", "utf8"));
    expect(pkg.name).toBe("@perf/pkg-49");
  });

  it("wires project references and cross-package imports", () => {
    const { volume, fs } = memFs();
    writeMonorepoFixture({ rootDir: "/fx", fs });
    const tsconfig = JSON.parse(volume.readFileSync("/fx/monorepo/packages/pkg-10/tsconfig.json", "utf8"));
    expect(tsconfig.references.length).toBeGreaterThan(0);
    const moduleA = volume.readFileSync("/fx/monorepo/packages/pkg-10/src/moduleA.ts", "utf8");
    expect(moduleA).toContain("@perf/pkg-");
    const barrel = volume.readFileSync("/fx/monorepo/packages/pkg-10/src/index.ts", "utf8");
    expect(barrel).toContain("export * from \"./moduleA\";");
  });

  it("is deterministic", () => {
    const a = memFs();
    const b = memFs();
    writeMonorepoFixture({ rootDir: "/fx", fs: a.fs });
    writeMonorepoFixture({ rootDir: "/fx", fs: b.fs });
    expect(a.volume.readFileSync("/fx/monorepo/packages/pkg-05/src/moduleB.ts", "utf8")).toBe(
      b.volume.readFileSync("/fx/monorepo/packages/pkg-05/src/moduleB.ts", "utf8"),
    );
  });
});
```

If `memfs` is not already a devDependency, check `package.json`; if missing, install it: `npm install -D memfs`.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run scripts/perf/monorepoFixture.test.mjs`
Expected: FAIL.

- [ ] **Step 3: Implement `monorepoFixture.mjs`**

```js
import path from "node:path";
import { createSeededRandom, generateLargeTsFileContent } from "./fixtureGenerator.mjs";

export const MONOREPO_PACKAGE_COUNT = 50;
const EXTRA_FILES_PER_PACKAGE = 60;

function packageName(index) {
  return `pkg-${String(index).padStart(2, "0")}`;
}

function referenceIndexes(index) {
  if (index === 0) {
    return [];
  }
  if (index === 1) {
    return [0];
  }
  return [index - 1, Math.floor(index / 2)];
}

export function writeMonorepoFixture({ rootDir, fs }) {
  const root = path.join(rootDir, "monorepo");
  fs.mkdirSync(root, { recursive: true });
  fs.writeFileSync(
    path.join(root, "package.json"),
    JSON.stringify({ name: "@perf/monorepo", private: true, workspaces: ["packages/*"] }, null, 2),
  );
  fs.writeFileSync(
    path.join(root, "tsconfig.json"),
    JSON.stringify(
      {
        files: [],
        references: Array.from({ length: MONOREPO_PACKAGE_COUNT }, (_, i) => ({
          path: `./packages/${packageName(i)}`,
        })),
      },
      null,
      2,
    ),
  );
  for (let i = 0; i < MONOREPO_PACKAGE_COUNT; i += 1) {
    writePackage({ root, fs, index: i });
  }
}

function writePackage({ root, fs, index }) {
  const name = packageName(index);
  const dir = path.join(root, "packages", name);
  const srcDir = path.join(dir, "src");
  const extraDir = path.join(srcDir, "extra");
  fs.mkdirSync(extraDir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, "package.json"),
    JSON.stringify(
      { name: `@perf/${name}`, version: "1.0.0", main: "src/index.ts", types: "src/index.ts" },
      null,
      2,
    ),
  );
  const references = referenceIndexes(index).map((ref) => ({
    path: `../${packageName(ref)}`,
  }));
  fs.writeFileSync(
    path.join(dir, "tsconfig.json"),
    JSON.stringify(
      {
        compilerOptions: { composite: true, strict: true, module: "esnext", moduleResolution: "bundler" },
        include: ["src"],
        references,
      },
      null,
      2,
    ),
  );
  const imports = referenceIndexes(index)
    .map((ref, i) => `import * as dep${i} from "@perf/${packageName(ref)}";`)
    .concat(referenceIndexes(index).map((_, i) => `void dep${i};`));
  const random = createSeededRandom(1000 + index);
  const moduleBody = generateLargeTsFileContent({ lines: 200, random });
  fs.writeFileSync(path.join(srcDir, "moduleA.ts"), [...imports, moduleBody].join("\n"));
  fs.writeFileSync(path.join(srcDir, "moduleB.ts"), moduleBody);
  fs.writeFileSync(
    path.join(srcDir, "index.ts"),
    ['export * from "./moduleA";', 'export * as moduleB from "./moduleB";', ""].join("\n"),
  );
  for (let f = 0; f < EXTRA_FILES_PER_PACKAGE; f += 1) {
    const extraRandom = createSeededRandom(index * 1000 + f);
    fs.writeFileSync(
      path.join(extraDir, `file-${String(f).padStart(3, "0")}.ts`),
      generateLargeTsFileContent({ lines: 40, random: extraRandom }),
    );
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run scripts/perf/monorepoFixture.test.mjs`
Expected: PASS.

- [ ] **Step 5: Wire into the CLI and regenerate**

Add to `scripts/perf/generate-fixtures.mjs` the import and `writeMonorepoFixture({ rootDir: fixturesRoot, fs })` call (as shown in Task 1 Step 5 final form).
Run: `npm run perf:fixtures`, then `find perf/fixtures/monorepo -type f | wc -l` - expect roughly 3200+ files (50 packages x 64 files + roots). Cross-check one package compiles conceptually: `npx tsc --noEmit -p perf/fixtures/monorepo/packages/pkg-00` (allow failure only for missing dep resolution of `@perf/*`; if it fails on module resolution, add `"paths": { "@perf/*": ["../*/src"] }` with `"baseUrl": "."` to the root and package tsconfigs and re-run).

---

### Task 3: Domain latency kinds for references and rename

**Files:**
- Modify: `src/domain/latencyTracker.ts:13-21` (`LATENCY_OPERATION_KINDS`), `:59-67` (`OPERATION_LABELS`)
- Modify: `src/application/workbenchController/useWorkbenchLatencyTracking.ts:51-66` (widen `feature` parameter)
- Test: `src/domain/latencyTracker.test.ts` (extend existing; if it does not exist, create it)

**Interfaces:**
- Produces: `LatencyOperationKind` now includes `"references"` and `"rename"`; `recordCompletionLatency(durationMs: number, rootPath?: string, feature: LatencyOperationKind = "completion")`.

- [ ] **Step 1: Write the failing test**

Locate the existing test with `ls src/domain/latencyTracker.test.ts`; extend or create:

```ts
import { describe, expect, it } from "vitest";
import {
  LATENCY_OPERATION_KINDS,
  createLatencyTracker,
  latencyOperationLabel,
} from "./latencyTracker";

describe("latency operation kinds", () => {
  it("includes references and rename with labels", () => {
    expect(LATENCY_OPERATION_KINDS).toContain("references");
    expect(LATENCY_OPERATION_KINDS).toContain("rename");
    expect(latencyOperationLabel("references")).toBe("References");
    expect(latencyOperationLabel("rename")).toBe("Rename");
  });

  it("records and snapshots the new kinds", () => {
    const tracker = createLatencyTracker();
    tracker.record("references", 12);
    tracker.record("rename", 30);
    const kinds = tracker.snapshot().map((entry) => entry.kind);
    expect(kinds).toContain("references");
    expect(kinds).toContain("rename");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/domain/latencyTracker.test.ts`
Expected: FAIL (unknown kinds).

- [ ] **Step 3: Implement**

In `LATENCY_OPERATION_KINDS` insert `"references"` and `"rename"` after `"completion"`. In `OPERATION_LABELS` add `references: "References"` and `rename: "Rename"`.
In `useWorkbenchLatencyTracking.ts` change the `feature` parameter type of `recordCompletionLatency` from `"completion" | "definition"` to `LatencyOperationKind` (import the type from `../../domain/latencyTracker`), default stays `"completion"`.

- [ ] **Step 4: Run tests and typecheck**

Run: `npx vitest run src/domain/latencyTracker.test.ts` - PASS.
Run: `npm run check` - PASS (the widened parameter is backward compatible).

---

### Task 4: Record references and rename latencies in the JS/TS providers

**Files:**
- Modify: `src/components/javascriptTypescriptProviders/navigation.ts` (references path, near the existing latency recording at lines 71/89)
- Modify: `src/components/javascriptTypescriptProviders/rename.ts` (`provideJavaScriptTypeScriptRenameEdits`, line 37)
- Test: extend the existing provider tests next to those files (find them with `ls src/components/javascriptTypescriptProviders/*.test.*`)

**Interfaces:**
- Consumes: the widened `recordCompletionLatency(durationMs, rootPath, feature)` callback already threaded into these providers for `"completion"`/`"definition"` (follow the exact wiring used at `navigation.ts:71-89` and `completion.ts:157-178`).
- Produces: `"references"` samples recorded around the references round-trip; `"rename"` samples recorded around the rename-edits round-trip.

- [ ] **Step 1: Read the two current call sites**

Read `src/components/javascriptTypescriptProviders/navigation.ts` fully. Note exactly how the definition path measures `performance.now()` around the request and calls the latency callback. `provideJavaScriptTypeScriptReferences` (line 144) delegates to internal `provideNavigation` (line 53); the latency hook currently fires only for definition.

- [ ] **Step 2: Write the failing tests**

In the existing navigation test file, add a test that invokes `provideJavaScriptTypeScriptReferences` with a stub gateway resolving after a tick and asserts the latency callback was called with feature `"references"` and a non-negative duration. Mirror the shape of the existing definition-latency test in that file (copy its stub setup; change the invoked function and expected feature string). Do the same in the rename test file for `provideJavaScriptTypeScriptRenameEdits` with feature `"rename"`.

- [ ] **Step 3: Run tests to verify they fail**

Run: `npx vitest run src/components/javascriptTypescriptProviders/`
Expected: the two new tests FAIL, everything else PASSES.

- [ ] **Step 4: Implement**

In `provideNavigation`, thread the feature kind of the caller (`definition` variants pass their existing kinds; `references` passes `"references"`) and record via the same callback pathway the definition path uses. In `rename.ts`, wrap the gateway round-trip in `const start = performance.now();` before and record `performance.now() - start` with `"rename"` after settle, matching the try/finally shape used in `completion.ts:157-178`.

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run src/components/javascriptTypescriptProviders/` - PASS.
Run: `npm run check` - PASS.

---

### Task 5: Expose latency snapshot reset in the controller

**Files:**
- Modify: `src/application/workbenchController/useWorkbenchLatencyTracking.ts` (add `clearLatencyMetrics`)
- Modify: `src/application/useWorkbenchController.ts` (return `getLatencySnapshot` and `clearLatencyMetrics` if not already returned; `getLatencySnapshot` exists at `useWorkbenchLatencyTracking.ts:68`)
- Test: `src/application/workbenchController/useWorkbenchLatencyTracking.test.ts` (create if absent)

**Interfaces:**
- Produces: `clearLatencyMetrics(): void` clearing the tracker of the current workspace root; controller return object exposes `getLatencySnapshot: () => LatencySnapshotEntry[]` and `clearLatencyMetrics: () => void`.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import { renderHook } from "@testing-library/react";
import { useRef } from "react";
import type { LatencyTracker } from "../../domain/latencyTracker";
import {
  useWorkbenchLatencyReporting,
  useWorkbenchLatencyTrackerForRoot,
} from "./useWorkbenchLatencyTracking";

function setup() {
  return renderHook(() => {
    const currentWorkspaceRootRef = useRef<string | null>("/tmp/project");
    const latencyTrackersByRootRef = useRef<Record<string, LatencyTracker>>({});
    const latencyTrackerForRoot = useWorkbenchLatencyTrackerForRoot({
      currentWorkspaceRootRef,
      latencyTrackersByRootRef,
    });
    const reporting = useWorkbenchLatencyReporting({
      currentWorkspaceRootRef,
      latencyTrackersByRootRef,
      latencyTrackerForRoot,
    });
    return { latencyTrackerForRoot, reporting };
  });
}

describe("clearLatencyMetrics", () => {
  it("clears the current root tracker", () => {
    const { result } = setup();
    result.current.latencyTrackerForRoot("/tmp/project").record("completion", 5);
    expect(result.current.reporting.getLatencySnapshot()).toHaveLength(1);
    result.current.reporting.clearLatencyMetrics();
    expect(result.current.reporting.getLatencySnapshot()).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/application/workbenchController/useWorkbenchLatencyTracking.test.ts`
Expected: FAIL (`clearLatencyMetrics` missing).

- [ ] **Step 3: Implement**

In `useWorkbenchLatencyReporting` add:

```ts
const clearLatencyMetrics = useCallback(() => {
  const requestedRoot = currentWorkspaceRootRef.current;

  if (!requestedRoot) {
    return;
  }

  const rootKey = normalizedWorkspaceRootKey(requestedRoot);
  latencyTrackersByRootRef.current[rootKey]?.clear();
}, [currentWorkspaceRootRef, latencyTrackersByRootRef]);
```

Return it alongside `getLatencySnapshot`. In `useWorkbenchController.ts`, find where `getLatencySnapshot` lands in the returned object (grep `getLatencySnapshot` in the file); expose `clearLatencyMetrics` next to it in the same way.

- [ ] **Step 4: Run tests and typecheck**

Run: `npx vitest run src/application/workbenchController/useWorkbenchLatencyTracking.test.ts` - PASS.
Run: `npm run check` - PASS.

---

### Task 6: Perf scenario bridge (`window.__codevoPerf`)

**Files:**
- Create: `src/components/perfScenarioBridge.ts`
- Create: `src/components/perfScenarioBridge.test.ts`
- Modify: `src/App.tsx` (install effect, mirroring the QA-bridge install effect in `src/components/EditorSurface.tsx:1276-1328`)

**Interfaces:**
- Consumes: `getLatencySnapshot`/`clearLatencyMetrics` from Task 5 via controller; `monaco-editor` global model/editor enumeration (`monaco.editor.getModels()`, `monaco.editor.getEditors()`); controller `activateDocument(path)` from `useWorkbenchDocumentTabs` (already available in `App.tsx` through the controller return - grep `activateDocument` in `App.tsx` for the exact accessor).
- Produces:

```ts
export interface PerfScenarioBridge {
  getLatencySnapshot(): { kind: string; stats: { count: number; last: number; min: number; max: number; median: number; p95: number } }[];
  clearLatencyMetrics(): void;
  typeTextInActiveEditor(text: string): Promise<number[]>;
  measureTabSwitches(paths: string[]): Promise<number[]>;
  runEditorAction(actionId: string): Promise<boolean>;
  runQuickOpenQuery(query: string): Promise<boolean>;
  getRetainedCounts(): { models: number; editors: number };
  getMemorySample(): { usedJsHeapBytes: number | null };
}

export function perfScenarioBridgeEnabled(
  environment?: { DEV?: boolean; VITE_CODEVO_PERF_BRIDGE?: string },
  storage?: Pick<Storage, "getItem"> | null,
): boolean;

export interface PerfScenarioBridgeDependencies {
  readonly getLatencySnapshot: () => LatencySnapshotEntry[];
  readonly clearLatencyMetrics: () => void;
  readonly activateDocument: (path: string) => void;
  readonly getActiveEditor: () => import("monaco-editor").editor.ICodeEditor | null;
  readonly scheduleFrame?: (callback: () => void) => void;
  readonly now?: () => number;
}

export function installPerfScenarioBridge(dependencies: PerfScenarioBridgeDependencies): () => void;
```

Behavior contract:
- `typeTextInActiveEditor` types one character at a time via `editor.trigger("perf", "type", { text: char })`, awaits one `scheduleFrame` tick after each character, and returns the per-character edit-to-frame durations in ms. Guard: returns `[]` when there is no active editor. Cap: at most 2000 characters per call; excess input is ignored.
- `measureTabSwitches` iterates paths, calls `activateDocument(path)`, awaits two `scheduleFrame` ticks, records the duration per switch, returns the array. Cap: at most 200 paths per call.
- `runEditorAction` resolves `getActiveEditor()?.getAction(actionId)`; when absent returns `false`; otherwise `await action.run()` and returns `true`.
- `getRetainedCounts` returns `monaco.editor.getModels().length` and `monaco.editor.getEditors().length`.
- `getMemorySample` returns `(performance as { memory?: { usedJSHeapSize?: number } }).memory?.usedJSHeapSize ?? null`.
- `installPerfScenarioBridge` assigns `window.__codevoPerf`, returns a disposer deleting it. `scheduleFrame` defaults to `requestAnimationFrame`, `now` defaults to `() => performance.now()`; both injectable for tests.
- `perfScenarioBridgeEnabled` mirrors `editorQaBridgeEnabled` (`src/components/editorQaBridge.ts:115-138`) with env key `VITE_CODEVO_PERF_BRIDGE` and storage key `codevo.perfBridge`.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it, vi } from "vitest";
import {
  installPerfScenarioBridge,
  perfScenarioBridgeEnabled,
} from "./perfScenarioBridge";

function immediateFrame(callback: () => void) {
  callback();
}

describe("perfScenarioBridgeEnabled", () => {
  it("is disabled outside DEV", () => {
    expect(perfScenarioBridgeEnabled({ DEV: false, VITE_CODEVO_PERF_BRIDGE: "1" }, null)).toBe(false);
  });

  it("is enabled with DEV and the env flag", () => {
    expect(perfScenarioBridgeEnabled({ DEV: true, VITE_CODEVO_PERF_BRIDGE: "1" }, null)).toBe(true);
  });

  it("supports the DEV localStorage fallback", () => {
    const storage = { getItem: (key: string) => (key === "codevo.perfBridge" ? "1" : null) };
    expect(perfScenarioBridgeEnabled({ DEV: true }, storage)).toBe(true);
  });
});

describe("installPerfScenarioBridge", () => {
  it("installs and disposes the global", () => {
    const dispose = installPerfScenarioBridge({
      getLatencySnapshot: () => [],
      clearLatencyMetrics: () => {},
      activateDocument: () => {},
      getActiveEditor: () => null,
      scheduleFrame: immediateFrame,
      now: () => 0,
    });
    expect(window.__codevoPerf).toBeDefined();
    dispose();
    expect(window.__codevoPerf).toBeUndefined();
  });

  it("measures tab switches per path", async () => {
    let tick = 0;
    const activateDocument = vi.fn();
    const dispose = installPerfScenarioBridge({
      getLatencySnapshot: () => [],
      clearLatencyMetrics: () => {},
      activateDocument,
      getActiveEditor: () => null,
      scheduleFrame: immediateFrame,
      now: () => {
        tick += 5;
        return tick;
      },
    });
    const durations = await window.__codevoPerf!.measureTabSwitches(["/a.ts", "/b.ts"]);
    expect(activateDocument).toHaveBeenCalledTimes(2);
    expect(durations).toHaveLength(2);
    expect(durations.every((value) => value >= 0)).toBe(true);
    dispose();
  });

  it("returns [] from typeTextInActiveEditor without an active editor", async () => {
    const dispose = installPerfScenarioBridge({
      getLatencySnapshot: () => [],
      clearLatencyMetrics: () => {},
      activateDocument: () => {},
      getActiveEditor: () => null,
      scheduleFrame: immediateFrame,
      now: () => 0,
    });
    await expect(window.__codevoPerf!.typeTextInActiveEditor("abc")).resolves.toEqual([]);
    dispose();
  });
});
```

Add the `Window` augmentation in the module:

```ts
declare global {
  interface Window {
    __codevoPerf?: PerfScenarioBridge;
  }
}
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/components/perfScenarioBridge.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement the module**

Follow the interfaces block above exactly. `typeTextInActiveEditor` shape:

```ts
async typeTextInActiveEditor(text) {
  const editor = dependencies.getActiveEditor();

  if (!editor) {
    return [];
  }

  const durations: number[] = [];
  const capped = text.slice(0, 2000);

  for (const char of capped) {
    const start = now();
    editor.trigger("perf", "type", { text: char });
    await new Promise<void>((resolve) => scheduleFrame(() => resolve()));
    durations.push(now() - start);
  }

  return durations;
}
```

`getActiveEditor` default wiring happens in App (Step 4); the module itself only consumes the dependency. `getRetainedCounts` imports `* as monaco from "monaco-editor"` the same way `EditorSurface.tsx` imports it (check its import line and copy the exact specifier).

- [ ] **Step 4: Install from `App.tsx`**

Mirror the QA-bridge effect (`EditorSurface.tsx:1276-1328`): in `App()` add a `useEffect` that early-returns unless `perfScenarioBridgeEnabled()`, then calls `installPerfScenarioBridge` with: `getLatencySnapshot` and `clearLatencyMetrics` from the controller (Task 5), `activateDocument` from the controller tabs API (grep `activateDocument` in `App.tsx`/controller return to find the accessor), and `getActiveEditor: () => monaco.editor.getEditors().find((editor) => editor.hasTextFocus()) ?? monaco.editor.getEditors()[0] ?? null`. Return the disposer.

- [ ] **Step 5: Run tests, typecheck, lint, hotspots**

Run: `npx vitest run src/components/perfScenarioBridge.test.ts` - PASS.
Run: `npm run check && npm run lint -- --max-warnings 0 && npm run size:hotspots` - PASS (if the App.tsx hotspot budget trips, extract the effect into `src/components/usePerfScenarioBridgeInstall.ts` and call that hook from App).

---

### Task 7: Perf scenario runner (CDP) and perf smoke

**Files:**
- Create: `scripts/perf/run-perf-scenarios.mjs`
- Create: `scripts/perf/perfScenarios.mjs` (pure scenario definitions + result shaping, unit-testable)
- Create: `scripts/perf/perfScenarios.test.mjs`
- Modify: `package.json` (add `"perf:run": "node ./scripts/perf/run-perf-scenarios.mjs"`, `"perf:smoke": "node ./scripts/perf/run-perf-scenarios.mjs --smoke"`)

**Interfaces:**
- Consumes: `window.__codevoQa` (openWorkspaceRoot/openWorkspaceFile/setCursor/triggerCompletion/triggerDefinition - see `src/components/editorQaBridge.ts:28-46`) and `window.__codevoPerf` (Task 6). CDP driving copied from `scripts/qa-project-scenarios.mjs` (`cdpTargets` line 698, `selectCdpTarget` 730, `CdpClient` 879, `Runtime.evaluate` with `awaitPromise`/`returnByValue` 671-675).
- Produces: `perf/results/codevo-<ISO date>.json` with shape:

```json
{
  "capturedAt": "2026-07-31T10:00:00.000Z",
  "fixtureVersion": "large-files@seed5/20/100, monorepo@50pkg",
  "scenarios": [
    { "id": "typing-large-20k", "unit": "ms", "samples": [4.1, 3.9], "p50": 4.0, "p95": 4.1 },
    { "id": "tab-switch-cycle", "unit": "ms", "samples": [], "p50": 0, "p95": 0 },
    { "id": "completion-large-20k", "unit": "ms", "trackerKind": "completion", "p50": 0, "p95": 0 },
    { "id": "quickopen-monorepo", "unit": "ms", "trackerKind": "quickOpen", "p50": 0, "p95": 0 }
  ]
}
```

- `perfScenarios.mjs` exports: `PERF_SCENARIOS` (array of `{ id, kind: "bridge" | "tracker", run: string }`, where `run` is the name of an in-page step), `percentilesFromSamples(samples): { p50, p95 }`, `shapeRunResult({ capturedAt, bridgeResults, trackerSnapshot }): result JSON`, `inPagePerfRunnerSource(): string` (the `String.raw` in-page function, same pattern as `inPageRunnerSource()` at `qa-project-scenarios.mjs:951`).

Scenario set (the in-page function runs them in order):
1. `openWorkspaceRoot(<fixtures>/large-files)` and wait for bridge readiness (poll `window.__codevoQa && window.__codevoPerf`, same poll pattern as `waitForBridge` at `qa-project-scenarios.mjs:1207`).
2. `typing-large-5k` / `typing-large-20k` / `typing-large-100k`: open the file, `setCursor` to end of a mid-file line, `clearLatencyMetrics()`, `typeTextInActiveEditor("const perfProbe = 1;\n")` repeated 5 times, collect all returned durations as samples.
3. `tab-switch-cycle`: open all five large files once, then `measureTabSwitches` over the five paths repeated 6 times (30 switches).
4. `completion-large-20k` and `definition-large-20k`: `setCursor` inside an identifier, `triggerCompletion()` / `await triggerDefinition()` 10 times with 200 ms waits; read tracker kinds `completion` / `definition` from `getLatencySnapshot()`.
5. `references-large-20k`: `runEditorAction("editor.action.referenceSearch.trigger")` 5 times; read tracker kind `references`.
6. `rename-large-20k`: `runEditorAction("editor.action.rename")` then send `Escape` via `editor.trigger` is not available; instead read tracker kind `rename` only if samples exist and otherwise report the scenario as `"skipped"` with reason - the rename latency records on provider invocation which the rename widget triggers on open.
7. `openWorkspaceRoot(<fixtures>/monorepo)`, wait, `quickopen-monorepo`: the runner drives the real Quick Open via a bridge method `runQuickOpenQuery(query)` (opens Quick Open, sets the query, waits for loading to settle, closes it) for 10 queries (e.g. `file-01`, `moduleA`, `pkg-3`), then reads tracker kind `quickOpen` - `openWorkspaceFile` never records that kind. Plus `memory-sample`: `getRetainedCounts()` + `getMemorySample()` persisted as a scenario entry in the result JSON. Deep-path package numbers must stay within pkg-00..pkg-49.
8. `--smoke` mode runs only `typing-large-5k` (one repetition) and `tab-switch-cycle` (one cycle) and asserts every scenario returned at least one sample - this is the "instrumentation is alive" check.

- [ ] **Step 1: Write failing tests for the pure parts**

```js
import { describe, expect, it } from "vitest";
import { percentilesFromSamples, shapeRunResult, PERF_SCENARIOS } from "./perfScenarios.mjs";

describe("percentilesFromSamples", () => {
  it("computes p50 and p95", () => {
    const samples = Array.from({ length: 100 }, (_, i) => i + 1);
    expect(percentilesFromSamples(samples)).toEqual({ p50: 50.5, p95: 95 });
  });

  it("handles empty input", () => {
    expect(percentilesFromSamples([])).toEqual({ p50: 0, p95: 0 });
  });
});

describe("shapeRunResult", () => {
  it("merges bridge samples and tracker snapshot entries", () => {
    const result = shapeRunResult({
      capturedAt: "2026-07-31T00:00:00.000Z",
      bridgeResults: [{ id: "typing-large-5k", samples: [2, 4] }],
      trackerSnapshot: [{ kind: "completion", stats: { count: 3, last: 9, min: 5, max: 9, median: 7, p95: 9 } }],
    });
    const typing = result.scenarios.find((s) => s.id === "typing-large-5k");
    expect(typing.p95).toBe(4);
    const completion = result.scenarios.find((s) => s.trackerKind === "completion");
    expect(completion.p95).toBe(9);
  });
});

describe("PERF_SCENARIOS", () => {
  it("has unique ids", () => {
    const ids = PERF_SCENARIOS.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run scripts/perf/perfScenarios.test.mjs` - FAIL.

- [ ] **Step 3: Implement `perfScenarios.mjs`, then `run-perf-scenarios.mjs`**

`run-perf-scenarios.mjs` copies the CDP plumbing of `qa-project-scenarios.mjs` (args `--cdp-url`, `--target-url`, env fallbacks `CODEVO_EDITOR_QA_CDP_URL`, `CODEVO_EDITOR_QA_TARGET_URL`), evaluates `(${inPagePerfRunnerSource()})(${JSON.stringify(options)})` with `awaitPromise: true, returnByValue: true`, shapes the result via `shapeRunResult`, writes `perf/results/codevo-<timestamp>.json` (mkdir -p), prints a summary table to stdout, and sets `process.exitCode = 1` when any non-skipped scenario has zero samples.
Prerequisite note printed by the script when connection fails: "Start the app with: npm run debug:qa (QA bridge) and VITE_CODEVO_PERF_BRIDGE=1, plus remote debugging port 9222" - check how the debug build exposes CDP in `docs/DEV_QA.md` and reuse exactly that lane.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run scripts/perf/perfScenarios.test.mjs` - PASS.

- [ ] **Step 5: Manual end-to-end verification**

Run in one terminal: `VITE_CODEVO_PERF_BRIDGE=1 npm run debug:qa`, wait for the app.
Run in another: `npm run perf:fixtures && npm run perf:smoke`.
Expected: smoke passes, one JSON lands in `perf/results/`, summary table prints. Then `npm run perf:run` for the full set against both fixture roots.

---

### Task 8: VS Code baseline harness

**Files:**
- Create: `tools/vscode-baseline/package.json`
- Create: `tools/vscode-baseline/extension.js`
- Create: `tools/vscode-baseline/run.mjs`
- Create: `perf/baselines/README.md` (one paragraph: how the baseline was captured, VS Code version, machine, date)

**Interfaces:**
- Consumes: the same fixtures from `perf/fixtures/`.
- Produces: `perf/baselines/vscode.json` (committed) with the same scenario ids as Task 7 where measurable, each entry `{ id, unit: "ms", samples, p50, p95, method }`, where `method` documents the proxy used (see below).

`tools/vscode-baseline/package.json`:

```json
{
  "name": "codevo-vscode-baseline",
  "version": "0.0.1",
  "private": true,
  "publisher": "codevo",
  "engines": { "vscode": "^1.90.0" },
  "main": "./extension.js",
  "activationEvents": ["onStartupFinished"]
}
```

`extension.js` measurement map (exact VS Code API per scenario):
- `typing-large-*`: open the fixture document (`vscode.window.showTextDocument`), position at a mid-file line end, then per character `await vscode.commands.executeCommand("type", { text: char })`; duration per await. `method: "type-command-await"` (dispatch latency proxy, no render frame access).
- `tab-switch-cycle`: open all five large files, then `await vscode.commands.executeCommand("vscode.open", uri)` per path, duration per await; `method: "vscode.open-await"`.
- `completion-large-20k`: `await vscode.commands.executeCommand("vscode.executeCompletionItemProvider", uri, position)`; 10 repetitions; `method: "executeCompletionItemProvider"`.
- `definition-large-20k`: `vscode.executeDefinitionProvider`; `references-large-20k`: `vscode.executeReferenceProvider`; `rename-large-20k`: `vscode.executeDocumentRenameProvider` with a fresh valid name per repetition.
- `quickopen-monorepo`: `await vscode.workspace.findFiles("**/file-0*.ts", "**/node_modules/**", 200)` 10 times; `method: "findFiles-proxy"` (documented as an enumeration proxy because Quick Open ranking is not scriptable).
- After all scenarios: write JSON to the path in `process.env.CODEVO_BASELINE_OUT`, then `vscode.commands.executeCommand("workbench.action.closeWindow")`.

Percentile math: copy `percentilesFromSamples` inline (plain JS, no imports from the repo).

`run.mjs`: resolves the repo root, asserts fixtures exist (tell the user to run `npm run perf:fixtures` if not), then for each fixture root spawns:

```js
spawnSync("code", [
  "--new-window",
  "--disable-extensions",
  `--extensionDevelopmentPath=${extensionDir}`,
  fixtureRoot,
], { env: { ...process.env, CODEVO_BASELINE_OUT: outPath }, stdio: "inherit" });
```

waits for the out file to appear (poll with timeout 10 minutes), merges the per-root outputs into `perf/baselines/vscode.json` with `capturedAt` and `vscodeVersion` (from `code --version`).

- [ ] **Step 1: Scaffold the three files as specified above**
- [ ] **Step 2: Run the harness**

Run: `node tools/vscode-baseline/run.mjs`
Expected: two VS Code windows open and close; `perf/baselines/vscode.json` exists with all scenario ids and non-empty samples for every scenario except any that fail; failures land as `{ id, error }` entries and the script exits 1 listing them.

- [ ] **Step 3: Sanity-check the numbers**

Completion/definition p95 in a 20k-line file should be tens to low hundreds of ms; `type-command-await` p95 low single-digit ms. If any number is 0 or absurd, the awaited command is resolving before work happens - switch that scenario to a result-bearing API variant and re-run before accepting the baseline.

---

### Task 9: Gap report

**Files:**
- Create: `scripts/perf/gapReport.mjs`
- Create: `scripts/perf/gapReport.test.mjs`
- Create: `scripts/perf/gap-report.mjs` (CLI)
- Create: `docs/PERFORMANCE.md` (initial skeleton with an empty "C7 gap reports" section)
- Modify: `package.json` (add `"perf:report": "node ./scripts/perf/gap-report.mjs"`)

**Interfaces:**
- Consumes: latest `perf/results/codevo-*.json` and `perf/baselines/vscode.json`.
- Produces: `buildGapReport({ codevo, baseline, tolerances }): { rows, failures }` where `rows` = `{ id, codevoP95, vscodeP95, ratio, budget, status: "pass" | "fail" | "no-baseline" | "skipped" }` and a markdown renderer `renderGapReportMarkdown(report): string`. Tolerances (from the spec): interactive ids (`typing-*`, `tab-switch-*`, `quickopen-*`, `completion-*`, `definition-*`) budget 1.25; heavy ids (`references-*`, `rename-*`) budget 1.5.

- [ ] **Step 1: Write the failing test**

```js
import { describe, expect, it } from "vitest";
import { buildGapReport, renderGapReportMarkdown, DEFAULT_TOLERANCES } from "./gapReport.mjs";

const codevo = {
  scenarios: [
    { id: "typing-large-20k", p95: 10 },
    { id: "references-large-20k", p95: 160 },
    { id: "rename-large-20k", p95: 0, skipped: true },
  ],
};
const baseline = {
  scenarios: [
    { id: "typing-large-20k", p95: 8 },
    { id: "references-large-20k", p95: 100 },
  ],
};

describe("buildGapReport", () => {
  it("marks pass and fail against the right budgets", () => {
    const report = buildGapReport({ codevo, baseline, tolerances: DEFAULT_TOLERANCES });
    const typing = report.rows.find((row) => row.id === "typing-large-20k");
    expect(typing.budget).toBe(1.25);
    expect(typing.status).toBe("pass");
    const references = report.rows.find((row) => row.id === "references-large-20k");
    expect(references.budget).toBe(1.5);
    expect(references.status).toBe("fail");
    expect(report.failures).toHaveLength(1);
  });

  it("marks skipped and missing-baseline rows", () => {
    const report = buildGapReport({ codevo, baseline, tolerances: DEFAULT_TOLERANCES });
    expect(report.rows.find((row) => row.id === "rename-large-20k").status).toBe("skipped");
  });
});

describe("renderGapReportMarkdown", () => {
  it("renders one table row per scenario", () => {
    const report = buildGapReport({ codevo, baseline, tolerances: DEFAULT_TOLERANCES });
    const markdown = renderGapReportMarkdown(report);
    expect(markdown).toContain("| typing-large-20k |");
    expect(markdown).toContain("1.25");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run scripts/perf/gapReport.test.mjs` - FAIL.

- [ ] **Step 3: Implement `gapReport.mjs` and the CLI**

`DEFAULT_TOLERANCES = [{ pattern: /^(typing|tab-switch|quickopen|completion|definition)/, budget: 1.25 }, { pattern: /^(references|rename)/, budget: 1.5 }]`. `ratio = vscodeP95 > 0 ? codevoP95 / vscodeP95 : null`; `status = "skipped"` when the codevo scenario is skipped, `"no-baseline"` when the baseline id is missing, `"fail"` when `ratio > budget`, otherwise `"pass"`. The CLI picks the newest `perf/results/codevo-*.json` by filename sort, prints the markdown to stdout, and exits 1 when `failures.length > 0`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run scripts/perf/gapReport.test.mjs` - PASS.

- [ ] **Step 5: Produce the first real gap report**

Run: `npm run perf:report` after Tasks 7 and 8 have produced real files. Paste the markdown table into `docs/PERFORMANCE.md` under "C7 gap reports" with the capture date and fixture version line. This table decides the C7.2+ ordering.

---

### Task 10: Full gates and slice review

**Files:** none new.

- [ ] **Step 1: Run the frontend gate matrix**

Run: `npm run check && npm run lint -- --max-warnings 0 && npm test -- --run && npm run size:hotspots && npm run format:check && npm run format:check:changed && git diff --check`
Expected: all PASS. Fix regressions before proceeding.

- [ ] **Step 2: Read-only adversarial review**

Dispatch a separate read-only subagent to review the full C7.1 diff against the spec (`docs/superpowers/specs/2026-07-31-c7-performance-design.md`) with focus on: dev-only gating actually excludes release builds, no unbounded loops in bridge methods, caps enforced (2000 chars, 200 paths), deterministic fixtures, and no weakening of existing ownership rules. Address actionable findings, rerun affected gates.

- [ ] **Step 3: Real-monorepo feel validation**

Ask the user which real monorepo clone to use (spec: one real public monorepo, cloned locally, never committed). Open it via `npm run debug:qa`, run the typing/tab/Quick Open scenarios manually, and note subjective feel plus any tracker numbers next to the synthetic results in `docs/PERFORMANCE.md`.

- [ ] **Step 4: Report**

Report to the user: gate results, first gap report table, and the proposed C7.2+ ordering derived from it. Leave everything uncommitted.
