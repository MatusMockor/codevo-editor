import { describe, expect, it, vi } from "vitest";
import {
  detectJsTestRunner,
  detectJsTestRunnerContext,
} from "./jsTestRunnerDetection";

const ROOT = "/workspace";

function readerFor(files: Record<string, string>) {
  return vi.fn(async (path: string) => files[path] ?? null);
}

describe("detectJsTestRunner", () => {
  it("detects vitest from a vitest config file", async () => {
    const runner = await detectJsTestRunner(
      ROOT,
      readerFor({ [`${ROOT}/vitest.config.ts`]: "export default {};" }),
    );

    expect(runner).toBe("vitest");
  });

  it("detects vitest from a vite config plus a vitest dependency", async () => {
    const runner = await detectJsTestRunner(
      ROOT,
      readerFor({
        [`${ROOT}/package.json`]: JSON.stringify({
          devDependencies: { vitest: "^3.0.0" },
        }),
        [`${ROOT}/vite.config.ts`]: "export default {};",
      }),
    );

    expect(runner).toBe("vitest");
  });

  it("does not detect vitest from a vite config without the vitest dependency", async () => {
    const runner = await detectJsTestRunner(
      ROOT,
      readerFor({
        [`${ROOT}/package.json`]: JSON.stringify({ devDependencies: {} }),
        [`${ROOT}/vite.config.ts`]: "export default {};",
      }),
    );

    expect(runner).toBeNull();
  });

  it("detects jest from a jest config file", async () => {
    const runner = await detectJsTestRunner(
      ROOT,
      readerFor({ [`${ROOT}/jest.config.js`]: "module.exports = {};" }),
    );

    expect(runner).toBe("jest");
  });

  it("detects jest from a package.json jest section", async () => {
    const runner = await detectJsTestRunner(
      ROOT,
      readerFor({
        [`${ROOT}/package.json`]: JSON.stringify({ jest: {} }),
      }),
    );

    expect(runner).toBe("jest");
  });

  it("detects jest from a jest dependency", async () => {
    const runner = await detectJsTestRunner(
      ROOT,
      readerFor({
        [`${ROOT}/package.json`]: JSON.stringify({
          dependencies: { jest: "^29.0.0" },
        }),
      }),
    );

    expect(runner).toBe("jest");
  });

  it("prefers vitest when both runners are configured", async () => {
    const runner = await detectJsTestRunner(
      ROOT,
      readerFor({
        [`${ROOT}/jest.config.js`]: "module.exports = {};",
        [`${ROOT}/vitest.config.mts`]: "export default {};",
      }),
    );

    expect(runner).toBe("vitest");
  });

  it("returns null when nothing indicates a runner", async () => {
    const runner = await detectJsTestRunner(
      ROOT,
      readerFor({ [`${ROOT}/package.json`]: JSON.stringify({}) }),
    );

    expect(runner).toBeNull();
  });

  it("returns null when package.json is malformed", async () => {
    const runner = await detectJsTestRunner(
      ROOT,
      readerFor({ [`${ROOT}/package.json`]: "{ not json" }),
    );

    expect(runner).toBeNull();
  });

  it("selects the nearest configured sibling package for an active test", async () => {
    const runner = await detectJsTestRunnerContext(
      ROOT,
      readerFor({
        [`${ROOT}/packages/a/vitest.config.ts`]: "export default {};",
        [`${ROOT}/packages/b/jest.config.js`]: "module.exports = {};",
      }),
      `${ROOT}/packages/a/src/example.test.ts`,
    );

    expect(runner).toEqual({
      executablePath: null,
      rootPath: `${ROOT}/packages/a`,
      runner: "vitest",
      targetRelativePath: "src/example.test.ts",
    });
  });

  it("prefers a nested package and preserves the root fallback", async () => {
    const files = readerFor({
      [`${ROOT}/jest.config.js`]: "module.exports = {};",
      [`${ROOT}/packages/a/nested/vitest.config.ts`]: "export default {};",
    });

    await expect(
      detectJsTestRunnerContext(
        ROOT,
        files,
        `${ROOT}/packages/a/nested/src/example.test.ts`,
      ),
    ).resolves.toMatchObject({
      rootPath: `${ROOT}/packages/a/nested`,
      runner: "vitest",
    });
    await expect(
      detectJsTestRunnerContext(ROOT, files, `${ROOT}/other/example.test.ts`),
    ).resolves.toMatchObject({ rootPath: ROOT, runner: "jest" });
  });

  it("does not use a stale path from another workspace", async () => {
    const runner = await detectJsTestRunnerContext(
      ROOT,
      readerFor({
        [`${ROOT}/vitest.config.ts`]: "export default {};",
        "/old/packages/a/jest.config.js": "module.exports = {};",
      }),
      "/old/packages/a/src/example.test.ts",
    );

    expect(runner).toMatchObject({ rootPath: ROOT, runner: "vitest" });
  });

  it("uses the nearest local or hoisted runner binary without visiting a sibling", async () => {
    const runner = await detectJsTestRunnerContext(
      ROOT,
      readerFor({
        [`${ROOT}/packages/a/vitest.config.ts`]: "export default {};",
        [`${ROOT}/packages/b/node_modules/.bin/vitest`]: "#!/bin/sh",
        [`${ROOT}/node_modules/.bin/vitest`]: "#!/bin/sh",
      }),
      `${ROOT}/packages/a/src/example.test.ts`,
    );

    expect(runner).toMatchObject({
      executablePath: "../../node_modules/.bin/vitest",
      rootPath: `${ROOT}/packages/a`,
    });
  });

  it("uses a package-local binary when the runner config is at workspace root", async () => {
    const runner = await detectJsTestRunnerContext(
      ROOT,
      readerFor({
        [`${ROOT}/vitest.config.ts`]: "export default {};",
        [`${ROOT}/packages/a/package.json`]: "{}",
        [`${ROOT}/packages/a/node_modules/.bin/vitest`]: "#!/bin/sh",
      }),
      `${ROOT}/packages/a/src/example.test.ts`,
    );

    expect(runner).toEqual({
      executablePath: "packages/a/node_modules/.bin/vitest",
      rootPath: ROOT,
      runner: "vitest",
      targetRelativePath: "packages/a/src/example.test.ts",
    });
  });

  it("ignores a sibling binary and falls back from the active package to root", async () => {
    const runner = await detectJsTestRunnerContext(
      ROOT,
      readerFor({
        [`${ROOT}/vitest.config.ts`]: "export default {};",
        [`${ROOT}/packages/a/package.json`]: "{}",
        [`${ROOT}/packages/b/node_modules/.bin/vitest`]: "#!/bin/sh",
        [`${ROOT}/node_modules/.bin/vitest`]: "#!/bin/sh",
      }),
      `${ROOT}/packages/a/src/example.test.ts`,
    );

    expect(runner).toMatchObject({
      executablePath: "node_modules/.bin/vitest",
      rootPath: ROOT,
    });
  });
});
