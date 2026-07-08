import { describe, expect, it, vi } from "vitest";
import {
  hasNetteFrameworkProvider,
  loadNetteViewDataEntries,
  type NetteViewDataCache,
  type NetteViewDataDependencies,
  type NetteViewDataFrameworkCapabilities,
  type NetteViewDataInFlight,
} from "./netteViewDataEntries";
import { latteCandidateViewNames } from "./netteLatteCandidateViewNames";
import type {
  PhpFrameworkProvider,
  PhpFrameworkViewDataEntry,
} from "../domain/phpFrameworkProviders";

const ROOT = "/ws";
const PHP_FILE = `${ROOT}/app/UI/Home/HomePresenter.php`;
const NETTE_PROVIDER = { id: "nette" } as PhpFrameworkProvider;
const CUSTOM_PROVIDER = { id: "custom" } as PhpFrameworkProvider;

function makeEntry(source: string, variableName = "$invoice"): PhpFrameworkViewDataEntry {
  return {
    bindings: [
      {
        variables: [
          {
            detail: "fake parser",
            name: variableName,
            typeHint: "App\\Model\\Invoice",
            valueExpression: variableName,
            valueOffset: source.indexOf(variableName),
          },
        ],
        viewName: "Home:default",
      },
    ],
    source,
  };
}

function makeDeps(
  overrides: Partial<NetteViewDataDependencies> = {},
): NetteViewDataDependencies {
  return {
    joinPath: (root, relativePath) => `${root}/${relativePath}`,
    readFileContent: vi.fn(async (path: string) => {
      if (path === PHP_FILE) {
        return "<?php $this->template->invoice = $invoice;";
      }

      throw new Error(`missing ${path}`);
    }),
    resolveDeclaredType: (_source, typeHint) => typeHint,
    searchText: vi.fn(async () => [{ path: PHP_FILE }]),
    ...overrides,
  };
}

function makeCapabilities(
  overrides: Partial<NetteViewDataFrameworkCapabilities> = {},
): NetteViewDataFrameworkCapabilities {
  return {
    viewDataEntryFromSource: vi.fn((source) => makeEntry(source)),
    viewDataSearchQueries: vi.fn(() => ["template->"]),
    ...overrides,
  };
}

function makeContext({
  cache = {},
  deps = makeDeps(),
  frameworkCapabilities = makeCapabilities(),
  inFlight = new Map(),
  rootActive = true,
  providers = [CUSTOM_PROVIDER],
}: {
  cache?: NetteViewDataCache;
  deps?: NetteViewDataDependencies;
  frameworkCapabilities?: NetteViewDataFrameworkCapabilities;
  inFlight?: NetteViewDataInFlight;
  rootActive?: boolean;
  providers?: readonly PhpFrameworkProvider[];
} = {}) {
  return {
    cache,
    context: {
      cache,
      deps,
      frameworkCapabilities,
      inFlight,
      isRequestedRootActive: () => rootActive,
      phpExtension: ".php",
      providers,
      requestedRoot: ROOT,
      searchLimit: 200,
      ttlMs: 5_000,
    },
    inFlight,
  };
}

