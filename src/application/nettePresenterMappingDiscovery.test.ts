import { describe, expect, it, vi } from "vitest";
import {
  createNettePresenterMappingGeneration,
  evictOtherRootPresenterMappingEntries,
  invalidateNettePresenterMappingsForPath,
  loadNettePresenterMappings,
  nettePresenterMappingsFromNeonSource,
  type NettePresenterMappingDiscoveryContext,
} from "./nettePresenterMappingDiscovery";

const ROOT = "/workspace/project";

describe("nettePresenterMappingsFromNeonSource", () => {
  it("reads only literal application.mapping entries", () => {
    const source = String.raw`
application:
    errorPresenter: Application:Error
    mapping:
        *: Crm\*Module\Presenters\*Presenter
        Efabrica: [Efabrica\Crm, *Module\Presenters, **Presenter]
        Dynamic: %presenterMask%

other:
    mapping:
        Ignored: Bad\*Presenter
`;

    expect(nettePresenterMappingsFromNeonSource(source)).toEqual([
      {
        module: "*",
        moduleMask: "*Module",
        namespace: "Crm\\",
        presenterMask: "Presenters\\*Presenter",
      },
      {
        module: "Efabrica",
        moduleMask: "*Module\\Presenters",
        namespace: "Efabrica\\Crm\\",
        presenterMask: "**Presenter",
      },
    ]);
  });

  it("reads scalar application.mapping and empty module-mask tuples", () => {
    const scalar = String.raw`application:
    mapping: App\*Module\Presenters\*Presenter`;
    const tuple = String.raw`application:
    mapping:
        Api: [App\Api, '', *Presenter]`;

    expect(nettePresenterMappingsFromNeonSource(scalar)).toEqual([
      {
        module: "*",
        moduleMask: "*Module",
        namespace: "App\\",
        presenterMask: "Presenters\\*Presenter",
      },
    ]);
    expect(nettePresenterMappingsFromNeonSource(tuple)).toEqual([
      {
        module: "Api",
        moduleMask: "",
        namespace: "App\\Api\\",
        presenterMask: "*Presenter",
      },
    ]);
  });
});

describe("loadNettePresenterMappings", () => {
  it("merges the NEON baseline with bounded static PHP setMapping results", async () => {
    const readFileContent = vi.fn(async (path: string) => {
      if (path.endsWith("config.neon")) {
        return String.raw`application:
    mapping:
        *: Crm\*Module\Presenters\*Presenter`;
      }

      return String.raw`<?php
use Nette\Application\IPresenterFactory;
class Extension extends CompilerExtension {
$presenterFactory = $builder->getByType(IPresenterFactory::class);
$definition->addSetup('setMapping', [[
    'O2Integration' => 'Crm\O2IntegrationModule\Presenters\*Presenter',
    'EfabricaPayments' => 'Efabrica\Crm\EfabricaPaymentsModule\Presenters\*Presenter',
]]);`;
    });
    const searchText = vi.fn(async (_root: string, query: string) =>
      query === "application:"
        ? [{ path: `${ROOT}/app/config/config.neon` }]
        : [{ path: `${ROOT}/app/modules/DI/Extension.php` }],
    );
    const context = makeContext({ readFileContent, searchText });
    const first = await loadNettePresenterMappings(context);
    const second = await loadNettePresenterMappings(context);

    expect(first.map((mapping) => mapping.module)).toEqual([
      "*",
      "EfabricaPayments",
      "O2Integration",
    ]);
    expect(second).toBe(first);
    expect(searchText).toHaveBeenCalledWith(ROOT, "application:", 120);
    expect(searchText).toHaveBeenCalledWith(ROOT, "setMapping", 120);
    expect(searchText).toHaveBeenCalledTimes(2);
  });

  it("preserves conflicting declarations independently of result order", async () => {
    const paths = [`${ROOT}/b.neon`, `${ROOT}/a.neon`];
    const readFileContent = vi.fn(async (path: string) =>
      path.endsWith("a.neon")
        ? String.raw`application:
    mapping:
        Api: App\Api\*Presenter`
        : String.raw`application:
    mapping:
        Api: Vendor\Api\*Presenter`,
    );
    const context = makeContext({
      readFileContent,
      searchText: vi.fn(async (_root, query) =>
        query === "application:" ? paths.map((path) => ({ path })) : [],
      ),
    });
    const mappings = await loadNettePresenterMappings(context);

    expect(mappings).toEqual([
      {
        module: "Api",
        moduleMask: "*Module",
        namespace: "App\\Api\\",
        presenterMask: "*Presenter",
      },
      {
        module: "Api",
        moduleMask: "*Module",
        namespace: "Vendor\\Api\\",
        presenterMask: "*Presenter",
      },
    ]);
  });

  it("shares in-flight work and fences a stale cache write after invalidation", async () => {
    let releaseSearch!: () => void;
    const searchGate = new Promise<void>((resolve) => {
      releaseSearch = resolve;
    });
    const context = makeContext({
      searchText: vi.fn(async () => {
        await searchGate;
        return [];
      }),
    });
    const first = loadNettePresenterMappings(context);
    const second = loadNettePresenterMappings(context);

    expect(context.deps.searchText).toHaveBeenCalledTimes(1);
    invalidateNettePresenterMappingsForPath(
      context.cache,
      context.inFlight,
      context.generation,
      ROOT,
      `${ROOT}/app/config/config.neon`,
    );
    releaseSearch();
    const [firstResult, secondResult] = await Promise.all([first, second]);

    expect(secondResult).toBe(firstResult);
    expect(context.deps.searchText).toHaveBeenCalledTimes(2);
    expect(context.cache).toEqual({});
  });

  it("normalizes root keys and evicts inactive root state", async () => {
    const context = makeContext({ requestedRoot: `${ROOT}/` });
    await loadNettePresenterMappings(context);

    expect(Object.keys(context.cache)).toEqual([ROOT]);
    evictOtherRootPresenterMappingEntries(
      context.cache,
      context.inFlight,
      context.generation,
      "/workspace/other",
    );

    expect(context.cache).toEqual({});
    expect(context.inFlight.size).toBe(0);
    expect(context.generation.roots).toEqual({});
  });
});

function makeContext(
  overrides: Partial<NettePresenterMappingDiscoveryContext["deps"]> & {
    requestedRoot?: string;
  } = {},
): NettePresenterMappingDiscoveryContext {
  return {
    cache: {},
    deps: {
      readFileContent: overrides.readFileContent ?? vi.fn(async () => ""),
      searchText: overrides.searchText ?? vi.fn(async () => []),
    },
    generation: createNettePresenterMappingGeneration(),
    inFlight: new Map(),
    isRequestedRootActive: () => true,
    maxSearchResults: 120,
    requestedRoot: overrides.requestedRoot ?? ROOT,
    ttlMs: 5_000,
  };
}
