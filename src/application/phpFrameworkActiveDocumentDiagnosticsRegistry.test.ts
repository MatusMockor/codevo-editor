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
      provideLattePresenterLinkDiagnostics: vi.fn(async () => []),
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

  it("combines Nette Latte template and presenter link diagnostics", async () => {
    const presenterLinkDiagnostics = [
      {
        character: 6,
        code: "nette.missingPresenterMethod",
        endCharacter: 18,
        endLine: 1,
        line: 1,
        message: "Missing presenter method",
        severity: "warning" as const,
        source: "Nette",
      },
    ];
    const provideLattePresenterLinkDiagnostics = vi.fn(async () =>
      presenterLinkDiagnostics,
    );
    const provider = activePhpFrameworkDocumentDiagnosticsProvider({
      collectCompleteLatteTemplateRelativePaths: vi.fn(async () => [
        "app/UI/Home/default.latte",
      ]),
      collectViewTargets: vi.fn(async () => []),
      document: {
        content: "{include 'partials/missing'}\n{link Product:show}",
        language: "latte",
        name: "default.latte",
        path: "/repo/app/UI/Home/default.latte",
        savedContent: "",
      },
      frameworkRuntime: createPhpFrameworkRuntimeContext(
        createPhpFrameworkIntelligence({
          matchedProviderIds: ["nette"],
          profile: "nette",
          providers: [phpNetteFrameworkProvider],
        }),
      ),
      provideLattePresenterLinkDiagnostics,
      workspaceRoot: "/repo",
    });

    await expect(provider?.provideDiagnostics()).resolves.toMatchObject([
      {
        code: "nette.missingTemplate",
      },
      {
        code: "nette.missingPresenterMethod",
      },
    ]);
    expect(provideLattePresenterLinkDiagnostics).toHaveBeenCalledWith(
      "{include 'partials/missing'}\n{link Product:show}",
      "app/UI/Home/default.latte",
    );
  });
});
