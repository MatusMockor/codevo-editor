import { describe, expect, it, vi } from "vitest";
import { lattePhpExtensionFiltersFromSource } from "../domain/lattePhpExtensionFilters";
import type { PhpMethodCompletion } from "../domain/phpMethodCompletions";
import type { LatteFilterRegistrationTarget } from "./latteFilterDiscovery";
import {
  resolveLatteFilterCallableClassName,
  resolveLatteProjectFilters,
  type LatteFilterCallableResolutionContext,
} from "./latteFilterCallableResolution";

const CONFIG_PATH = "/ws/app/config/config.neon";
const CONFIG_SOURCE = `services:
  priceHelper: Crm\\ApplicationModule\\Helpers\\PriceHelper(%app.priceMultiplier%)
  publicPriceHelper: @priceHelper
  filterLoader:
    setup:
      - addFilter('price', [@publicPriceHelper, process])
`;

function method(
  overrides: Partial<PhpMethodCompletion> = {},
): PhpMethodCompletion {
  return {
    declaringClassName: "Crm\\ApplicationModule\\Helpers\\PriceHelper",
    name: "process",
    parameters: "float $price, ?string $currency = null",
    returnType: "string",
    ...overrides,
  };
}

function registration(
  overrides: Partial<LatteFilterRegistrationTarget> = {},
): LatteFilterRegistrationTarget {
  return {
    methodName: "process",
    name: "price",
    offset: CONFIG_SOURCE.indexOf("price'"),
    path: CONFIG_PATH,
    serviceName: "publicPriceHelper",
    ...overrides,
  };
}

function makeContext({
  active = () => true,
  members = [method()],
}: {
  active?: () => boolean;
  members?: PhpMethodCompletion[];
} = {}): LatteFilterCallableResolutionContext {
  return {
    deps: {
      readFileContent: vi.fn(async () => CONFIG_SOURCE),
      resolvePhpReceiverCompletions: vi.fn(async () => members),
      synthesizeTypedReceiverSource: vi.fn((variableName, typeName) => ({
        position: { column: 18, lineNumber: 3 },
        source: `<?php\n/** @var \\${typeName} $${variableName} */\n$${variableName}->`,
      })),
    },
    isRequestedRootActive: active,
    loadProjectConfig: vi.fn(async () => ({
      serviceAliases: new Map([["publicPriceHelper", "priceHelper"]]),
      serviceNameTypes: new Map([
        ["priceHelper", "Crm\\ApplicationModule\\Helpers\\PriceHelper"],
      ]),
    })),
  };
}

