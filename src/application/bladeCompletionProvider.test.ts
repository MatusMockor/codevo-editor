import { describe, expect, it, vi } from "vitest";
import {
  phpLaravelFrameworkProvider,
  type PhpFrameworkProvider,
} from "../domain/phpFrameworkProviders";
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

function runtimeForProvider(provider: PhpFrameworkProvider) {
  return createPhpFrameworkRuntimeContext(
    createPhpFrameworkIntelligence({
      matchedProviderIds: [provider.id],
      profile: "generic",
      providers: [provider],
    }),
  );
}

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

  it("uses provider-owned template names for Laravel .blade.php and .php view paths", async () => {
    const collectBladeViewVariablesWithDisplayTypes = vi.fn(async () => []);

    await provideBladeCompletions(
      "{{ $",
      { column: 5, lineNumber: 1 },
      makeDeps({ collectBladeViewVariablesWithDisplayTypes }),
    );
    await provideBladeCompletions(
      "{{ $",
      { column: 5, lineNumber: 1 },
      makeDeps({
        activeDocument: {
          content: "",
          path: `${ROOT}/resources/views/reports/summary.php`,
        },
        collectBladeViewVariablesWithDisplayTypes,
      }),
    );

    expect(collectBladeViewVariablesWithDisplayTypes).toHaveBeenNthCalledWith(
      1,
      "invoices.show",
    );
    expect(collectBladeViewVariablesWithDisplayTypes).toHaveBeenNthCalledWith(
      2,
      "reports.summary",
    );
  });

  it("does not collect Blade view-data completions when providers cannot resolve the active template name", async () => {
    const collectBladeViewVariablesWithDisplayTypes = vi.fn(async () => []);
    const collectBladeForeachLoopVariables = vi.fn(async () => []);
    const provider: PhpFrameworkProvider = {
      id: "custom",
      templating: {
        templateNameFromRelativePath: vi.fn(() => null),
      },
      viewData: {},
    };

    await provideBladeCompletions(
      "{{ $",
      { column: 5, lineNumber: 1 },
      makeDeps({
        collectBladeForeachLoopVariables,
        collectBladeViewVariablesWithDisplayTypes,
        frameworkRuntime: runtimeForProvider(provider),
      }),
    );
    await provideBladeCompletions(
      "{{ $",
      { column: 5, lineNumber: 1 },
      makeDeps({
        activeDocument: null,
        collectBladeForeachLoopVariables,
        collectBladeViewVariablesWithDisplayTypes,
      }),
    );
    await provideBladeCompletions(
      "{{ $",
      { column: 5, lineNumber: 1 },
      makeDeps({
        activeDocument: {
          content: "",
          path: `${ROOT}/storage/framework/views/a.php`,
        },
        collectBladeForeachLoopVariables,
        collectBladeViewVariablesWithDisplayTypes,
      }),
    );

    expect(collectBladeViewVariablesWithDisplayTypes).not.toHaveBeenCalled();
    expect(collectBladeForeachLoopVariables).not.toHaveBeenCalled();
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

  it("does not resolve typed member completions when the active template has no provider view name", async () => {
    const resolveBladeViewVariableTypeForView = vi.fn(async () => null);
    const resolveBladeForeachElementTypeForVariable = vi.fn(async () => null);
    const resolvePhpReceiverMethodCompletions = vi.fn(async () => []);
    const provider: PhpFrameworkProvider = {
      id: "custom",
      templating: {
        templateNameFromRelativePath: vi.fn(() => null),
      },
      viewData: {},
    };

    await expect(
      provideBladeCompletions(
        "{{ $invoice->to",
        { column: 16, lineNumber: 1 },
        makeDeps({
          frameworkRuntime: runtimeForProvider(provider),
          resolveBladeForeachElementTypeForVariable,
          resolveBladeViewVariableTypeForView,
          resolvePhpReceiverMethodCompletions,
        }),
      ),
    ).resolves.toEqual([]);
    await expect(
      provideBladeCompletions(
        "{{ $invoice->to",
        { column: 16, lineNumber: 1 },
        makeDeps({
          activeDocument: null,
          resolveBladeForeachElementTypeForVariable,
          resolveBladeViewVariableTypeForView,
          resolvePhpReceiverMethodCompletions,
        }),
      ),
    ).resolves.toEqual([]);
    await expect(
      provideBladeCompletions(
        "{{ $invoice->to",
        { column: 16, lineNumber: 1 },
        makeDeps({
          activeDocument: {
            content: "",
            path: `${ROOT}/app/Http/Controllers/InvoiceController.php`,
          },
          resolveBladeForeachElementTypeForVariable,
          resolveBladeViewVariableTypeForView,
          resolvePhpReceiverMethodCompletions,
        }),
      ),
    ).resolves.toEqual([]);

    expect(resolveBladeViewVariableTypeForView).not.toHaveBeenCalled();
    expect(resolveBladeForeachElementTypeForVariable).not.toHaveBeenCalled();
    expect(resolvePhpReceiverMethodCompletions).not.toHaveBeenCalled();
  });

  it("drops stale typed member completions after resolving the view variable type", async () => {
    const currentWorkspaceRootRef = { current: ROOT };
    const resolvePhpReceiverMethodCompletions = vi.fn(async () => []);

    await expect(
      provideBladeCompletions(
        "{{ $invoice->to",
        { column: 16, lineNumber: 1 },
        makeDeps({
          currentWorkspaceRootRef,
          resolveBladeViewVariableTypeForView: vi.fn(async () => {
            currentWorkspaceRootRef.current = "/other";

            return "App\\Models\\Invoice";
          }),
          resolvePhpReceiverMethodCompletions,
        }),
      ),
    ).resolves.toEqual([]);
    expect(resolvePhpReceiverMethodCompletions).not.toHaveBeenCalled();
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

  it("does not ask provider helper reference scanners when string literals are unsupported", async () => {
    const referenceAt = vi.fn(() => ({
      call: "route",
      name: "dash",
      position: { column: 11, lineNumber: 1 },
      prefix: "dash",
    }));
    const provider: PhpFrameworkProvider = {
      id: "custom",
      routes: { referenceAt },
    };
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
          frameworkRuntime: {
            ...GENERIC_RUNTIME,
            providers: [provider],
            supports: (capability) =>
              capability === "stringLiterals"
                ? false
                : GENERIC_RUNTIME.supports(capability),
          },
        }),
      ),
    ).resolves.toEqual([]);
    expect(referenceAt).not.toHaveBeenCalled();
    expect(collectPhpLaravelNamedRouteTargets).not.toHaveBeenCalled();
  });

  it("does not offer Laravel helper-name completions for a custom string-literal provider", async () => {
    const provider: PhpFrameworkProvider = {
      id: "custom",
      stringLiterals: { helperAt: vi.fn(() => null) },
    };

    await expect(
      provideBladeCompletions(
        "{{ ro",
        { column: 6, lineNumber: 1 },
        makeDeps({
          frameworkRuntime: createPhpFrameworkRuntimeContext(
            createPhpFrameworkIntelligence({
              matchedProviderIds: ["custom"],
              profile: "generic",
              providers: [provider],
            }),
          ),
        }),
      ),
    ).resolves.toEqual([]);
  });

  it("does not collect Laravel helper literals for a custom string-literal provider", async () => {
    const routeReferenceAt = vi.fn(() => ({
      call: "route",
      name: "dash",
      position: { column: 11, lineNumber: 1 },
      prefix: "dash",
    }));
    const provider: PhpFrameworkProvider = {
      id: "custom",
      routes: { referenceAt: routeReferenceAt },
      stringLiterals: { helperAt: vi.fn(() => null) },
    };
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
          frameworkRuntime: createPhpFrameworkRuntimeContext(
            createPhpFrameworkIntelligence({
              matchedProviderIds: ["custom"],
              profile: "generic",
              providers: [provider],
            }),
          ),
        }),
      ),
    ).resolves.toEqual([]);
    expect(routeReferenceAt).toHaveBeenCalled();
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
