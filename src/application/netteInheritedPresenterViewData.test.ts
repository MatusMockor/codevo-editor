import { describe, expect, it, vi } from "vitest";
import type { NetteViewDataSourceFacts } from "../domain/netteViewData";
import {
  inheritedPresenterCacheKey,
  loadNetteInheritedPresenterViewData,
  type NetteInheritedPresenterViewDataCache,
  type NetteInheritedPresenterViewDataContext,
  type NetteInheritedPresenterViewDataDependencies,
  type NetteInheritedPresenterViewDataInFlight,
} from "./netteInheritedPresenterViewData";

const ROOT = "/ws";
const TEMPLATE = "app/UI/Order/show.latte";
const PRESENTER = `${ROOT}/app/UI/Order/OrderPresenter.php`;

function presenter(
  name: string,
  body: string,
  parent?: string,
): string {
  return `<?php
namespace App\\UI;
class ${name}Presenter${parent ? ` extends ${parent}Presenter` : ""}
{
${body}
}`;
}

function assign(name: string): string {
  return `$this->template->${name} = $${name};`;
}

function method(name: string, body = ""): string {
  return `    protected function ${name}(): void
    {
        ${body}
    }`;
}

function makeHarness({
  active = () => true,
  classes = {},
  presenterSource = presenter("Order", ""),
  readFileContent,
  resolveDeclaredType,
  root = ROOT,
  templateRelativePath = TEMPLATE,
}: {
  active?: () => boolean;
  classes?: Record<string, { path: string; source: string } | null>;
  presenterSource?: string;
  readFileContent?: NetteInheritedPresenterViewDataDependencies["readFileContent"];
  resolveDeclaredType?: NetteInheritedPresenterViewDataDependencies["resolveDeclaredType"];
  root?: string;
  templateRelativePath?: string;
} = {}) {
  const cache: NetteInheritedPresenterViewDataCache = {};
  const inFlight: NetteInheritedPresenterViewDataInFlight = new Map();
  const deps: NetteInheritedPresenterViewDataDependencies = {
    joinPath: (base, relative) => `${base}/${relative}`,
    readFileContent:
      readFileContent ??
      vi.fn(async (path: string) => {
        if (path === `${root}/${presenterPath(templateRelativePath)}`) {
          return presenterSource;
        }

        throw new Error(`missing ${path}`);
      }),
    readPhpClassSource: vi.fn(async (className: string) => classes[className] ?? null),
    resolveDeclaredType:
      resolveDeclaredType ??
      ((_source, typeHint) =>
        typeHint ? `App\\UI\\${typeHint.replace(/^.*\\\\/, "")}` : null),
  };
  const context: NetteInheritedPresenterViewDataContext = {
    cache,
    deps,
    inFlight,
    isRequestedRootActive: active,
    requestedRoot: root,
    templateRelativePath,
    ttlMs: 5_000,
  };

  return { cache, context, deps, inFlight };
}

function presenterPath(templateRelativePath: string): string {
  const segments = templateRelativePath.split("/");
  segments.pop();
  const owner = segments[segments.length - 1] ?? "";
  return `${segments.join("/")}/${owner}Presenter.php`;
}

function variableNames(
  entries: Awaited<ReturnType<typeof loadNetteInheritedPresenterViewData>>,
): string[] {
  return entries.flatMap((entry) =>
    entry.bindings.flatMap((binding) =>
      binding.variables.map((variable) => variable.name),
    ),
  );
}

function variableWinner(
  entries: Awaited<ReturnType<typeof loadNetteInheritedPresenterViewData>>,
  name: string,
) {
  for (const entry of entries) {
    for (const binding of entry.bindings) {
      const variable = binding.variables.find((candidate) => candidate.name === name);

      if (variable) {
        return { entry, variable };
      }
    }
  }

  return null;
}