describe("resolveLatteProjectFilters", () => {
  it("resolves aliased NEON services to PHP callable signatures", async () => {
    const context = makeContext();

    await expect(
      resolveLatteProjectFilters(context, [registration()]),
    ).resolves.toEqual([
      {
        callable: {
          className: "Crm\\ApplicationModule\\Helpers\\PriceHelper",
          declaringClassName: "Crm\\ApplicationModule\\Helpers\\PriceHelper",
          methodName: "process",
          parameters: "float $price, ?string $currency = null",
          returnType: "string",
        },
        name: "price",
      },
    ]);
  });

  it("resolves $this and self::class extension signatures", async () => {
    const source = `<?php
namespace App\\Latte;

final class ProjectExtension extends \\Latte\\Extension
{
    public function getFilters(): array
    {
        return [
            'instanceFilter' => [$this, 'formatInstance'],
            'staticFilter' => [self::class, 'formatStatic'],
        ];
    }

    public function formatInstance(string $value): string { return $value; }
    public static function formatStatic(int $value): float { return $value; }
}
`;
    const registrations = lattePhpExtensionFiltersFromSource(source).map(
      (filter) => ({ ...filter, path: "/ws/app/Latte/ProjectExtension.php" }),
    );
    const context = makeContext({
      members: [
        method({
          declaringClassName: "App\\Latte\\ProjectExtension",
          name: "formatInstance",
          parameters: "string $value",
          returnType: "string",
        }),
        method({
          declaringClassName: "App\\Latte\\ProjectExtension",
          isStatic: true,
          name: "formatStatic",
          parameters: "int $value",
          returnType: "float",
        }),
      ],
    });

    await expect(
      resolveLatteProjectFilters(context, registrations),
    ).resolves.toMatchObject([
      {
        callable: {
          className: "App\\Latte\\ProjectExtension",
          methodName: "formatInstance",
          returnType: "string",
        },
        name: "instanceFilter",
      },
      {
        callable: {
          className: "App\\Latte\\ProjectExtension",
          methodName: "formatStatic",
          returnType: "float",
        },
        name: "staticFilter",
      },
    ]);
  });

  it("resolves FQCN getFilters callables without loading NEON config", async () => {
    const context = makeContext({
      members: [
        method({
          declaringClassName: "App\\Filters\\PriceFilter",
          isStatic: true,
          name: "format",
          parameters: "int|float $value",
          returnType: "float",
        }),
      ],
    });

    await expect(
      resolveLatteProjectFilters(context, [
        registration({
          callableKind: "static",
          methodName: "format",
          name: "priceFloat",
          serviceClassName: "\\App\\Filters\\PriceFilter",
          serviceName: undefined,
        }),
      ]),
    ).resolves.toMatchObject([
      {
        callable: {
          className: "App\\Filters\\PriceFilter",
          methodName: "format",
          returnType: "float",
        },
        name: "priceFloat",
      },
    ]);
    expect(context.loadProjectConfig).not.toHaveBeenCalled();
    expect(context.deps.readFileContent).not.toHaveBeenCalled();
  });

  it("keeps class-string callables conservative when the method is not static", async () => {
    const context = makeContext({
      members: [
        method({
          declaringClassName: "App\\Filters\\PriceFilter",
          isStatic: undefined,
          name: "format",
        }),
      ],
    });

    await expect(
      resolveLatteProjectFilters(context, [
        registration({
          callableKind: "static",
          methodName: "format",
          serviceClassName: "App\\Filters\\PriceFilter",
          serviceName: undefined,
        }),
      ]),
    ).resolves.toEqual([{ name: "price" }]);
  });

  it("preserves the inherited declaring class for static callables", async () => {
    const context = makeContext({
      members: [
        method({
          declaringClassName: "App\\Filters\\BasePriceFilter",
          isStatic: true,
          name: "format",
        }),
      ],
    });

    await expect(
      resolveLatteProjectFilters(context, [
        registration({
          callableKind: "static",
          methodName: "format",
          serviceClassName: "App\\Filters\\ChildPriceFilter",
          serviceName: undefined,
        }),
      ]),
    ).resolves.toMatchObject([
      {
        callable: {
          className: "App\\Filters\\ChildPriceFilter",
          declaringClassName: "App\\Filters\\BasePriceFilter",
          methodName: "format",
        },
      },
    ]);
  });

  it("resolves a potentially inherited $this callable through its containing class", async () => {
    const context = makeContext({
      members: [
        method({
          declaringClassName: "App\\Latte\\BaseExtension",
          name: "inheritedMethod",
          parameters: "string $value",
          returnType: "string",
        }),
      ],
    });

    await expect(
      resolveLatteProjectFilters(context, [
        registration({
          callableKind: "instance",
          callableOffset: undefined,
          methodName: "inheritedMethod",
          serviceClassName: "App\\Latte\\ProjectExtension",
          serviceName: undefined,
        }),
      ]),
    ).resolves.toMatchObject([
      {
        callable: {
          className: "App\\Latte\\ProjectExtension",
          declaringClassName: "App\\Latte\\BaseExtension",
          methodName: "inheritedMethod",
        },
      },
    ]);
  });

  it("keeps dynamic registrations conservative", async () => {
    const context = makeContext();

    await expect(
      resolveLatteProjectFilters(context, [
        registration({ methodName: undefined, serviceName: undefined }),
      ]),
    ).resolves.toEqual([{ name: "price" }]);
    expect(context.deps.resolvePhpReceiverCompletions).not.toHaveBeenCalled();
  });

  it("drops results when the requested root becomes stale", async () => {
    let active = true;
    const context = makeContext({ active: () => active });
    context.deps.resolvePhpReceiverCompletions = vi.fn(async () => {
      active = false;
      return [method()];
    });

    await expect(
      resolveLatteProjectFilters(context, [registration()]),
    ).resolves.toEqual([]);
  });
});

describe("resolveLatteFilterCallableClassName", () => {
  it("uses a same-file service type before project aliases", async () => {
    const context = makeContext();

    await expect(
      resolveLatteFilterCallableClassName(
        context,
        registration({ serviceName: "priceHelper" }),
        CONFIG_SOURCE,
      ),
    ).resolves.toBe("Crm\\ApplicationModule\\Helpers\\PriceHelper");
    expect(context.loadProjectConfig).not.toHaveBeenCalled();
  });

  it("uses project service alias maps for cross-file registrations", async () => {
    const context = makeContext();
    context.deps.readFileContent = vi.fn(async () => `services:
  filterLoader:
    setup:
      - addFilter('price', [@publicPriceHelper, process])
`);

    await expect(
      resolveLatteFilterCallableClassName(context, registration()),
    ).resolves.toBe("Crm\\ApplicationModule\\Helpers\\PriceHelper");
    expect(context.loadProjectConfig).toHaveBeenCalledOnce();
  });
});
