import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("server-ready action workbench composition", () => {
  it("keeps the concrete desktop opener behind the typed controller and orchestration port", () => {
    const composition = source("../workbenchComposition.ts");
    const app = source("../App.tsx");
    const controllerOptions = source("./workbenchDebugControllerOptions.ts");
    const controller = source("./useWorkbenchController.ts");
    const orchestration = source("./useWorkbenchDebugOrchestration.ts");

    expect(composition).toContain(
      'import { TauriServerReadyExternalUrlOpener } from "./infrastructure/tauriServerReadyExternalUrlOpener";',
    );
    expect(composition).toContain(
      "serverReadyExternalUrlOpener: new TauriServerReadyExternalUrlOpener(),",
    );
    expect(app).toContain("serverReadyExternalUrlOpener,");
    expect(controllerOptions).toContain(
      "serverReadyExternalUrlOpener?: DebugServerReadyExternalUrlOpener;",
    );
    expect(controller).toContain(
      "serverReadyExternalUrlOpener: options.serverReadyExternalUrlOpener,",
    );
    expect(orchestration).toContain(
      "serverReadyExternalUrlOpener ?? unavailableServerReadyExternalUrlOpener,",
    );
    expect(app).not.toContain("TauriServerReadyExternalUrlOpener");
    expect(controller).not.toContain("TauriServerReadyExternalUrlOpener");
  });
});

function source(relativePath: string): string {
  return readFileSync(new URL(relativePath, import.meta.url), "utf8");
}
