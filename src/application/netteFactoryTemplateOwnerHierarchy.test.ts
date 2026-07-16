import { describe, expect, it, vi } from "vitest";
import type { NetteControlDependencies } from "./netteControlContracts";
import {
  aggregateNetteFactoryTemplateOwnerLifecycleMembers,
  canProveNetteFactoryTemplateOwnerMethodAbsence,
  findNetteFactoryTemplateOwnerMethodSource,
  loadNetteFactoryTemplateOwnerHierarchy,
  type NetteFactoryTemplateOwnerHierarchyContext,
} from "./netteFactoryTemplateOwnerHierarchy";
import type { NetteFactoryTemplateOwner } from "./netteFactoryTemplateOwners";

const TEMPLATE = "templates/widget.latte";
const OWNER_PATH = "/project/src/Widget.php";
const TRAIT_PATH = "/project/src/WidgetActions.php";
const PARENT_PATH = "/project/src/BaseWidget.php";
const NESTED_TRAIT_PATH = "/project/src/AuditActions.php";
const SECOND_TRAIT_PATH = "/project/src/SecondaryActions.php";

const ownerSource = `<?php
class Widget extends BaseWidget {
  use WidgetActions;
  public function startup(): void {}
  public function renderDetail(): void {}
}`;
const traitSource = `<?php
trait WidgetActions {
  use AuditActions;
  public function handleSave(): void {}
}`;
const parentSource = `<?php
class BaseWidget {
  public function startup(): void {}
  protected function beforeRender(): void {}
  public function injectLogger(): void {}
}`;
const nestedTraitSource = `<?php
trait AuditActions {
  public function injectLogger(): void {}
}`;

const owner: NetteFactoryTemplateOwner = {
  className: "App\\Widget",
  dependencyPaths: [OWNER_PATH],
  factoryPaths: ["/project/src/WidgetFactory.php"],
  path: OWNER_PATH,
  source: ownerSource,
};

