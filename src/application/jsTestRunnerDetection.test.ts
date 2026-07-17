import { describe, expect, it, vi } from "vitest";
import { detectJsTestRunner } from "./jsTestRunnerDetection";

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
});
