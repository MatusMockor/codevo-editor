import { describe, expect, it, vi } from "vitest";
import {
  latteTemplateTypeNames,
  latteTemplateTypePropertySightings,
  latteTemplateTypeVariableType,
  loadNetteTemplateTypeProperties,
  mergeLatteResolvedTypes,
  type LatteTemplateTypeCache,
  type LatteTemplateTypeContext,
  type LatteTemplateTypeInFlight,
  type NetteTemplateTypeDependencies,
} from "./netteTemplateTypes";

const ROOT = "/ws";
const TEMPLATE_FILE = `${ROOT}/app/Model/ProductTemplate.php`;

const PRODUCT_TEMPLATE_SOURCE = `<?php
namespace App\\Model;

class ProductTemplate
{
    public \\App\\Model\\Product $product;
    public Category $category;
}
`;

const WRONG_NAMESPACE_SOURCE = `<?php
namespace App\\Other;

class ProductTemplate
{
    public string $product;
}
`;

function makeDeps(
  overrides: Partial<NetteTemplateTypeDependencies> = {},
): NetteTemplateTypeDependencies {
  return {
    readFileContent: vi.fn(async (path: string) => {
      if (path === TEMPLATE_FILE) {
        return PRODUCT_TEMPLATE_SOURCE;
      }

      throw new Error(`missing ${path}`);
    }),
    resolveDeclaredType: vi.fn((_source, typeHint) =>
      typeHint === "Category" ? "App\\Model\\Category" : typeHint,
    ),
    searchText: vi.fn(async () => [{ path: TEMPLATE_FILE }]),
    ...overrides,
  };
}

function makeContext({
  cache = {},
  deps = makeDeps(),
  inFlight = new Map(),
  rootActive = true,
}: {
  cache?: LatteTemplateTypeCache;
  deps?: NetteTemplateTypeDependencies;
  inFlight?: LatteTemplateTypeInFlight;
  rootActive?: boolean;
} = {}): { cache: LatteTemplateTypeCache; context: LatteTemplateTypeContext; inFlight: LatteTemplateTypeInFlight } {
  return {
    cache,
    context: {
      cache,
      deps,
      inFlight,
      isRequestedRootActive: () => rootActive,
      phpExtension: ".php",
      requestedRoot: ROOT,
      searchLimit: 50,
      ttlMs: 5_000,
    },
    inFlight,
  };
}

describe("latteTemplateTypeNames", () => {
  it("dedupes templateType declarations from Latte source", () => {
    expect(
      latteTemplateTypeNames(
        "{templateType App\\Model\\ProductTemplate}\n{templateType App\\Model\\ProductTemplate}",
      ),
    ).toEqual(["App\\Model\\ProductTemplate"]);
  });
});

describe("loadNetteTemplateTypeProperties", () => {
  it("queries by short class name, filters by FQN and caches per original type name", async () => {
    const deps = makeDeps({
      readFileContent: vi.fn(async (path: string) => {
        if (path.endsWith("Wrong.php")) {
          return WRONG_NAMESPACE_SOURCE;
        }

        return PRODUCT_TEMPLATE_SOURCE;
      }),
      searchText: vi.fn(async () => [
        { path: `${ROOT}/app/Other/Wrong.php` },
        { path: TEMPLATE_FILE },
        { path: `${ROOT}/README.md` },
      ]),
    });
    const { cache, context } = makeContext({ deps });

    const first = await loadNetteTemplateTypeProperties(
      context,
      "App\\Model\\ProductTemplate",
    );
    const second = await loadNetteTemplateTypeProperties(
      context,
      "App\\Model\\ProductTemplate",
    );

    expect(deps.searchText).toHaveBeenCalledWith(
      ROOT,
      "class ProductTemplate",
      50,
    );
    expect(first.map((sighting) => sighting.property.name)).toEqual([
      "$product",
      "$category",
    ]);
    expect(second).toBe(first);
    expect(cache[ROOT]?.sightingsByTypeName).toHaveProperty(
      "App\\Model\\ProductTemplate",
    );
  });

  it("shares one in-flight scan and clears it after settlement", async () => {
    const searchResolver: {
      current?: (value: { path: string }[]) => void;
    } = {};
    const deps = makeDeps({
      searchText: vi.fn(
        () =>
          new Promise<{ path: string }[]>((resolve) => {
            searchResolver.current = resolve;
          }),
      ),
    });
    const { context, inFlight } = makeContext({ deps });

    const first = loadNetteTemplateTypeProperties(
      context,
      "App\\Model\\ProductTemplate",
    );
    const second = loadNetteTemplateTypeProperties(
      context,
      "App\\Model\\ProductTemplate",
    );

    if (!searchResolver.current) {
      throw new Error("search promise was not started");
    }

    searchResolver.current([{ path: TEMPLATE_FILE }]);

    const [firstResult, secondResult] = await Promise.all([first, second]);

    expect(firstResult).toBe(secondResult);
    expect(deps.searchText).toHaveBeenCalledTimes(1);
    expect(inFlight.size).toBe(0);
  });

  it("drops stale-root results after search without writing cache", async () => {
    let active = true;
    const deps = makeDeps({
      searchText: vi.fn(async () => {
        active = false;
        return [{ path: TEMPLATE_FILE }];
      }),
    });
    const { cache, context } = makeContext({ deps });
    context.isRequestedRootActive = () => active;

    await expect(
      loadNetteTemplateTypeProperties(context, "App\\Model\\ProductTemplate"),
    ).resolves.toEqual([]);
    expect(deps.readFileContent).not.toHaveBeenCalled();
    expect(cache[ROOT]).toBeUndefined();
  });
});

describe("latteTemplateTypePropertySightings", () => {
  it("loads properties for every declared template type", async () => {
    const deps = makeDeps();
    const { context } = makeContext({ deps });

    const sightings = await latteTemplateTypePropertySightings(
      context,
      "{templateType App\\Model\\ProductTemplate}",
    );

    expect(sightings.map((sighting) => sighting.property.name)).toContain(
      "$product",
    );
  });
});

describe("latteTemplateTypeVariableType", () => {
  it("resolves short property types against the template class source", async () => {
    const deps = makeDeps();
    const { context } = makeContext({ deps });

    await expect(
      latteTemplateTypeVariableType(
        context,
        "{templateType App\\Model\\ProductTemplate}",
        "category",
      ),
    ).resolves.toBe("App\\Model\\Category");
  });

  it("returns null when sightings conflict", async () => {
    const deps = makeDeps({
      readFileContent: vi.fn(async (path: string) => {
        if (path.endsWith("One.php")) {
          return `<?php namespace App\\Model; class ProductTemplate { public A $product; }`;
        }

        return `<?php namespace App\\Model; class ProductTemplate { public B $product; }`;
      }),
      resolveDeclaredType: vi.fn((_source, typeHint) => typeHint),
      searchText: vi.fn(async () => [
        { path: `${ROOT}/app/One.php` },
        { path: `${ROOT}/app/Two.php` },
      ]),
    });
    const { context } = makeContext({ deps });

    await expect(
      latteTemplateTypeVariableType(
        context,
        "{templateType App\\Model\\ProductTemplate}",
        "product",
      ),
    ).resolves.toBeNull();
  });
});

describe("mergeLatteResolvedTypes", () => {
  it("ignores unresolved sightings and treats leading slash/case as the same type", () => {
    expect(mergeLatteResolvedTypes([null, "\\App\\Product", "app\\product"]))
      .toBe("\\App\\Product");
    expect(mergeLatteResolvedTypes(["App\\A", "App\\B"])).toBeNull();
  });
});