describe("Nette factory template owner hierarchy", () => {
  it("loads owner first and preserves the ancestry helper traversal order", async () => {
    const context = makeContext();
    const hierarchy = await loadNetteFactoryTemplateOwnerHierarchy(
      context,
      TEMPLATE,
    );

    expect(hierarchy?.sources.map((source) => source.path)).toEqual([
      OWNER_PATH,
      TRAIT_PATH,
      PARENT_PATH,
      NESTED_TRAIT_PATH,
    ]);
    expect(context.loadOwner).toHaveBeenCalledWith(TEMPLATE);
  });

  it("finds the nearest exact method declaration case-insensitively", async () => {
    const hierarchy = await loadNetteFactoryTemplateOwnerHierarchy(
      makeContext(),
      TEMPLATE,
    );

    expect(hierarchy).not.toBeNull();
    expect(
      findNetteFactoryTemplateOwnerMethodSource(hierarchy!, "STARTUP")?.source
        .path,
    ).toBe(OWNER_PATH);
    expect(
      findNetteFactoryTemplateOwnerMethodSource(hierarchy!, "beforeRender")
        ?.source.path,
    ).toBe(PARENT_PATH);
    expect(
      findNetteFactoryTemplateOwnerMethodSource(hierarchy!, "not valid()"),
    ).toBeNull();
  });

  it("gives a nested trait precedence over an earlier BFS parent", async () => {
    const hierarchy = await loadNetteFactoryTemplateOwnerHierarchy(
      makeContext(),
      TEMPLATE,
    );

    expect(hierarchy?.sources.map((source) => source.path)).toEqual([
      OWNER_PATH,
      TRAIT_PATH,
      PARENT_PATH,
      NESTED_TRAIT_PATH,
    ]);
    expect(
      findNetteFactoryTemplateOwnerMethodSource(hierarchy!, "injectLogger")
        ?.source.path,
    ).toBe(NESTED_TRAIT_PATH);
  });

  it("aggregates lifecycle members once using hierarchy precedence", async () => {
    const hierarchy = await loadNetteFactoryTemplateOwnerHierarchy(
      makeContext(),
      TEMPLATE,
    );
    const members = aggregateNetteFactoryTemplateOwnerLifecycleMembers(
      hierarchy!,
    );

    expect(
      members?.map((entry) => [entry.lifecycle.methodName, entry.source.path]),
    ).toEqual([
      ["startup", OWNER_PATH],
      ["renderDetail", OWNER_PATH],
      ["handleSave", TRAIT_PATH],
      ["injectLogger", NESTED_TRAIT_PATH],
      ["beforeRender", PARENT_PATH],
    ]);
  });

  it("fails closed when sibling traits declare the same method", async () => {
    const collidingOwnerSource = `<?php
class Widget extends BaseWidget {
  use WidgetActions, SecondaryActions;
}`;
    const secondaryTraitSource = `<?php
trait SecondaryActions {
  public function handleSave(): void {}
}`;
    const hierarchy = await loadNetteFactoryTemplateOwnerHierarchy(
      makeContext({
        ownerSource: collidingOwnerSource,
        sources: {
          SecondaryActions: {
            path: SECOND_TRAIT_PATH,
            source: secondaryTraitSource,
          },
        },
      }),
      TEMPLATE,
    );

    expect(hierarchy).not.toBeNull();
    expect(
      findNetteFactoryTemplateOwnerMethodSource(hierarchy!, "handleSave"),
    ).toBeNull();
    expect(
      aggregateNetteFactoryTemplateOwnerLifecycleMembers(hierarchy!),
    ).toBeNull();
  });

  it("fails closed for unmodeled insteadof trait adaptation", async () => {
    const adaptedOwnerSource = `<?php
class Widget extends BaseWidget {
  use WidgetActions, SecondaryActions {
    WidgetActions::handleSave insteadof SecondaryActions;
  }
}`;
    const secondaryTraitSource = `<?php
trait SecondaryActions {
  public function handleSave(): void {}
}`;
    const hierarchy = await loadNetteFactoryTemplateOwnerHierarchy(
      makeContext({
        ownerSource: adaptedOwnerSource,
        sources: {
          SecondaryActions: {
            path: SECOND_TRAIT_PATH,
            source: secondaryTraitSource,
          },
        },
      }),
      TEMPLATE,
    );

    expect(hierarchy).not.toBeNull();
    expect(
      findNetteFactoryTemplateOwnerMethodSource(hierarchy!, "handleSave"),
    ).toBeNull();
    expect(
      findNetteFactoryTemplateOwnerMethodSource(hierarchy!, "injectLogger"),
    ).toBeNull();
    expect(
      aggregateNetteFactoryTemplateOwnerLifecycleMembers(hierarchy!),
    ).toBeNull();
  });

  it("fails closed for an exact trait method alias adaptation", async () => {
    const hierarchy = await loadNetteFactoryTemplateOwnerHierarchy(
      makeContext({
        ownerSource: `<?php
class Widget extends BaseWidget {
  use WidgetActions {
    WidgetActions::handleSave as save;
  }
  public function startup(): void {}
}`,
      }),
      TEMPLATE,
    );

    expect(hierarchy?.precedence).toBeNull();
    expect(
      findNetteFactoryTemplateOwnerMethodSource(hierarchy!, "startup"),
    ).toBeNull();
    expect(
      aggregateNetteFactoryTemplateOwnerLifecycleMembers(hierarchy!),
    ).toBeNull();
  });

  it("fails closed for an exact trait visibility adaptation", async () => {
    const hierarchy = await loadNetteFactoryTemplateOwnerHierarchy(
      makeContext({
        ownerSource: `<?php
class Widget extends BaseWidget {
  use WidgetActions {
    WidgetActions::handleSave as private;
  }
  public function startup(): void {}
}`,
      }),
      TEMPLATE,
    );

    expect(hierarchy?.precedence).toBeNull();
    expect(
      findNetteFactoryTemplateOwnerMethodSource(hierarchy!, "startup"),
    ).toBeNull();
    expect(
      aggregateNetteFactoryTemplateOwnerLifecycleMembers(hierarchy!),
    ).toBeNull();
  });

  it("does not fall through an unloaded declared trait", async () => {
    const hierarchy = await loadNetteFactoryTemplateOwnerHierarchy(
      makeContext({
        ownerSource: `<?php
class Widget extends BaseWidget {
  use MissingActions;
}`,
      }),
      TEMPLATE,
    );

    expect(hierarchy?.precedence).not.toBeNull();
    expect(
      findNetteFactoryTemplateOwnerMethodSource(hierarchy!, "beforeRender"),
    ).toBeNull();
    expect(
      aggregateNetteFactoryTemplateOwnerLifecycleMembers(hierarchy!),
    ).toEqual([]);
    expect(
      canProveNetteFactoryTemplateOwnerMethodAbsence(hierarchy!, [
        "beforeRender",
      ]),
    ).toBe(false);
  });

  it("keeps owner methods safe when its declared parent is unloaded", async () => {
    const hierarchy = await loadNetteFactoryTemplateOwnerHierarchy(
      makeContext({
        ownerSource: `<?php
class Widget extends MissingBase {
  public function startup(): void {}
}`,
      }),
      TEMPLATE,
    );

    expect(hierarchy?.precedence).not.toBeNull();
    expect(
      findNetteFactoryTemplateOwnerMethodSource(hierarchy!, "startup")?.source
        .path,
    ).toBe(OWNER_PATH);
    expect(
      aggregateNetteFactoryTemplateOwnerLifecycleMembers(hierarchy!)?.map(
        (entry) => entry.lifecycle.methodName,
      ),
    ).toEqual(["startup"]);
  });

  it("resolves an owner method in a synthetic depth-bound fixture", async () => {
    const deepSources = Object.fromEntries(
      Array.from({ length: 5 }, (_, index) => {
        const level = index + 1;
        return [
          `Level${level}`,
          {
            path: `/project/src/Level${level}.php`,
            source: `<?php class Level${level} extends Level${level + 1} {}`,
          },
        ];
      }),
    );
    const hierarchy = await loadNetteFactoryTemplateOwnerHierarchy(
      makeContext({
        ownerSource: `<?php
class Widget extends Level1 {
  public function startup(): void {}
}`,
        sources: deepSources,
      }),
      TEMPLATE,
    );

    expect(hierarchy?.sources).toHaveLength(6);
    expect(hierarchy?.precedence).not.toBeNull();
    expect(
      findNetteFactoryTemplateOwnerMethodSource(hierarchy!, "startup")?.source
        .path,
    ).toBe(OWNER_PATH);
    expect(
      aggregateNetteFactoryTemplateOwnerLifecycleMembers(hierarchy!)?.map(
        (entry) => entry.lifecycle.methodName,
      ),
    ).toEqual(["startup"]);
    expect(
      canProveNetteFactoryTemplateOwnerMethodAbsence(hierarchy!, [
        "handleUnknown",
      ]),
    ).toBe(false);
  });

  it("matches the ebox Ublaboo DataGrid and Nette package hierarchy", async () => {
    const packageSources = eboxDataGridPackageSources();
    const hierarchy = await loadNetteFactoryTemplateOwnerHierarchy(
      makeContext({
        ownerSource: String.raw`<?php
namespace App\Components;
class UblabooDatagrid extends \Ublaboo\DataGrid\DataGrid {}`,
        owner: {
          ...owner,
          className: "App\\Components\\UblabooDatagrid",
          path: "/project/app/Components/UblabooDatagrid.php",
        },
        resolveDeclaredType: packageClassName,
        sources: packageSources,
      }),
      TEMPLATE,
    );

    expect(hierarchy?.sources.map((source) => source.path)).toEqual([
      "/project/app/Components/UblabooDatagrid.php",
      packageSources["Ublaboo\\DataGrid\\DataGrid"]?.path,
      packageSources[
        "Ublaboo\\DataGrid\\AggregationFunction\\TDataGridAggregationFunction"
      ]?.path,
      packageSources["Nette\\Application\\UI\\Control"]?.path,
      packageSources["Nette\\Application\\UI\\Component"]?.path,
      packageSources["Nette\\ComponentModel\\ArrayAccess"]?.path,
      packageSources["Nette\\ComponentModel\\Container"]?.path,
      packageSources["Nette\\ComponentModel\\Component"]?.path,
    ]);
    expect(
      findNetteFactoryTemplateOwnerMethodSource(hierarchy!, "handlePage")
        ?.source.path,
    ).toBe(packageSources["Ublaboo\\DataGrid\\DataGrid"]?.path);
    expect(
      findNetteFactoryTemplateOwnerMethodSource(hierarchy!, "isPaginated")
        ?.source.path,
    ).toBe(packageSources["Ublaboo\\DataGrid\\DataGrid"]?.path);
    expect(
      aggregateNetteFactoryTemplateOwnerLifecycleMembers(hierarchy!)?.map(
        (entry) => entry.lifecycle.methodName,
      ),
    ).toContain("handlePage");
    expect(
      canProveNetteFactoryTemplateOwnerMethodAbsence(hierarchy!, [
        "handleUnknown",
      ]),
    ).toBe(false);
  });

  it("proves absence only across a complete hierarchy", async () => {
    const hierarchy = await loadNetteFactoryTemplateOwnerHierarchy(
      makeContext({
        ownerSource: `<?php
class Widget {
  public function handlePage(): void {}
}`,
      }),
      TEMPLATE,
    );

    expect(
      canProveNetteFactoryTemplateOwnerMethodAbsence(hierarchy!, [
        "handlePage",
      ]),
    ).toBe(false);
    expect(
      canProveNetteFactoryTemplateOwnerMethodAbsence(hierarchy!, [
        "handleMissing",
        "renderMissing",
      ]),
    ).toBe(true);
  });

  it("ignores ambiguous source files for method and lifecycle queries", () => {
    const ambiguous = `<?php
class First { public function startup(): void {} }
class Second { public function renderDetail(): void {} }`;
    const hierarchy = {
      owner: { ...owner, source: ambiguous },
      precedence: null,
      sources: [
        { path: OWNER_PATH, source: ambiguous },
        { path: PARENT_PATH, source: parentSource },
      ],
    };

    expect(
      findNetteFactoryTemplateOwnerMethodSource(hierarchy, "startup"),
    ).toBeNull();
    expect(
      aggregateNetteFactoryTemplateOwnerLifecycleMembers(hierarchy),
    ).toBeNull();
  });

  it("drops the hierarchy when the requested root becomes stale", async () => {
    let active = true;
    const context = makeContext({
      isRequestedRootActive: () => active,
      readPhpClassSource: vi.fn(async () => {
        active = false;
        return { path: TRAIT_PATH, source: traitSource };
      }),
    });

    await expect(
      loadNetteFactoryTemplateOwnerHierarchy(context, TEMPLATE),
    ).resolves.toBeNull();
  });

  it("does not traverse when owner discovery is absent or already stale", async () => {
    const missing = makeContext({ loadOwner: vi.fn(async () => null) });
    const stale = makeContext({ isRequestedRootActive: () => false });

    await expect(
      loadNetteFactoryTemplateOwnerHierarchy(missing, TEMPLATE),
    ).resolves.toBeNull();
    await expect(
      loadNetteFactoryTemplateOwnerHierarchy(stale, TEMPLATE),
    ).resolves.toBeNull();
    expect(missing.deps.readPhpClassSource).not.toHaveBeenCalled();
    expect(stale.loadOwner).not.toHaveBeenCalled();
  });
});

