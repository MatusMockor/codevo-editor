import { describe, expect, it, vi } from "vitest";
import { phpNetteFrameworkProvider } from "../domain/phpFrameworkProviders";
import { createPhpFrameworkIntelligence } from "./phpFrameworkIntelligence";
import { createPhpFrameworkRuntimeContext } from "./phpFrameworkRuntimeContext";
import { activePhpFrameworkDocumentDiagnosticsProvider } from "./phpFrameworkActiveDocumentDiagnosticsRegistry";

describe("activePhpFrameworkDocumentDiagnosticsProvider", () => {
  it("normalizes workspace paths before resolving Nette Latte template references", async () => {
    const provider = activePhpFrameworkDocumentDiagnosticsProvider({
      collectCompleteLatteTemplateRelativePaths: vi.fn(async () => [
        "app/UI/Home/default.latte",
      ]),
      collectViewTargets: vi.fn(async () => []),
      document: {
        content: "{include 'partials/missing'}",
        language: "latte",
        name: "default.latte",
        path: "C:\\repo\\app\\UI\\Home\\default.latte",
        savedContent: "",
      },
      frameworkRuntime: createPhpFrameworkRuntimeContext(
        createPhpFrameworkIntelligence({
          matchedProviderIds: ["nette"],
          profile: "nette",
          providers: [phpNetteFrameworkProvider],
        }),
      ),
      workspaceRoot: "C:\\repo",
    });

    await expect(provider?.provideDiagnostics()).resolves.toMatchObject([
      {
        code: "nette.missingTemplate",
        data: {
          relativePath: "app/UI/Home/partials/missing.latte",
        },
      },
    ]);
  });
});
