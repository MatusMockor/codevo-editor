import { phpNetteFrameworkProvider } from "../domain/phpFrameworkNetteProvider";
import { describe, expect, it, vi } from "vitest";
import { type PhpFrameworkProvider } from "../domain/phpFrameworkProviders";
import { createPhpFrameworkIntelligence } from "./phpFrameworkIntelligence";
import { createPhpFrameworkRuntimeContext } from "./phpFrameworkRuntimeContext";
import {
  composePhpFrameworkActiveDocumentDiagnosticsContributions,
  type PhpFrameworkActiveDocumentDiagnosticsCompositionDependencies,
} from "./phpFrameworkActiveDocumentDiagnosticsComposition";
import { activePhpFrameworkDocumentDiagnosticsProvider } from "./phpFrameworkActiveDocumentDiagnosticsRegistry";
import type { PhpFrameworkActiveDocumentDiagnosticsContribution } from "./phpFrameworkActiveDocumentDiagnosticsContributions";

function diagnosticsContributions(
  overrides: Partial<PhpFrameworkActiveDocumentDiagnosticsCompositionDependencies> = {},
) {
  return composePhpFrameworkActiveDocumentDiagnosticsContributions({
    collectCompleteLatteTemplateRelativePaths: vi.fn(async () => []),
    collectViewTargets: vi.fn(async () => []),
    provideLattePresenterLinkDiagnostics: vi.fn(async () => []),
    ...overrides,
  });
}

describe("activePhpFrameworkDocumentDiagnosticsProvider", () => {
  it("runs provider-owned descriptors from the active runtime", async () => {
    const descriptorProvider: PhpFrameworkProvider = {
      id: "custom-blade",
      activeDocumentDiagnostics: [
        {
          kind: "bladeViewReferences",
          language: "blade",
        },
      ],
    };
    const collectViewTargets = vi.fn(async () => [
      {
        name: "dashboard",
        path: "/repo/resources/views/dashboard.blade.php",
        relativePath: "resources/views/dashboard.blade.php",
      },
    ]);
    const provider = activePhpFrameworkDocumentDiagnosticsProvider({
      contributions: diagnosticsContributions({ collectViewTargets }),
      document: {
        content: "@include('partials.missing')",
        language: "blade",
        name: "show.blade.php",
        path: "/repo/resources/views/show.blade.php",
        savedContent: "",
      },
      frameworkRuntime: createPhpFrameworkRuntimeContext(
        createPhpFrameworkIntelligence({
          matchedProviderIds: ["custom-blade"],
          profile: "generic",
          providers: [descriptorProvider],
        }),
      ),
      workspaceRoot: "/repo",
    });

    await expect(provider?.provideDiagnostics()).resolves.toMatchObject([
      {
        code: "laravel.missingView",
      },
    ]);
    expect(collectViewTargets).toHaveBeenCalledTimes(1);
  });

  it("filters active-document descriptors by document language", () => {
    const descriptorProvider: PhpFrameworkProvider = {
      id: "custom-blade",
      activeDocumentDiagnostics: [
        {
          kind: "bladeViewReferences",
          language: "blade",
        },
      ],
    };
    const provider = activePhpFrameworkDocumentDiagnosticsProvider({
      contributions: diagnosticsContributions(),
      document: {
        content: "<?php\n",
        language: "php",
        name: "index.php",
        path: "/repo/index.php",
        savedContent: "",
      },
      frameworkRuntime: createPhpFrameworkRuntimeContext(
        createPhpFrameworkIntelligence({
          matchedProviderIds: ["custom-blade"],
          profile: "generic",
          providers: [descriptorProvider],
        }),
      ),
      workspaceRoot: "/repo",
    });

    expect(provider).toBeNull();
  });

  it("normalizes workspace paths before resolving Nette Latte template references", async () => {
    const provider = activePhpFrameworkDocumentDiagnosticsProvider({
      contributions: diagnosticsContributions({
        collectCompleteLatteTemplateRelativePaths: vi.fn(async () => [
          "app/UI/Home/default.latte",
        ]),
      }),
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
    const provideLattePresenterLinkDiagnostics = vi.fn(
      async () => presenterLinkDiagnostics,
    );
    const provider = activePhpFrameworkDocumentDiagnosticsProvider({
      contributions: diagnosticsContributions({
        collectCompleteLatteTemplateRelativePaths: vi.fn(async () => [
          "app/UI/Home/default.latte",
        ]),
        provideLattePresenterLinkDiagnostics,
      }),
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

  it("preserves descriptor ordering and deduplicates repeated contributions", async () => {
    const descriptorProvider: PhpFrameworkProvider = {
      id: "ordered-latte",
      activeDocumentDiagnostics: [
        { kind: "lattePresenterLinks", language: "latte" },
        { kind: "latteTemplateReferences", language: "latte" },
        { kind: "lattePresenterLinks", language: "latte" },
      ],
    };
    const calls: string[] = [];
    const contribution = (
      id: string,
    ): PhpFrameworkActiveDocumentDiagnosticsContribution => ({
      id,
      supports: (descriptor) => descriptor.kind === id,
      provideDiagnostics: async () => {
        calls.push(id);
        return [];
      },
    });
    const provider = activePhpFrameworkDocumentDiagnosticsProvider({
      contributions: [
        contribution("latteTemplateReferences"),
        contribution("lattePresenterLinks"),
      ],
      document: {
        content: "{link Product:show}",
        language: "latte",
        name: "default.latte",
        path: "/repo/app/UI/Home/default.latte",
        savedContent: "",
      },
      frameworkRuntime: createPhpFrameworkRuntimeContext(
        createPhpFrameworkIntelligence({
          matchedProviderIds: ["ordered-latte"],
          profile: "generic",
          providers: [descriptorProvider],
        }),
      ),
      workspaceRoot: "/repo",
    });

    await provider?.provideDiagnostics();

    expect(calls).toEqual(["lattePresenterLinks", "latteTemplateReferences"]);
  });

  it("uses the highest-priority matching contribution", async () => {
    const descriptorProvider: PhpFrameworkProvider = {
      id: "priority-blade",
      activeDocumentDiagnostics: [
        { kind: "bladeViewReferences", language: "blade" },
      ],
    };
    const provideLowPriority = vi.fn(async () => []);
    const provideHighPriority = vi.fn(async () => []);
    const contribution = (
      id: string,
      priority: number,
      provideDiagnostics: PhpFrameworkActiveDocumentDiagnosticsContribution["provideDiagnostics"],
    ): PhpFrameworkActiveDocumentDiagnosticsContribution => ({
      id,
      priority,
      supports: (descriptor) => descriptor.kind === "bladeViewReferences",
      provideDiagnostics,
    });
    const provider = activePhpFrameworkDocumentDiagnosticsProvider({
      contributions: [
        contribution("low", 1, provideLowPriority),
        contribution("high", 10, provideHighPriority),
      ],
      document: {
        content: "@include('dashboard')",
        language: "blade",
        name: "show.blade.php",
        path: "/repo/resources/views/show.blade.php",
        savedContent: "",
      },
      frameworkRuntime: createPhpFrameworkRuntimeContext(
        createPhpFrameworkIntelligence({
          matchedProviderIds: ["priority-blade"],
          profile: "generic",
          providers: [descriptorProvider],
        }),
      ),
      workspaceRoot: "/repo",
    });

    await provider?.provideDiagnostics();

    expect(provideHighPriority).toHaveBeenCalledTimes(1);
    expect(provideLowPriority).not.toHaveBeenCalled();
  });
});