function makeContext(
  overrides: {
    isRequestedRootActive?: () => boolean;
    loadOwner?: NetteFactoryTemplateOwnerHierarchyContext["loadOwner"];
    owner?: NetteFactoryTemplateOwner;
    ownerSource?: string;
    readPhpClassSource?: NetteControlDependencies["readPhpClassSource"];
    resolveDeclaredType?: NetteControlDependencies["resolveDeclaredType"];
    sources?: Record<string, { path: string; source: string }>;
  } = {},
): NetteFactoryTemplateOwnerHierarchyContext {
  const sources: Record<string, { path: string; source: string }> = {
    AuditActions: { path: NESTED_TRAIT_PATH, source: nestedTraitSource },
    BaseWidget: { path: PARENT_PATH, source: parentSource },
    WidgetActions: { path: TRAIT_PATH, source: traitSource },
    ...overrides.sources,
  };

  return {
    deps: {
      joinPath: (...parts) => parts.join("/"),
      openPhpMethodTarget: vi.fn(async () => false),
      openTarget: vi.fn(async () => false),
      readFileContent: vi.fn(async () => ""),
      readPhpClassSource:
        overrides.readPhpClassSource ??
        vi.fn(async (className: string) => sources[className] ?? null),
      resolveDeclaredType:
        overrides.resolveDeclaredType ?? ((_source, typeHint) => typeHint),
    },
    isRequestedRootActive:
      overrides.isRequestedRootActive ?? (() => true),
    loadOwner:
      overrides.loadOwner ??
      vi.fn(async () => ({
        ...(overrides.owner ?? owner),
        source: overrides.ownerSource ?? owner.source,
      })),
  };
}

