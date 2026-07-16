import { describe, expect, it, vi } from "vitest";
import {
  createNetteFactoryTemplateOwnerGeneration,
  evictOtherRootNetteFactoryTemplateOwnerEntries,
  invalidateNetteFactoryTemplateOwnersForPath,
  isNetteFactoryTemplateOwnerDependencyPath,
  loadNetteFactoryTemplateOwner,
  type NetteFactoryTemplateOwnerDiscoveryContext,
} from "./netteFactoryTemplateOwners";

const ROOT = "/workspace/project";
const FACTORY = `${ROOT}/app/Notifications/NotificationsGridFactory.php`;
const OWNER = `${ROOT}/vendor/ublaboo/datagrid/src/DataGrid.php`;
const TEMPLATE = "app/Notifications/datagrid.latte";

const notificationFactory = String.raw`<?php
namespace App\Notifications;
use Ublaboo\DataGrid\DataGrid as UblabooDatagrid;
final class NotificationsGridFactory {
    public function create(): UblabooDatagrid {
        $grid = new UblabooDatagrid();
        $grid->setTemplateFile(__DIR__ . '/datagrid.latte');
        return $grid;
    }
}`;

const ownerSource = String.raw`<?php
namespace Ublaboo\DataGrid;
class DataGrid {}`;