describe("loadNetteInheritedPresenterViewData", () => {
  it("dispatches lifecycle methods across multiple presenter levels and rebinds them to the concrete action", async () => {
    const grandSource = presenter(
      "Grand",
      [method("startup", assign("startupValue")), method("renderShow", assign("renderValue"))].join("\n"),
    );
    const baseSource = presenter(
      "Base",
      method("beforeRender", assign("sharedValue")),
      "Grand",
    );
    const childSource = presenter(
      "Order",
      method("actionShow", assign("actionValue")),
      "Base",
    );
    const { context } = makeHarness({
      presenterSource: childSource,
      classes: {
        "App\\UI\\BasePresenter": { path: "/ws/BasePresenter.php", source: baseSource },
        "App\\UI\\GrandPresenter": { path: "/ws/GrandPresenter.php", source: grandSource },
      },
    });

    const entries = await loadNetteInheritedPresenterViewData(context);

    expect(variableNames(entries)).toEqual([
      "$startupValue",
      "$actionValue",
      "$sharedValue",
      "$renderValue",
    ]);
    expect(entries.flatMap((entry) => entry.bindings.map((binding) => binding.viewName)))
      .toEqual(["Order:*", "Order:show", "Order:*", "Order:show"]);
    expect(entries.map((entry) => entry.sourcePath)).toEqual([
      "/ws/GrandPresenter.php",
      PRESENTER,
      "/ws/BasePresenter.php",
      "/ws/GrandPresenter.php",
    ]);
    const inheritedVariable = entries[0]?.bindings[0]?.variables[0];
    expect(entries[0]?.source).toBe(grandSource);
    expect(inheritedVariable?.valueExpression).toBe("$startupValue");
    expect(inheritedVariable?.valueOffset).toBe(
      grandSource.indexOf("$startupValue"),
    );
  });

  it("lets an empty nearest override shadow the inherited method", async () => {
    const parentSource = presenter(
      "Base",
      method("beforeRender", assign("hidden")),
    );
    const { context } = makeHarness({
      presenterSource: presenter("Order", method("beforeRender"), "Base"),
      classes: {
        "App\\UI\\BasePresenter": { path: "/ws/BasePresenter.php", source: parentSource },
      },
    });

    await expect(loadNetteInheritedPresenterViewData(context)).resolves.toEqual([]);
  });

  it("follows an exact parent call through every overriding level", async () => {
    const grandSource = presenter(
      "Grand",
      method("beforeRender", assign("grand")),
    );
    const baseSource = presenter(
      "Base",
      method("beforeRender", `${assign("base")} parent::beforeRender();`),
      "Grand",
    );
    const childSource = presenter(
      "Order",
      method("beforeRender", `${assign("child")} parent::beforeRender();`),
      "Base",
    );
    const { context } = makeHarness({
      presenterSource: childSource,
      classes: {
        "App\\UI\\BasePresenter": { path: "/ws/Base.php", source: baseSource },
        "App\\UI\\GrandPresenter": { path: "/ws/Grand.php", source: grandSource },
      },
    });

    expect(variableNames(await loadNetteInheritedPresenterViewData(context))).toEqual([
      "$child",
      "$base",
      "$grand",
    ]);
  });

  it("resolves the selected secondary presenter parent when a helper class comes first", async () => {
    const childSource = `<?php
namespace App\\UI;
class Helper extends WrongPresenter {}
class OrderPresenter extends BasePresenter {}`;
    const baseSource = presenter("Base", method("startup", assign("base")));
    const { context, deps } = makeHarness({
      presenterSource: childSource,
      classes: {
        "App\\UI\\BasePresenter": { path: "/ws/Base.php", source: baseSource },
      },
    });

    expect(variableNames(await loadNetteInheritedPresenterViewData(context))).toEqual(["$base"]);
    expect(deps.readPhpClassSource).toHaveBeenCalledWith("App\\UI\\BasePresenter");
    expect(deps.readPhpClassSource).not.toHaveBeenCalledWith("App\\UI\\WrongPresenter");
  });

  it("uses the exact secondary presenter at every ancestor level", async () => {
    const baseSource = `<?php
namespace App\\UI;
class Utility extends WrongPresenter {}
class BasePresenter extends GrandPresenter {}`;
    const grandSource = presenter("Grand", method("startup", assign("grand")));
    const { context, deps } = makeHarness({
      presenterSource: presenter("Order", "", "Base"),
      classes: {
        "App\\UI\\BasePresenter": { path: "/ws/Base.php", source: baseSource },
        "App\\UI\\GrandPresenter": { path: "/ws/Grand.php", source: grandSource },
      },
    });

    expect(variableNames(await loadNetteInheritedPresenterViewData(context))).toEqual(["$grand"]);
    expect(deps.readPhpClassSource).toHaveBeenCalledWith("App\\UI\\GrandPresenter");
    expect(deps.readPhpClassSource).not.toHaveBeenCalledWith("App\\UI\\WrongPresenter");
  });

  it("resolves imported and aliased parents from the selected presenter header", async () => {
    const childSource = `<?php
namespace App\\UI;
use App\\Shared\\BasePresenter as SharedBase;
class Helper extends WrongPresenter {}
class OrderPresenter extends SharedBase {}`;
    const baseSource = `<?php
namespace App\\Shared;
class BasePresenter
{
${method("startup", assign("aliased"))}
}`;
    const resolveDeclaredType = vi.fn((_source: string, typeHint: string | null) =>
      typeHint === "SharedBase" ? "App\\Shared\\BasePresenter" : typeHint,
    );
    const { context, deps } = makeHarness({
      presenterSource: childSource,
      resolveDeclaredType,
      classes: {
        "App\\Shared\\BasePresenter": { path: "/ws/SharedBase.php", source: baseSource },
      },
    });

    expect(variableNames(await loadNetteInheritedPresenterViewData(context))).toEqual(["$aliased"]);
    expect(resolveDeclaredType).toHaveBeenCalledWith(childSource, "SharedBase");
    expect(deps.readPhpClassSource).toHaveBeenCalledWith("App\\Shared\\BasePresenter");
  });

  it("does not inherit a preceding helper's parent when the presenter has no parent", async () => {
    const childSource = `<?php
namespace App\\UI;
class Helper extends WrongPresenter {}
class OrderPresenter
{
${method("startup", assign("local"))}
}`;
    const { context, deps } = makeHarness({ presenterSource: childSource });

    expect(variableNames(await loadNetteInheritedPresenterViewData(context))).toEqual(["$local"]);
    expect(deps.readPhpClassSource).not.toHaveBeenCalled();
  });

  it("lets a parent assignment win when the child assignment executes before the parent call", async () => {
    const parentSource = presenter(
      "Base",
      method("beforeRender", "$this->template->shared = $parentValue;"),
    );
    const childSource = presenter(
      "Order",
      method(
        "beforeRender",
        "$this->template->shared = $childValue; parent::beforeRender();",
      ),
      "Base",
    );
    const { context } = makeHarness({
      presenterSource: childSource,
      classes: {
        "App\\UI\\BasePresenter": { path: "/ws/Base.php", source: parentSource },
      },
    });

    const winner = variableWinner(
      await loadNetteInheritedPresenterViewData(context),
      "$shared",
    );
    expect(winner?.entry.sourcePath).toBe("/ws/Base.php");
    expect(winner?.variable.valueExpression).toBe("$parentValue");
    expect(winner?.variable.valueOffset).toBe(parentSource.indexOf("$parentValue"));
  });

  it("lets a child assignment win when it executes after the parent call", async () => {
    const parentSource = presenter(
      "Base",
      method("beforeRender", "$this->template->shared = $parentValue;"),
    );
    const childSource = presenter(
      "Order",
      method(
        "beforeRender",
        "parent::beforeRender(); $this->template->shared = $childValue;",
      ),
      "Base",
    );
    const { context } = makeHarness({
      presenterSource: childSource,
      classes: {
        "App\\UI\\BasePresenter": { path: "/ws/Base.php", source: parentSource },
      },
    });

    const winner = variableWinner(
      await loadNetteInheritedPresenterViewData(context),
      "$shared",
    );
    expect(winner?.entry.sourcePath).toBe(PRESENTER);
    expect(winner?.variable.valueExpression).toBe("$childValue");
    expect(winner?.variable.valueOffset).toBe(childSource.indexOf("$childValue"));
  });

  it("keeps a child same-name assignment when the override does not call parent", async () => {
    const parentSource = presenter(
      "Base",
      method("beforeRender", "$this->template->shared = $parentValue;"),
    );
    const childSource = presenter(
      "Order",
      method("beforeRender", "$this->template->shared = $childValue;"),
      "Base",
    );
    const { context } = makeHarness({
      presenterSource: childSource,
      classes: {
        "App\\UI\\BasePresenter": { path: "/ws/Base.php", source: parentSource },
      },
    });

    const winner = variableWinner(
      await loadNetteInheritedPresenterViewData(context),
      "$shared",
    );
    expect(winner?.entry.sourcePath).toBe(PRESENTER);
    expect(winner?.variable.valueExpression).toBe("$childValue");
  });

  it("preserves runtime winner order through a multi-level parent-call chain", async () => {
    const grandSource = presenter(
      "Grand",
      method("beforeRender", "$this->template->shared = $grandValue;"),
    );
    const baseSource = presenter(
      "Base",
      method(
        "beforeRender",
        "parent::beforeRender(); $this->template->shared = $baseValue;",
      ),
      "Grand",
    );
    const childSource = presenter(
      "Order",
      method(
        "beforeRender",
        "$this->template->shared = $childValue; parent::beforeRender();",
      ),
      "Base",
    );
    const { context } = makeHarness({
      presenterSource: childSource,
      classes: {
        "App\\UI\\BasePresenter": { path: "/ws/Base.php", source: baseSource },
        "App\\UI\\GrandPresenter": { path: "/ws/Grand.php", source: grandSource },
      },
    });

    const winner = variableWinner(
      await loadNetteInheritedPresenterViewData(context),
      "$shared",
    );
    expect(winner?.entry.sourcePath).toBe("/ws/Base.php");
    expect(winner?.variable.valueExpression).toBe("$baseValue");
    expect(winner?.variable.valueOffset).toBe(baseSource.indexOf("$baseValue"));
  });

  it("applies startup, action, beforeRender, render slot order to same-variable winners", async () => {
    const actionSource = presenter(
      "Order",
      method(
        "actionShow",
        "$this->template->afterAction = new ActionType();",
      ),
      "Base",
    );
    const beforeSource = presenter(
      "Base",
      method(
        "beforeRender",
        [
          "$this->template->afterAction = new BeforeActionType();",
          "$this->template->afterBefore = new BeforeRenderType();",
        ].join(" "),
      ),
      "Grand",
    );
    const renderSource = presenter(
      "Grand",
      method(
        "renderShow",
        "$this->template->afterBefore = new RenderType();",
      ),
    );
    const { context } = makeHarness({
      presenterSource: actionSource,
      classes: {
        "App\\UI\\BasePresenter": { path: "/ws/Base.php", source: beforeSource },
        "App\\UI\\GrandPresenter": { path: "/ws/Grand.php", source: renderSource },
      },
    });

    const entries = await loadNetteInheritedPresenterViewData(context);
    const afterAction = variableWinner(entries, "$afterAction");
    const afterBefore = variableWinner(entries, "$afterBefore");

    expect(afterAction?.entry.sourcePath).toBe("/ws/Base.php");
    expect(afterAction?.variable.valueExpression).toBe("new BeforeActionType()");
    expect(afterAction?.variable.valueOffset).toBe(
      beforeSource.indexOf("new BeforeActionType()"),
    );
    expect(afterAction?.variable.typeHint).toBe("BeforeActionType");
    expect(afterBefore?.entry.sourcePath).toBe("/ws/Grand.php");
    expect(afterBefore?.variable.valueExpression).toBe("new RenderType()");
    expect(afterBefore?.variable.valueOffset).toBe(
      renderSource.indexOf("new RenderType()"),
    );
    expect(afterBefore?.variable.typeHint).toBe("RenderType");
  });

  it("stops safely on class cycles and duplicate paths", async () => {
    const baseSource = presenter(
      "Base",
      method("startup", assign("base")),
      "Order",
    );
    const childSource = presenter("Order", "", "Base");
    const { context, deps } = makeHarness({
      presenterSource: childSource,
      classes: {
        "App\\UI\\BasePresenter": { path: "/ws/Base.php", source: baseSource },
        "App\\UI\\OrderPresenter": { path: PRESENTER, source: childSource },
      },
    });

    expect(variableNames(await loadNetteInheritedPresenterViewData(context))).toEqual(["$base"]);
    expect(deps.readPhpClassSource).toHaveBeenCalledTimes(1);
  });

  it("bounds the concrete presenter plus ancestors to five levels", async () => {
    const classes: Record<string, { path: string; source: string }> = {};

    for (let index = 1; index <= 6; index += 1) {
      const name = `Level${index}`;
      const parent = index < 6 ? `Level${index + 1}` : undefined;
      classes[`App\\UI\\${name}Presenter`] = {
        path: `/ws/${name}.php`,
        source: presenter(name, method("startup", assign(`value${index}`)), parent),
      };
    }

    const { context, deps } = makeHarness({
      presenterSource: presenter("Order", "", "Level1"),
      classes,
    });

    expect(variableNames(await loadNetteInheritedPresenterViewData(context))).toEqual(["$value1"]);
    expect(deps.readPhpClassSource).toHaveBeenCalledTimes(5);
    expect(deps.readPhpClassSource).not.toHaveBeenCalledWith("App\\UI\\Level6Presenter");
  });

  it("drops stale-root work after awaits without populating cache", async () => {
    let active = true;
    const { cache, context, deps } = makeHarness({
      readFileContent: vi.fn(async () => {
        active = false;
        return presenter("Order", method("startup", assign("stale")));
      }),
      active: () => active,
    });

    await expect(loadNetteInheritedPresenterViewData(context)).resolves.toEqual([]);
    expect(deps.readPhpClassSource).not.toHaveBeenCalled();
    expect(cache).toEqual({});
  });

  it("returns empty for an inactive cache hit", async () => {
    let active = true;
    const { cache, context, deps } = makeHarness({
      active: () => active,
      presenterSource: presenter("Order", method("startup", assign("cached"))),
    });
    const activeEntries = await loadNetteInheritedPresenterViewData(context);
    active = false;

    await expect(loadNetteInheritedPresenterViewData(context)).resolves.toEqual([]);
    expect(variableNames(activeEntries)).toEqual(["$cached"]);
    expect(cache[inheritedPresenterCacheKey(ROOT, TEMPLATE)]?.entries).toBe(
      activeEntries,
    );
    expect(deps.readFileContent).toHaveBeenCalledTimes(1);
  });

  it("returns empty when a request becomes inactive before joining in-flight work", async () => {
    let release!: (source: string) => void;
    let joinerChecks = 0;
    const readFileContent = vi.fn(
      () => new Promise<string>((resolve) => { release = resolve; }),
    );
    const { cache, context, inFlight } = makeHarness({ readFileContent });
    const producer = loadNetteInheritedPresenterViewData(context);
    const inactiveJoiner = loadNetteInheritedPresenterViewData({
      ...context,
      isRequestedRootActive: () => joinerChecks++ === 0,
    });

    await expect(inactiveJoiner).resolves.toEqual([]);
    expect(joinerChecks).toBe(2);
    expect(readFileContent).toHaveBeenCalledTimes(1);
    expect(inFlight.size).toBe(1);

    release(presenter("Order", method("startup", assign("shared"))));
    const sharedEntries = await producer;

    expect(variableNames(sharedEntries)).toEqual(["$shared"]);
    expect(cache[inheritedPresenterCacheKey(ROOT, TEMPLATE)]?.entries).toBe(
      sharedEntries,
    );
    expect(inFlight.size).toBe(0);
  });

  it("rechecks an in-flight joiner before returning the shared result", async () => {
    let joinerActive = true;
    let release!: (source: string) => void;
    const readFileContent = vi.fn(
      () => new Promise<string>((resolve) => { release = resolve; }),
    );
    const { context } = makeHarness({ readFileContent });
    const producer = loadNetteInheritedPresenterViewData(context);
    const joiner = loadNetteInheritedPresenterViewData({
      ...context,
      isRequestedRootActive: () => joinerActive,
    });
    joinerActive = false;
    release(presenter("Order", method("startup", assign("privateToActiveRoot"))));

    const [producerEntries, joinerEntries] = await Promise.all([producer, joiner]);
    expect(variableNames(producerEntries)).toEqual(["$privateToActiveRoot"]);
    expect(joinerEntries).toEqual([]);
    expect(readFileContent).toHaveBeenCalledTimes(1);
  });

  it("shares concurrent work only for the same root and active template", async () => {
    let release!: (source: string) => void;
    const readFileContent = vi.fn(
      () => new Promise<string>((resolve) => { release = resolve; }),
    );
    const { context, inFlight } = makeHarness({ readFileContent });

    const first = loadNetteInheritedPresenterViewData(context);
    const second = loadNetteInheritedPresenterViewData(context);
    release(presenter("Order", method("startup", assign("shared"))));

    const [firstEntries, secondEntries] = await Promise.all([first, second]);
    expect(firstEntries).toBe(secondEntries);
    expect(readFileContent).toHaveBeenCalledTimes(1);
    expect(inFlight.size).toBe(0);
  });

  it("isolates cache entries by both root and template", async () => {
    const { cache, context } = makeHarness({
      presenterSource: presenter("Order", method("startup", assign("order"))),
    });
    await loadNetteInheritedPresenterViewData(context);

    const invoiceTemplate = "app/UI/Invoice/edit.latte";
    const invoice = makeHarness({
      presenterSource: presenter("Invoice", method("startup", assign("invoice"))),
      templateRelativePath: invoiceTemplate,
    });
    invoice.context.cache = cache;
    await loadNetteInheritedPresenterViewData(invoice.context);

    expect(Object.keys(cache).sort()).toEqual([
      inheritedPresenterCacheKey(ROOT, TEMPLATE),
      inheritedPresenterCacheKey(ROOT, invoiceTemplate),
    ].sort());
  });

  it("excludes controls and other non-presenter template owners", async () => {
    const sourceFacts = vi.fn((): NetteViewDataSourceFacts => ({
      methods: [],
      owner: { kind: "control", name: "Order" },
    }));
    const { context } = makeHarness();
    context.deps.sourceFacts = sourceFacts;

    await expect(loadNetteInheritedPresenterViewData(context)).resolves.toEqual([]);
    expect(sourceFacts).toHaveBeenCalled();
  });
});
