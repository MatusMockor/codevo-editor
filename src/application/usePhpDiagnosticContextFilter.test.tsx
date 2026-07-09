// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import type { LanguageServerDiagnostic } from "../domain/languageServerDiagnostics";
import { phpLaravelFrameworkProvider } from "../domain/phpFrameworkProviders";
import { createPhpFrameworkIntelligence } from "./phpFrameworkIntelligence";
import { createPhpFrameworkRuntimeContext } from "./phpFrameworkRuntimeContext";
import {
  usePhpDiagnosticContextFilter,
  type PhpContextualDiagnosticsFilter,
  type PhpDiagnosticContextFilterDependencies,
} from "./usePhpDiagnosticContextFilter";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const ROOT = "/workspace";
const PHP_PATH = `${ROOT}/app/Http/Controllers/AlbumController.php`;
const LARAVEL_RUNTIME = createPhpFrameworkRuntimeContext(
  createPhpFrameworkIntelligence({
    matchedProviderIds: ["laravel"],
    profile: "laravel",
    providers: [phpLaravelFrameworkProvider],
  }),
);
const GENERIC_RUNTIME = createPhpFrameworkRuntimeContext(
  createPhpFrameworkIntelligence({
    matchedProviderIds: [],
    profile: "generic",
    providers: [],
  }),
);

function makeDeps(
  source: string,
  overrides: Partial<PhpDiagnosticContextFilterDependencies> = {},
): PhpDiagnosticContextFilterDependencies {
  return {
    activePhpFrameworkProviders: [],
    contextualDiagnosticsFilterRef: {
      current: async (_path, diagnostics) => diagnostics,
    },
    currentPhpFrameworkSourceContext: () => ({ workspaceSources: [] }),
    currentWorkspaceRoot: () => ROOT,
    ensurePhpFrameworkSourceCollectionsLoaded: vi.fn(async () => undefined),
    frameworkRuntime: LARAVEL_RUNTIME,
    isPhpPath: vi.fn((path: string) => path.endsWith(".php")),
    phpClassHasLaravelDynamicWhere: vi.fn(
      async (_className: string, methodName: string) =>
        methodName === "whereEmail",
    ),
    phpClassHasLaravelLocalScope: vi.fn(
      async (_className: string, methodName: string) =>
        methodName === "published",
    ),
    phpClassHierarchyHasMethod: vi.fn(async () => false),
    phpClassHierarchyHasProperty: vi.fn(async () => false),
    phpClassHierarchyHasStaticMethod: vi.fn(async () => false),
    phpTraitHostConstantExists: vi.fn(async () => false),
    phpTraitHostMethodExists: vi.fn(async () => false),
    phpTraitHostPropertyExists: vi.fn(async () => false),
    phpTraitHostPropertyMethodExists: vi.fn(async () => false),
    readNavigationFileContent: vi.fn(async () => source),
    resolvePhpClassReference: vi.fn((_source, className) => className),
    resolvePhpEloquentBuilderModelType: vi.fn(
      async () => "App\\Models\\Album",
    ),
    resolvePhpExpressionType: vi.fn(async () => null),
    ...overrides,
  };
}

function renderHook(deps: PhpDiagnosticContextFilterDependencies) {
  const container = document.createElement("div");
  const root = createRoot(container);
  const captured: { api: PhpContextualDiagnosticsFilter | null } = {
    api: null,
  };

  function Harness({
    dependencies,
  }: {
    dependencies: PhpDiagnosticContextFilterDependencies;
  }) {
    captured.api = usePhpDiagnosticContextFilter(dependencies);
    return null;
  }

  act(() => {
    root.render(<Harness dependencies={deps} />);
  });

  const api = (): PhpContextualDiagnosticsFilter => {
    if (!captured.api) {
      throw new Error("hook not mounted");
    }

    return captured.api;
  };

  return {
    api,
    unmount: () => {
      act(() => {
        root.unmount();
      });
    },
  };
}

function diagnosticAt(
  source: string,
  needle: string,
  overrides: Partial<LanguageServerDiagnostic>,
): LanguageServerDiagnostic {
  const offset = source.indexOf(needle);

  if (offset < 0) {
    throw new Error(`Missing test diagnostic needle: ${needle}`);
  }

  const before = source.slice(0, offset);
  const lines = before.split("\n");

  return {
    character: (lines[lines.length - 1] ?? "").length,
    line: lines.length - 1,
    message: "Unknown method",
    severity: "error",
    source: "phpactor",
    ...overrides,
  };
}

describe("usePhpDiagnosticContextFilter", () => {
  it("drops Laravel local-scope and dynamic-where diagnostics only with the provider active", async () => {
    const source = `<?php
namespace App\\Http\\Controllers;

use App\\Models\\Album;

class AlbumController
{
    public function index(): void
    {
        $query = Album::query();
        $query->published()->first();
        $query->whereEmail()->first();
    }
}
`;
    const localScopeDiagnostic = diagnosticAt(source, "published", {
      message:
        "Method Illuminate\\Database\\Eloquent\\Builder::published() does not exist",
    });
    const dynamicWhereDiagnostic = diagnosticAt(source, "whereEmail", {
      message:
        "Method Illuminate\\Database\\Eloquent\\Builder::whereEmail() does not exist",
    });
    const diagnostics = [localScopeDiagnostic, dynamicWhereDiagnostic];
    const laravelDeps = makeDeps(source);
    const laravelHarness = renderHook(laravelDeps);

    await expect(laravelHarness.api()(PHP_PATH, diagnostics)).resolves.toEqual(
      [],
    );
    expect(laravelDeps.resolvePhpEloquentBuilderModelType).toHaveBeenCalled();
    expect(laravelDeps.phpClassHasLaravelLocalScope).toHaveBeenCalledWith(
      "App\\Models\\Album",
      "published",
    );
    expect(laravelDeps.phpClassHasLaravelDynamicWhere).toHaveBeenCalledWith(
      "App\\Models\\Album",
      "whereEmail",
    );
    laravelHarness.unmount();

    const genericDeps = makeDeps(source, {
      frameworkRuntime: GENERIC_RUNTIME,
    });
    const genericHarness = renderHook(genericDeps);

    await expect(genericHarness.api()(PHP_PATH, diagnostics)).resolves.toEqual(
      diagnostics,
    );
    expect(
      genericDeps.resolvePhpEloquentBuilderModelType,
    ).not.toHaveBeenCalled();
    expect(genericDeps.phpClassHasLaravelLocalScope).not.toHaveBeenCalled();
    expect(genericDeps.phpClassHasLaravelDynamicWhere).not.toHaveBeenCalled();
    genericHarness.unmount();
  });
});
