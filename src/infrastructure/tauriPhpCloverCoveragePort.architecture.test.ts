import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("PHP Clover coverage IPC architecture", () => {
  it("keeps the application port runner-neutral and the Tauri adapter parser-free", () => {
    const application = readFileSync(
      new URL("../application/usePhpCloverCoverage.ts", import.meta.url),
      "utf8",
    );
    const adapter = readFileSync(
      new URL("./tauriPhpCloverCoveragePort.ts", import.meta.url),
      "utf8",
    );
    const contract = readFileSync(
      new URL("./tauriPhpCloverCoverageIpcContract.ts", import.meta.url),
      "utf8",
    );

    expect(application).toContain("export interface PhpCloverCoveragePort");
    expect(application).not.toContain("@tauri-apps/api");
    expect(adapter).toContain("implements PhpCloverCoveragePort");
    expect(adapter).toContain("workspaceId: owner.ownerKey");
    expect(adapter).toContain("rootPath: owner.executionRoot");
    expect(contract).toContain('"run_php_test_coverage_clover"');
    expect(`${adapter}\n${contract}`).not.toContain("parsePhpCloverCoverage");
    expect(`${adapter}\n${contract}`).not.toMatch(/child_process|Terminal|shell/);
  });
});
