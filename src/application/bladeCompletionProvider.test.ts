import { describe, expect, it, vi } from "vitest";
import { phpLaravelFrameworkProvider } from "../domain/phpFrameworkProviders";
import type { PhpLaravelViewVariable } from "../domain/phpLaravelViewData";
import type { PhpMethodCompletion } from "../domain/phpMethodCompletions";
import { provideBladeCompletions } from "./bladeCompletionProvider";
import type { BladeCompletionProviderDependencies } from "./bladeCompletionProvider";
import { createPhpFrameworkIntelligence } from "./phpFrameworkIntelligence";
import { createPhpFrameworkRuntimeContext } from "./phpFrameworkRuntimeContext";

const ROOT = "/workspace";
const BLADE_PATH = `${ROOT}/resources/views/invoices/show.blade.php`;
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
  overrides: Partial<BladeCompletionProviderDependencies> = {},
): BladeCompletionProviderDependencies {
  return {
    activeDocument: {
      content: "",
      path: BLADE_PATH,
    },
    collectBladeComponentNames: vi.fn(async () => ["alert", "forms.input"]),
    collectBladeForeachLoopVariables: vi.fn(async () => []),
    collectBladeViewVariablesWithDisplayTypes: vi.fn(async () => []),
    collectPhpLaravelConfigTargets: vi.fn(async () => []),
    collectPhpLaravelNamedRouteTargets: vi.fn(async () => []),
    collectPhpLaravelTranslationTargets: vi.fn(async () => []),
    collectPhpLaravelViewTargets: vi.fn(async () => []),
    currentWorkspaceRootRef: { current: ROOT },
    ensurePhpFrameworkSourceCollectionsLoaded: vi.fn(async () => undefined),
    frameworkRuntime: LARAVEL_RUNTIME,
    relativeWorkspacePath: (root, path) => path.slice(root.length + 1),
    resolveBladeForeachElementTypeForVariable: vi.fn(async () => null),
    resolveBladeViewVariableTypeForView: vi.fn(async () => null),
    resolvePhpReceiverMethodCompletions: vi.fn(async () => []),
    workspaceRoot: ROOT,
    ...overrides,
  };
}

describe("provideBladeCompletions", () => {
  it("returns directive completions", async () => {
    await expect(
      provideBladeCompletions("@if", { column: 4, lineNumber: 1 }, makeDeps()),
    ).resolves.toContainEqual(
      expect.objectContaining({ kind: "directive", label: "@if" }),
    );
  });

  it("returns view-variable completions before built-ins", async () => {
    const invoiceVariable: PhpLaravelViewVariable = {
      detail: "controller data",
      name: "$invoice",
      typeHint: "Invoice",
      valueExpression: null,
      valueOffset: null,
    };

    const completions = await provideBladeCompletions(
      "{{ $in",
      { column: 7, lineNumber: 1 },
      makeDeps({
        collectBladeViewVariablesWithDisplayTypes: vi.fn(async () => [
          invoiceVariable,
        ]),
      }),
    );

    expect(completions).toContainEqual(
      expect.objectContaining({ kind: "variable", label: "$invoice" }),
    );
  });

  it("returns typed member completions through the injected PHP resolver", async () => {
    const members: PhpMethodCompletion[] = [
      {
        declaringClassName: "App\\Models\\Invoice",
        name: "total",
        parameters: "",
        returnType: "int",
      },
    ];
    const resolvePhpReceiverMethodCompletions = vi.fn(async () => members);

    const completions = await provideBladeCompletions(
      "{{ $invoice->to",
      { column: 16, lineNumber: 1 },
      makeDeps({
        resolveBladeViewVariableTypeForView: vi.fn(
          async () => "App\\Models\\Invoice",
        ),
        resolvePhpReceiverMethodCompletions,
      }),
    );

    expect(resolvePhpReceiverMethodCompletions).toHaveBeenCalled();
    expect(completions).toContainEqual(
      expect.objectContaining({ kind: "member", label: "total" }),
    );
  });

  it("does not leak Laravel helper completions without framework string-literal support", async () => {
    await expect(
      provideBladeCompletions(
        "{{ ro",
        { column: 6, lineNumber: 1 },
        makeDeps({
          frameworkRuntime: GENERIC_RUNTIME,
        }),
      ),
    ).resolves.toEqual([]);
  });

  it("does not collect Laravel helper literals without framework string-literal support", async () => {
    const collectPhpLaravelNamedRouteTargets = vi.fn(async () => [
      {
        name: "dashboard",
        path: `${ROOT}/routes/web.php`,
        position: { column: 1, lineNumber: 1 },
        relativePath: "routes/web.php",
      },
    ]);
    const source = "{{ route('dash') }}";

    await expect(
      provideBladeCompletions(
        source,
        { column: source.indexOf("dash") + "dash".length + 1, lineNumber: 1 },
        makeDeps({
          collectPhpLaravelNamedRouteTargets,
          frameworkRuntime: GENERIC_RUNTIME,
        }),
      ),
    ).resolves.toEqual([]);
    expect(collectPhpLaravelNamedRouteTargets).not.toHaveBeenCalled();
  });

  it("does not collect Laravel views without framework view support", async () => {
    const collectPhpLaravelViewTargets = vi.fn(async () => [
      {
        name: "partials.alert",
        path: `${ROOT}/resources/views/partials/alert.blade.php`,
        relativePath: "resources/views/partials/alert.blade.php",
      },
    ]);
    const source = "@include('partials.')";

    await expect(
      provideBladeCompletions(
        source,
        {
          column: source.indexOf("partials.") + "partials.".length + 1,
          lineNumber: 1,
        },
        makeDeps({
          collectPhpLaravelViewTargets,
          frameworkRuntime: GENERIC_RUNTIME,
        }),
      ),
    ).resolves.toEqual([]);
    expect(collectPhpLaravelViewTargets).not.toHaveBeenCalled();
  });

  it("drops async component completions after a root switch", async () => {
    const currentWorkspaceRootRef = { current: ROOT };

    const completions = await provideBladeCompletions(
      "<x-",
      { column: 4, lineNumber: 1 },
      makeDeps({
        collectBladeComponentNames: vi.fn(async () => {
          currentWorkspaceRootRef.current = "/other";

          return ["alert"];
        }),
        currentWorkspaceRootRef,
      }),
    );

    expect(completions).toEqual([]);
  });
});
