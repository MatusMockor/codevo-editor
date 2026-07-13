import { describe, expect, it, vi } from "vitest";
import {
  phpLaravelFrameworkProvider,
  phpNetteFrameworkProvider,
} from "../domain/phpFrameworkProviders";
import { genericPhpFrameworkBuilderMagicExpressionTypeAdapter } from "./phpFrameworkBuilderMagicExpressionTypeAdapter";
import { genericPhpFrameworkDatabaseExpressionTypeAdapter } from "./phpFrameworkDatabaseExpressionTypeAdapter";
import { genericPhpFrameworkModelBuilderTransitionExpressionTypeAdapter } from "./phpFrameworkModelBuilderTransitionExpressionTypeAdapter";
import { genericPhpFrameworkModelFluentExpressionTypeAdapter } from "./phpFrameworkModelFluentExpressionTypeAdapter";
import { genericPhpFrameworkQueryCallbackVariableExpressionTypeAdapter } from "./phpFrameworkQueryCallbackVariableExpressionTypeAdapter";
import { genericPhpFrameworkTerminalModelRecoveryExpressionTypeAdapter } from "./phpFrameworkTerminalModelRecoveryExpressionTypeAdapter";
import { createPhpFrameworkIntelligence } from "./phpFrameworkIntelligence";
import { createPhpFrameworkRuntimeContext } from "./phpFrameworkRuntimeContext";
import { phpLaravelDatabaseExpressionTypeAdapter } from "./phpLaravelDatabaseExpressionTypeAdapter";
import { phpLaravelModelBuilderTransitionExpressionTypeAdapter } from "./phpLaravelModelBuilderTransitionExpressionTypeAdapter";
import { phpLaravelModelFluentExpressionTypeAdapter } from "./phpLaravelModelFluentExpressionTypeAdapter";
import { phpLaravelQueryCallbackVariableExpressionTypeAdapter } from "./phpLaravelQueryCallbackVariableExpressionTypeAdapter";
import { createPhpExpressionTypeAdapterBundle } from "./phpExpressionTypeAdapterRegistry";

const GENERIC_RUNTIME = createPhpFrameworkRuntimeContext(
  createPhpFrameworkIntelligence({
    matchedProviderIds: [],
    profile: "generic",
    providers: [],
  }),
);
const NETTE_RUNTIME = createPhpFrameworkRuntimeContext(
  createPhpFrameworkIntelligence({
    matchedProviderIds: ["nette"],
    profile: "nette",
    providers: [phpNetteFrameworkProvider],
  }),
);
const LARAVEL_RUNTIME = createPhpFrameworkRuntimeContext(
  createPhpFrameworkIntelligence({
    matchedProviderIds: ["laravel"],
    profile: "laravel",
    providers: [phpLaravelFrameworkProvider],
  }),
);

function createBundle(
  frameworkRuntime: Pick<typeof GENERIC_RUNTIME, "hasProvider">,
) {
  return createPhpExpressionTypeAdapterBundle({
    frameworkRuntime,
    phpClassHasDynamicBuilderFinder: vi.fn(async () => false),
    phpClassHasNamedBuilderScope: vi.fn(async () => false),
    resolvePropertyOrRelationType: vi.fn(async () => null),
  });
}

describe("phpExpressionTypeAdapterRegistry", () => {
  it.each([
    ["generic", GENERIC_RUNTIME],
    ["Nette", NETTE_RUNTIME],
    ["custom", { hasProvider: (providerId: string) => providerId === "custom" }],
  ])("returns the complete inert bundle for a %s runtime", (_name, runtime) => {
    const bundle = createBundle(runtime);

    expect(bundle).toEqual({
      builderMagicExpressionTypeAdapter:
        genericPhpFrameworkBuilderMagicExpressionTypeAdapter,
      databaseExpressionTypeAdapter:
        genericPhpFrameworkDatabaseExpressionTypeAdapter,
      modelBuilderTransitionExpressionTypeAdapter:
        genericPhpFrameworkModelBuilderTransitionExpressionTypeAdapter,
      modelFluentExpressionTypeAdapter:
        genericPhpFrameworkModelFluentExpressionTypeAdapter,
      queryCallbackVariableExpressionTypeAdapter:
        genericPhpFrameworkQueryCallbackVariableExpressionTypeAdapter,
      terminalModelRecoveryExpressionTypeAdapter:
        genericPhpFrameworkTerminalModelRecoveryExpressionTypeAdapter,
    });
  });

  it("activates the exact six Laravel adapters through provider membership", async () => {
    const phpClassHasNamedBuilderScope = vi.fn(async () => true);
    const resolvePropertyOrRelationType = vi.fn(
      async () => "App\\Models\\Comment",
    );
    const bundle = createPhpExpressionTypeAdapterBundle({
      frameworkRuntime: LARAVEL_RUNTIME,
      phpClassHasDynamicBuilderFinder: vi.fn(async () => false),
      phpClassHasNamedBuilderScope,
      resolvePropertyOrRelationType,
    });

    expect(bundle.databaseExpressionTypeAdapter).toBe(
      phpLaravelDatabaseExpressionTypeAdapter,
    );
    expect(bundle.modelBuilderTransitionExpressionTypeAdapter).toBe(
      phpLaravelModelBuilderTransitionExpressionTypeAdapter,
    );
    expect(bundle.modelFluentExpressionTypeAdapter).toBe(
      phpLaravelModelFluentExpressionTypeAdapter,
    );
    expect(bundle.queryCallbackVariableExpressionTypeAdapter).toBe(
      phpLaravelQueryCallbackVariableExpressionTypeAdapter,
    );
    await expect(
      bundle.builderMagicExpressionTypeAdapter.staticCallType({
        className: "App\\Models\\Post",
        methodName: "published",
      }),
    ).resolves.toBe("Illuminate\\Database\\Eloquent\\Builder");
    await expect(
      bundle.terminalModelRecoveryExpressionTypeAdapter.collectionTerminalModelType(
        {
          receiverExpression: "$post->comments",
          resolveCollectionModelType: vi.fn(async () => null),
          resolveExpressionType: vi.fn(async () => "App\\Models\\Post"),
        },
      ),
    ).resolves.toBe("App\\Models\\Comment");
  });

  it("queries registered provider contributions in deterministic order", () => {
    const queriedProviderIds: string[] = [];

    createBundle({
      hasProvider: (providerId) => {
        queriedProviderIds.push(providerId);
        return false;
      },
    });

    expect(queriedProviderIds).toEqual(["laravel"]);
  });
});