function eboxDataGridPackageSources(): Record<
  string,
  { path: string; source: string }
> {
  return {
    "Nette\\Application\\UI\\Component": {
      path: "/project/vendor/nette/application/src/Application/UI/Component.php",
      source: String.raw`<?php
namespace Nette\Application\UI;
abstract class Component extends \Nette\ComponentModel\Container {
  use \Nette\ComponentModel\ArrayAccess;
}`,
    },
    "Nette\\Application\\UI\\Control": {
      path: "/project/vendor/nette/application/src/Application/UI/Control.php",
      source: String.raw`<?php
namespace Nette\Application\UI;
abstract class Control extends Component {}`,
    },
    "Nette\\ComponentModel\\ArrayAccess": {
      path: "/project/vendor/nette/component-model/src/ComponentModel/ArrayAccess.php",
      source: String.raw`<?php
namespace Nette\ComponentModel;
trait ArrayAccess {}`,
    },
    "Nette\\ComponentModel\\Component": {
      path: "/project/vendor/nette/component-model/src/ComponentModel/Component.php",
      source: String.raw`<?php
namespace Nette\ComponentModel;
abstract class Component { use \Nette\SmartObject; }`,
    },
    "Nette\\ComponentModel\\Container": {
      path: "/project/vendor/nette/component-model/src/ComponentModel/Container.php",
      source: String.raw`<?php
namespace Nette\ComponentModel;
class Container extends Component {}`,
    },
    "Ublaboo\\DataGrid\\AggregationFunction\\TDataGridAggregationFunction": {
      path:
        "/project/vendor/ublaboo/datagrid/src/AggregationFunction/TDataGridAggregationFunction.php",
      source: String.raw`<?php
namespace Ublaboo\DataGrid\AggregationFunction;
trait TDataGridAggregationFunction {}`,
    },
    "Ublaboo\\DataGrid\\DataGrid": {
      path: "/project/vendor/ublaboo/datagrid/src/DataGrid.php",
      source: String.raw`<?php
namespace Ublaboo\DataGrid;
use Nette\Application\UI\Control;
use Ublaboo\DataGrid\AggregationFunction\TDataGridAggregationFunction;
class DataGrid extends Control {
  use TDataGridAggregationFunction;
  public function handlePage(int $page): void {}
  public function isPaginated(): bool { return true; }
}`,
    },
  };
}

