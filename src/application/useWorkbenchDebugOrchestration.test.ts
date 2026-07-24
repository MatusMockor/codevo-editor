import { describe, expect, it, vi } from "vitest";
import type { DebugLaunchTarget } from "../domain/debug";
import { startWorkbenchDocumentDebug } from "./useWorkbenchDebugOrchestration";

const ROOT = "/workspace";

function harness(
  path: string,
  overrides: Partial<Parameters<typeof startWorkbenchDocumentDebug>[0]> = {},
) {
  const openDebugPanel = vi.fn();
  const startDebug = vi.fn(async (_launch: DebugLaunchTarget) => undefined);
  return {
    openDebugPanel,
    options: {
      activeDocumentPath: () => path,
      currentWorkspaceRoot: () => ROOT,
      document: { path },
      isJsTest: false,
      isPhpTest: false,
      openDebugPanel,
      readTestFileIfExists: async () => null,
      reportWarning: vi.fn(),
      requestedRoot: ROOT,
      startDebug,
      ...overrides,
    },
    startDebug,
  };
}

describe("startWorkbenchDocumentDebug", () => {
  it("routes PHP tests and scripts to their exact launch contracts", async () => {
    const phpTest = harness(`${ROOT}/tests/Feature/UserTest.php`, { isPhpTest: true });
    await startWorkbenchDocumentDebug(phpTest.options);
    expect(phpTest.startDebug).toHaveBeenCalledWith({
      kind: "php-test-file",
      filePath: `${ROOT}/tests/Feature/UserTest.php`,
    });

    const phpScript = harness(`${ROOT}/bin/worker.php`);
    await startWorkbenchDocumentDebug(phpScript.options);
    expect(phpScript.startDebug).toHaveBeenCalledWith({
      kind: "php-script",
      scriptPath: `${ROOT}/bin/worker.php`,
    });
    expect(phpTest.openDebugPanel).toHaveBeenCalledOnce();
    expect(phpScript.openDebugPanel).toHaveBeenCalledOnce();
  });

  it("launches supported Node scripts and ignores unsupported documents", async () => {
    const nodeScript = harness(`${ROOT}/src/server.ts`);
    await startWorkbenchDocumentDebug(nodeScript.options);
    expect(nodeScript.startDebug).toHaveBeenCalledWith({
      kind: "node-script",
      scriptPath: `${ROOT}/src/server.ts`,
    });

    const unsupported = harness(`${ROOT}/README.md`);
    await startWorkbenchDocumentDebug(unsupported.options);
    expect(unsupported.openDebugPanel).not.toHaveBeenCalled();
    expect(unsupported.startDebug).not.toHaveBeenCalled();
  });

  it("drops stale JavaScript test discovery without opening the debug panel", async () => {
    const path = `${ROOT}/src/server.test.ts`;
    const stale = harness(path, {
      activeDocumentPath: () => `${ROOT}/src/other.test.ts`,
      isJsTest: true,
    });
    await startWorkbenchDocumentDebug(stale.options);
    expect(stale.openDebugPanel).not.toHaveBeenCalled();
    expect(stale.startDebug).not.toHaveBeenCalled();
  });
});
