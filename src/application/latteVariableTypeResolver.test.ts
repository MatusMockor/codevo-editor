import { describe, expect, it, vi } from "vitest";
import type { NetteIncludedTemplateArgument } from "./netteIncludedTemplateArguments";
import type { LatteVariableResolutionContext } from "./latteVariableContracts";
import { resolveLatteVariableType } from "./latteVariableTypeResolver";

function includedArgument(
  name: string,
  type: string | null,
): NetteIncludedTemplateArgument {
  return {
    depth: 0,
    expression: "$source",
    name,
    provenance: [],
    sourceSpan: { end: 1, start: 0 },
    sourceTemplateRelativePath: "caller.latte",
    targetSpan: { end: 1, start: 0 },
    targetTemplateRelativePath: "partial.latte",
    type,
  };
}

function context({
  active = () => true,
  included = [],
  presenterType = null,
}: {
  active?: () => boolean;
  included?: readonly NetteIncludedTemplateArgument[];
  presenterType?: string | null;
} = {}): LatteVariableResolutionContext {
  return {
    currentControlClassName: vi.fn(async () => null),
    currentPresenterClassName: vi.fn(async () => null),
    currentTemplateRelativePath: "partial.latte",
    deps: {
      resolveDeclaredType: (_source, typeHint) => typeHint,
      resolveExpressionType: vi.fn(async () => null),
    },
    isRequestedRootActive: active,
    loadIncludedTemplateArguments: vi.fn(async () => included),
    loadTemplateTypePropertySightings: vi.fn(async () => []),
    loadViewDataEntries: vi.fn(async () =>
      presenterType
        ? [
            {
              bindings: [
                {
                  variables: [
                    {
                      detail: "presenter data",
                      name: "$value",
                      typeHint: presenterType,
                      valueExpression: null,
                      valueOffset: null,
                    },
                  ],
                  viewName: "Home:default",
                },
              ],
              source: "<?php",
            },
          ]
        : [],
    ),
    maxTypeResolutionDepth: 5,
    viewNames: vi.fn(async () => ["Home:default"]),
  } as LatteVariableResolutionContext;
}

describe("Latte include argument type resolution", () => {
  it("uses a merged include type before presenter data", async () => {
    const resolutionContext = context({
      included: [
        includedArgument("value", "App\\Model\\Invoice"),
        includedArgument("value", "\\App\\Model\\Invoice"),
      ],
      presenterType: "App\\Model\\PresenterValue",
    });

    await expect(
      resolveLatteVariableType(resolutionContext, "{$value}", 3, "value"),
    ).resolves.toBe("App\\Model\\Invoice");
  });

  it("treats conflicting caller types as unknown", async () => {
    const resolutionContext = context({
      included: [
        includedArgument("value", "App\\Model\\Invoice"),
        includedArgument("value", "App\\Model\\Order"),
      ],
    });

    await expect(
      resolveLatteVariableType(resolutionContext, "{$value}", 3, "value"),
    ).resolves.toBeNull();
  });

  it("does not fall through to presenter data for conflicting caller types", async () => {
    const resolutionContext = context({
      included: [
        includedArgument("value", "App\\Model\\Invoice"),
        includedArgument("value", "App\\Model\\Order"),
      ],
      presenterType: "App\\Model\\PresenterValue",
    });

    await expect(
      resolveLatteVariableType(resolutionContext, "{$value}", 3, "value"),
    ).resolves.toBeNull();
  });

  it("does not load include arguments beyond the resolution depth", async () => {
    const resolutionContext = context({
      included: [includedArgument("value", "string")],
    });

    await expect(
      resolveLatteVariableType(
        resolutionContext,
        "{$value}",
        3,
        "value",
        resolutionContext.maxTypeResolutionDepth,
      ),
    ).resolves.toBeNull();
    expect(
      (resolutionContext as LatteVariableResolutionContext & {
        loadIncludedTemplateArguments: ReturnType<typeof vi.fn>;
      }).loadIncludedTemplateArguments,
    ).not.toHaveBeenCalled();
  });

  it("drops include results when the project becomes stale", async () => {
    let active = true;
    const resolutionContext = context({ active: () => active });
    const includeContext = resolutionContext as LatteVariableResolutionContext & {
      loadIncludedTemplateArguments: ReturnType<typeof vi.fn>;
    };
    includeContext.loadIncludedTemplateArguments = vi.fn(async () => {
      active = false;
      return [includedArgument("value", "string")];
    });

    await expect(
      resolveLatteVariableType(resolutionContext, "{$value}", 3, "value"),
    ).resolves.toBeNull();
  });
});