describe("loadNetteViewDataEntries", () => {
  it("loads provider-backed view data, dedupes duplicate PHP hits and caches the result", async () => {
    const deps = makeDeps({
      searchText: vi.fn(async () => [
        { path: PHP_FILE },
        { path: PHP_FILE },
        { path: `${ROOT}/README.md` },
      ]),
    });
    const frameworkCapabilities = makeCapabilities();
    const { context } = makeContext({ deps, frameworkCapabilities });

    const first = await loadNetteViewDataEntries(context);
    const second = await loadNetteViewDataEntries(context);

    expect(first).toHaveLength(1);
    expect(first[0]).toMatchObject({ sourcePath: PHP_FILE });
    expect(second).toBe(first);
    expect(deps.searchText).toHaveBeenCalledTimes(1);
    expect(deps.readFileContent).toHaveBeenCalledTimes(1);
    expect(frameworkCapabilities.viewDataEntryFromSource).toHaveBeenCalledWith(
      expect.stringContaining("$invoice"),
      [CUSTOM_PROVIDER],
    );
  });

  it("stores an empty cache entry when no provider can discover view data", async () => {
    const deps = makeDeps();
    const frameworkCapabilities = makeCapabilities({
      viewDataSearchQueries: vi.fn(() => []),
    });
    const { cache, context } = makeContext({ deps, frameworkCapabilities });

    await expect(loadNetteViewDataEntries(context)).resolves.toEqual([]);
    expect(deps.searchText).not.toHaveBeenCalled();
    expect(cache[ROOT]?.entries).toEqual([]);
  });

  it("shares one in-flight scan between concurrent callers and clears it afterwards", async () => {
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

    const first = loadNetteViewDataEntries(context);
    const second = loadNetteViewDataEntries(context);

    if (!searchResolver.current) {
      throw new Error("search promise was not started");
    }

    searchResolver.current([{ path: PHP_FILE }]);

    const [firstResult, secondResult] = await Promise.all([first, second]);

    expect(firstResult).toBe(secondResult);
    expect(deps.searchText).toHaveBeenCalledTimes(1);
    expect(inFlight.size).toBe(0);
  });

  it("drops stale-root results after the first search await without writing cache", async () => {
    let active = true;
    const deps = makeDeps({
      searchText: vi.fn(async () => {
        active = false;
        return [{ path: PHP_FILE }];
      }),
    });
    const { cache, context } = makeContext({ deps });
    context.isRequestedRootActive = () => active;

    await expect(loadNetteViewDataEntries(context)).resolves.toEqual([]);
    expect(deps.readFileContent).not.toHaveBeenCalled();
    expect(cache[ROOT]).toBeUndefined();
  });

  it("keeps scanning after an unreadable PHP hit", async () => {
    const goodPath = `${ROOT}/app/UI/GoodPresenter.php`;
    const deps = makeDeps({
      readFileContent: vi.fn(async (path: string) => {
        if (path === goodPath) {
          return "<?php $this->template->good = $good;";
        }

        throw new Error(`missing ${path}`);
      }),
      searchText: vi.fn(async () => [{ path: PHP_FILE }, { path: goodPath }]),
    });
    const { context } = makeContext({ deps });

    const entries = await loadNetteViewDataEntries(context);

    expect(entries).toHaveLength(1);
    expect(entries[0]?.sourcePath).toBe(goodPath);
  });

  it("adds Nette createComponent template variables only for the Nette provider", async () => {
    const source = `<?php
class HomePresenter
{
    protected function createComponentProductList(): ProductListControl
    {
        $control = new ProductListControl();
        /** @var \\App\\Model\\Product $product */
        $product = $this->products->get(1);
        $control->template->product = $product;

        return $control;
    }
}
`;
    const deps = makeDeps({
      readFileContent: vi.fn(async () => source),
      searchText: vi.fn(async (_root, query) =>
        query === "createComponent" ? [{ path: PHP_FILE }] : [],
      ),
    });
    const frameworkCapabilities = makeCapabilities({
      viewDataSearchQueries: vi.fn(() => []),
    });
    const { context } = makeContext({
      deps,
      frameworkCapabilities,
      providers: [NETTE_PROVIDER],
    });

    const entries = await loadNetteViewDataEntries(context);

    expect(entries).toHaveLength(1);
    expect(entries[0]?.bindings[0]?.viewName).toBe("ProductList:default");
    expect(entries[0]?.bindings[0]?.variables[0]).toMatchObject({
      name: "$product",
      typeHint: "\\App\\Model\\Product",
    });
  });
});

describe("hasNetteFrameworkProvider", () => {
  it("detects Nette by provider id only", () => {
    expect(hasNetteFrameworkProvider([CUSTOM_PROVIDER])).toBe(false);
    expect(hasNetteFrameworkProvider([CUSTOM_PROVIDER, NETTE_PROVIDER])).toBe(true);
  });
});

describe("latteCandidateViewNames", () => {
  it("maps modern presenter templates to action and wildcard view names", async () => {
    await expect(
      latteCandidateViewNames({
        controlSuffix: "Control.php",
        deps: makeDeps(),
        isRequestedRootActive: () => true,
        presenterSuffix: "Presenter.php",
        requestedRoot: ROOT,
        templateRelativePath: "app/UI/Home/default.latte",
      }),
    ).resolves.toEqual(["Home:default", "Home:*"]);
  });

  it("maps colocated control templates to owner view names", async () => {
    await expect(
      latteCandidateViewNames({
        controlSuffix: "Control.php",
        deps: makeDeps(),
        isRequestedRootActive: () => true,
        presenterSuffix: "Presenter.php",
        requestedRoot: ROOT,
        templateRelativePath: "app/UI/Grid/ProductListControl/product_list.latte",
      }),
    ).resolves.toEqual(["ProductListControl:product_list", "ProductListControl:*"]);
  });

  it("adds factory-derived owner names for legacy component templates", async () => {
    const presenterSource = `<?php
class HomePresenter
{
    protected function createComponentProductList(): App\\Components\\ProductListControl
    {
        return new App\\Components\\ProductListControl();
    }
}
`;
    const deps = makeDeps({
      readFileContent: vi.fn(async (path: string) => {
        if (path === `${ROOT}/app/UI/Home/HomePresenter.php`) {
          return presenterSource;
        }

        throw new Error(`missing ${path}`);
      }),
    });

    await expect(
      latteCandidateViewNames({
        controlSuffix: "Control.php",
        deps,
        isRequestedRootActive: () => true,
        presenterSuffix: "Presenter.php",
        requestedRoot: ROOT,
        templateRelativePath: "app/UI/Home/product_list.latte",
      }),
    ).resolves.toContain("ProductList:product_list");
  });
});
