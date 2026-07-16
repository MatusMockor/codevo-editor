import { describe, expect, it, vi } from "vitest";
import type { NetteControlDependencies } from "./netteControlContracts";
import {
  aggregateNetteFactoryTemplateOwnerLifecycleMembers,
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

    expect(hierarchy?.precedence).toBeNull();
    expect(
      findNetteFactoryTemplateOwnerMethodSource(hierarchy!, "beforeRender"),
    ).toBeNull();
    expect(
      aggregateNetteFactoryTemplateOwnerLifecycleMembers(hierarchy!),
    ).toBeNull();
  });

  it("does not use owner methods when its declared parent is unloaded", async () => {
    const hierarchy = await loadNetteFactoryTemplateOwnerHierarchy(
      makeContext({
        ownerSource: `<?php
class Widget extends MissingBase {
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

  it("marks ancestry beyond the helper depth bound incomplete", async () => {
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
    expect(hierarchy?.precedence).toBeNull();
    expect(
      findNetteFactoryTemplateOwnerMethodSource(hierarchy!, "startup"),
    ).toBeNull();
    expect(
      aggregateNetteFactoryTemplateOwnerLifecycleMembers(hierarchy!),
    ).toBeNull();
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
    ownerSource?: string;
    readPhpClassSource?: NetteControlDependencies["readPhpClassSource"];
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
      resolveDeclaredType: (_source, typeHint) => typeHint,
    },
    isRequestedRootActive:
      overrides.isRequestedRootActive ?? (() => true),
    loadOwner:
      overrides.loadOwner ??
      vi.fn(async () => ({
        ...owner,
        source: overrides.ownerSource ?? owner.source,
      })),
  };
}