function packageClassName(source: string, typeHint: string | null): string | null {
  if (!typeHint) {
    return null;
  }

  const normalized = typeHint.replace(/^\\+/, "");

  if (normalized.includes("\\")) {
    return normalized;
  }

  if (source.includes("namespace App\\Components")) {
    return normalized === "UblabooDatagrid"
      ? "App\\Components\\UblabooDatagrid"
      : normalized;
  }

  if (source.includes("namespace Ublaboo\\DataGrid\\AggregationFunction")) {
    return `Ublaboo\\DataGrid\\AggregationFunction\\${normalized}`;
  }

  if (source.includes("namespace Ublaboo\\DataGrid")) {
    if (normalized === "Control") {
      return "Nette\\Application\\UI\\Control";
    }

    if (normalized === "TDataGridAggregationFunction") {
      return "Ublaboo\\DataGrid\\AggregationFunction\\TDataGridAggregationFunction";
    }

    return `Ublaboo\\DataGrid\\${normalized}`;
  }

  if (source.includes("namespace Nette\\Application\\UI")) {
    return `Nette\\Application\\UI\\${normalized}`;
  }

  if (source.includes("namespace Nette\\ComponentModel")) {
    return `Nette\\ComponentModel\\${normalized}`;
  }

  return normalized;
}