describe("loadNetteFactoryTemplateOwner", () => {
  it("resolves the imported owner source and records dependencies", async () => {
    const context = makeContext();
    const first = await loadNetteFactoryTemplateOwner(context, TEMPLATE);
    const second = await loadNetteFactoryTemplateOwner(context, TEMPLATE);

    expect(first).toEqual({
      className: "Ublaboo\\DataGrid\\DataGrid",
      dependencyPaths: [FACTORY, OWNER].sort(),
      factoryPaths: [FACTORY],
      path: OWNER,
      source: ownerSource,
    });
    expect(second).toBe(first);
    expect(context.deps.searchText).toHaveBeenCalledWith(
      ROOT,
      "datagrid.latte",
      80,
    );
    expect(context.deps.searchText).toHaveBeenCalledTimes(1);
    expect(
      isNetteFactoryTemplateOwnerDependencyPath(context.cache, ROOT, FACTORY),
    ).toBe(true);
    expect(
      isNetteFactoryTemplateOwnerDependencyPath(context.cache, ROOT, OWNER),
    ).toBe(true);
  });

  it("accepts multiple factories only when they resolve to the same owner", async () => {
    const secondFactory = `${ROOT}/app/Legacy/NotificationsGridFactory.php`;
    const context = makeContext({
      searchText: vi.fn(async () => [
        { path: FACTORY },
        { path: secondFactory },
      ]),
      readFileContent: vi.fn(async (path) => {
        if (path === OWNER) {
          return ownerSource;
        }

        return path === secondFactory
          ? notificationFactory.replace(
              "__DIR__ . '/datagrid.latte'",
              "'app/Notifications/datagrid.latte'",
            )
          : notificationFactory;
      }),
    });

    const owner = await loadNetteFactoryTemplateOwner(context, TEMPLATE);

    expect(owner?.className).toBe("Ublaboo\\DataGrid\\DataGrid");
    expect(owner?.factoryPaths).toEqual([FACTORY, secondFactory].sort());
  });

  it("does not correlate a slashless literal by basename alone", async () => {
    const resolvePhpClassSourcePaths = vi.fn(async () => [OWNER]);
    const context = makeContext({
      readFileContent: vi.fn(async (path) => {
        if (path === FACTORY) {
          return notificationFactory.replace(
            "__DIR__ . '/datagrid.latte'",
            "'datagrid.latte'",
          );
        }

        return ownerSource;
      }),
      resolvePhpClassSourcePaths,
    });

    await expect(
      loadNetteFactoryTemplateOwner(
        context,
        "app/Unrelated/datagrid.latte",
      ),
    ).resolves.toBeNull();
    expect(resolvePhpClassSourcePaths).not.toHaveBeenCalled();
  });

  it("correlates a rooted literal only to the exact absolute target", async () => {
    const context = makeContext({
      readFileContent: vi.fn(async (path) => {
        if (path === FACTORY) {
          return notificationFactory.replace(
            "__DIR__ . '/datagrid.latte'",
            "'app/Notifications/datagrid.latte'",
          );
        }

        return ownerSource;
      }),
    });

    await expect(
      loadNetteFactoryTemplateOwner(
        context,
        `${ROOT}/app/Notifications/datagrid.latte`,
      ),
    ).resolves.toEqual(
      expect.objectContaining({ className: "Ublaboo\\DataGrid\\DataGrid" }),
    );
  });

  it("never reads a search result that lexically escapes the root", async () => {
    const readFileContent = vi.fn(async () => {
      throw new Error("outside search result must not be read");
    });
    const context = makeContext({
      readFileContent,
      searchText: vi.fn(async () => [
        { path: `${ROOT}/app/../../outside/EvilFactory.php` },
      ]),
    });

    await expect(
      loadNetteFactoryTemplateOwner(context, TEMPLATE),
    ).resolves.toBeNull();
    expect(readFileContent).not.toHaveBeenCalled();
  });

  it("never reads a resolved owner source that lexically escapes the root", async () => {
    const outsideOwner = `${ROOT}/vendor/../../../outside/DataGrid.php`;
    const readFileContent = vi.fn(async (path: string) => {
      if (path === FACTORY) {
        return notificationFactory;
      }

      throw new Error("outside owner must not be read");
    });
    const context = makeContext({
      readFileContent,
      resolvePhpClassSourcePaths: vi.fn(async () => [outsideOwner]),
    });

    await expect(
      loadNetteFactoryTemplateOwner(context, TEMPLATE),
    ).resolves.toBeNull();
    expect(readFileContent).toHaveBeenCalledTimes(1);
    expect(readFileContent).toHaveBeenCalledWith(FACTORY);
  });

  it("rejects distinct owners and ambiguous owner source paths", async () => {
    const adyenFactory = `${ROOT}/app/Payments/AdyenFactory.php`;
    const distinct = makeContext({
      searchText: vi.fn(async () => [
        { path: FACTORY },
        { path: adyenFactory },
      ]),
      readFileContent: vi.fn(async (path) => {
        if (path === FACTORY) {
          return notificationFactory;
        }

        return String.raw`<?php
namespace App\Payments;
class AdyenFactory {
    public function create() {
        $control = new \App\Payments\AdyenControl();
        $control->setTemplateFile('app/Notifications/datagrid.latte');
        return $control;
    }
}`;
      }),
    });
    const ambiguous = makeContext({
      resolvePhpClassSourcePaths: vi.fn(async () => [OWNER, `${ROOT}/copy/DataGrid.php`]),
    });

    await expect(
      loadNetteFactoryTemplateOwner(distinct, TEMPLATE),
    ).resolves.toBeNull();
    await expect(
      loadNetteFactoryTemplateOwner(ambiguous, TEMPLATE),
    ).resolves.toBeNull();
  });

  it("shares in-flight work and fences cache writes after invalidation", async () => {
    let releaseSearch!: () => void;
    const searchGate = new Promise<void>((resolve) => {
      releaseSearch = resolve;
    });
    const context = makeContext({
      searchText: vi.fn(async () => {
        await searchGate;
        return [{ path: FACTORY }];
      }),
    });
    const first = loadNetteFactoryTemplateOwner(context, TEMPLATE);
    const second = loadNetteFactoryTemplateOwner(context, TEMPLATE);

    expect(context.deps.searchText).toHaveBeenCalledTimes(1);
    invalidateNetteFactoryTemplateOwnersForPath(
      context.cache,
      context.inFlight,
      context.generation,
      ROOT,
      FACTORY,
    );
    releaseSearch();

    const [firstOwner, secondOwner] = await Promise.all([first, second]);

    expect(firstOwner).toBeNull();
    expect(secondOwner).toBeNull();
    expect(context.cache).toEqual({});
  });

  it("drops stale-root work and evicts inactive normalized roots", async () => {
    let active = true;
    const context = makeContext({
      isRequestedRootActive: () => active,
      searchText: vi.fn(async () => {
        active = false;
        return [{ path: FACTORY }];
      }),
    });

    await expect(
      loadNetteFactoryTemplateOwner(context, TEMPLATE),
    ).resolves.toBeNull();
    expect(context.cache).toEqual({});

    const populated = makeContext({ requestedRoot: `${ROOT}/` });
    await loadNetteFactoryTemplateOwner(populated, TEMPLATE);
    evictOtherRootNetteFactoryTemplateOwnerEntries(
      populated.cache,
      populated.inFlight,
      populated.generation,
      "/workspace/other",
    );

    expect(populated.cache).toEqual({});
    expect(populated.inFlight.size).toBe(0);
    expect(populated.generation.roots).toEqual({});
  });

  it("does not return a cached owner after the requested root becomes inactive", async () => {
    let active = true;
    const context = makeContext({ isRequestedRootActive: () => active });
    const cached = await loadNetteFactoryTemplateOwner(context, TEMPLATE);

    expect(cached?.className).toBe("Ublaboo\\DataGrid\\DataGrid");
    active = false;

    await expect(
      loadNetteFactoryTemplateOwner(context, TEMPLATE),
    ).resolves.toBeNull();
    expect(context.deps.searchText).toHaveBeenCalledTimes(1);
  });

  it("keeps each cached target's original TTL when another target is scanned", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));

    try {
      const context = makeContext();
      context.ttlMs = 100;

      await loadNetteFactoryTemplateOwner(context, TEMPLATE);
      vi.advanceTimersByTime(90);
      await loadNetteFactoryTemplateOwner(
        context,
        "app/Notifications/other.latte",
      );
      vi.advanceTimersByTime(20);
      await loadNetteFactoryTemplateOwner(context, TEMPLATE);

      expect(context.deps.searchText).toHaveBeenCalledTimes(3);
    } finally {
      vi.useRealTimers();
    }
  });
});

function makeContext(
  overrides: Partial<NetteFactoryTemplateOwnerDiscoveryContext["deps"]> & {
    isRequestedRootActive?: () => boolean;
    requestedRoot?: string;
  } = {},
): NetteFactoryTemplateOwnerDiscoveryContext {
  return {
    cache: {},
    deps: {
      readFileContent:
        overrides.readFileContent ??
        vi.fn(async (path: string) => {
          if (path === FACTORY) {
            return notificationFactory;
          }

          if (path === OWNER) {
            return ownerSource;
          }

          throw new Error(`Unexpected path: ${path}`);
        }),
      resolvePhpClassSourcePaths:
        overrides.resolvePhpClassSourcePaths ?? vi.fn(async () => [OWNER]),
      searchText:
        overrides.searchText ?? vi.fn(async () => [{ path: FACTORY }]),
    },
    generation: createNetteFactoryTemplateOwnerGeneration(),
    inFlight: new Map(),
    isRequestedRootActive:
      overrides.isRequestedRootActive ?? (() => true),
    maxSearchResults: 80,
    requestedRoot: overrides.requestedRoot ?? ROOT,
    ttlMs: 5_000,
  };
}
