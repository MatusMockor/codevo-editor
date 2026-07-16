import { describe, expect, it, vi } from "vitest";
import {
  netteIncludedTemplateArguments,
  type NetteIncludedTemplateArgumentCache,
  type NetteIncludedTemplateArgumentContext,
  type NetteIncludedTemplateArgumentDependencies,
  type NetteIncludedTemplateArgumentInFlight,
} from "./netteIncludedTemplateArguments";

const ROOT = "/workspace";

function spanOf(source: string, text: string, occurrence = 0) {
  let start = -1;

  for (let index = 0; index <= occurrence; index += 1) {
    start = source.indexOf(text, start + 1);
  }

  return { end: start + text.length, start };
}

function relativeFromAbsolute(path: string): string {
  const rootEnd = path.indexOf("/", 1);

  if (rootEnd < 0) {
    return "";
  }

  return path.slice(rootEnd + 1);
}

function defaultCandidates(reference: string, currentPath: string): string[] {
  const slash = currentPath.lastIndexOf("/");
  const directory = slash < 0 ? "" : currentPath.slice(0, slash + 1);
  return [`${directory}${reference}`];
}

function makeHarness(
  files: Record<string, string>,
  overrides: Partial<NetteIncludedTemplateArgumentDependencies> = {},
): {
  cache: NetteIncludedTemplateArgumentCache;
  context: NetteIncludedTemplateArgumentContext;
  deps: NetteIncludedTemplateArgumentDependencies;
  generation: { current: number };
  inFlight: NetteIncludedTemplateArgumentInFlight;
  root: { active: boolean };
} {
  const cache: NetteIncludedTemplateArgumentCache = {};
  const inFlight: NetteIncludedTemplateArgumentInFlight = {
    graphs: new Map(),
    queries: new Map(),
  };
  const generation = { current: 1 };
  const root = { active: true };
  const deps: NetteIncludedTemplateArgumentDependencies = {
    enumerateTemplateRelativePaths: vi.fn(async () => Object.keys(files)),
    joinPath: (rootPath, relativePath) => `${rootPath}/${relativePath}`,
    readFileContent: vi.fn(async (path: string) => {
      const relativePath = relativeFromAbsolute(path);
      const source = files[relativePath];

      if (source === undefined) {
        throw new Error(`missing ${relativePath}`);
      }

      return source;
    }),
    resolveCallerVariableType: vi.fn(
      async (_callerPath, _source, _offset, variableName) =>
        variableName === "product" ? "App\\Model\\Product" : null,
    ),
    resolveTemplateCandidatePaths: vi.fn(defaultCandidates),
    ...overrides,
  };
  const context: NetteIncludedTemplateArgumentContext = {
    cache,
    currentGeneration: () => generation.current,
    deps,
    generation: generation.current,
    inFlight,
    isRequestedRootActive: () => root.active,
    maxDepth: 12,
    maxTraversalStates: 10_000,
    requestedRoot: ROOT,
  };

  return { cache, context, deps, generation, inFlight, root };
}

describe("netteIncludedTemplateArguments", () => {
  it("reverse-resolves multiple project callers for the active target", async () => {
    const first = "{include 'partial.latte', item: $product}";
    const second = "{include 'partial.latte', item: 'preview', count: 2}";
    const { context } = makeHarness({
      "a.latte": first,
      "b.latte": second,
      "partial.latte": "{$item}",
    });

    const result = await netteIncludedTemplateArguments(context, "partial.latte");

    expect(result).toEqual([
      expect.objectContaining({
        expression: "2",
        name: "count",
        sourceTemplateRelativePath: "b.latte",
        type: "int",
      }),
      expect.objectContaining({
        expression: "$product",
        name: "item",
        sourceSpan: spanOf(first, "$product"),
        sourceTemplateRelativePath: "a.latte",
        targetSpan: spanOf(first, "item"),
        targetTemplateRelativePath: "partial.latte",
        type: "App\\Model\\Product",
      }),
      expect.objectContaining({
        expression: "'preview'",
        name: "item",
        sourceTemplateRelativePath: "b.latte",
        type: "string",
      }),
    ]);
  });

  it("returns transitive alias provenance in navigation order", async () => {
    const root = "{include 'middle.latte', value: $product}";
    const middle = "{include 'leaf.latte', row: $value}";
    const { context } = makeHarness({
      "leaf.latte": "{$row}",
      "middle.latte": middle,
      "root.latte": root,
    });

    const [binding] = await netteIncludedTemplateArguments(context, "leaf.latte");

    expect(binding).toEqual(expect.objectContaining({
      depth: 1,
      expression: "$product",
      name: "row",
      sourceSpan: spanOf(root, "$product"),
      sourceTemplateRelativePath: "root.latte",
      targetSpan: spanOf(middle, "row"),
      targetTemplateRelativePath: "leaf.latte",
      type: "App\\Model\\Product",
    }));
    expect(binding?.provenance).toEqual([
      {
        expression: "$product",
        name: "value",
        nameSpan: spanOf(root, "value"),
        sourceTemplateRelativePath: "root.latte",
        targetTemplateRelativePath: "middle.latte",
        valueSpan: spanOf(root, "$product"),
      },
      {
        expression: "$value",
        name: "row",
        nameSpan: spanOf(middle, "row"),
        sourceTemplateRelativePath: "middle.latte",
        targetTemplateRelativePath: "leaf.latte",
        valueSpan: spanOf(middle, "$value"),
      },
    ]);
  });

  it("dedupes an origin that reaches the target through a converging diamond", async () => {
    const { context } = makeHarness({
      "a.latte": [
        "{include 'b.latte', value: $shared}",
        "{include 'c.latte', value: $shared}",
      ].join("\n"),
      "b.latte": "{include 'd.latte', value: $value}",
      "c.latte": "{include 'd.latte', value: $value}",
      "d.latte": "{include 'leaf.latte', item: $value}",
      "leaf.latte": "{$item}",
      "root.latte": "{include 'a.latte', shared: 'one'}",
    });

    const result = await netteIncludedTemplateArguments(context, "leaf.latte");

    expect(result).toHaveLength(1);
    expect(result[0]).toEqual(expect.objectContaining({
      expression: "'one'",
      name: "item",
      sourceTemplateRelativePath: "root.latte",
      type: "string",
    }));
    expect(result[0]?.provenance.map((step) => step.sourceTemplateRelativePath))
      .toEqual(["root.latte", "a.latte", "b.latte", "d.latte"]);
  });

  it("keeps a literal origin when a cyclic diamond route is visited first", async () => {
    const { cache, context } = makeHarness({
      "cycle.latte": [
        "{include 'hub.latte', value: $value}",
        "{include 'merge.latte', value: $value}",
      ].join("\n"),
      "hub.latte": [
        "{include 'cycle.latte', value: $value}",
        "{include 'safe.latte', value: $value}",
      ].join("\n"),
      "leaf.latte": "{$item}",
      "merge.latte": "{include 'leaf.latte', item: $value}",
      "root.latte": "{include 'hub.latte', value: 'survives'}",
      "safe.latte": "{include 'merge.latte', value: $value}",
    });

    const result = await netteIncludedTemplateArguments(context, "leaf.latte");

    expect(result).toHaveLength(1);
    expect(result[0]).toEqual(expect.objectContaining({
      expression: "'survives'",
      sourceTemplateRelativePath: "root.latte",
      type: "string",
    }));
    expect(result[0]?.provenance.map((step) => step.sourceTemplateRelativePath))
      .toEqual(["root.latte", "hub.latte", "safe.latte", "merge.latte"]);
    expect(cache[ROOT]?.graph.cyclicEdgeIds.size).toBe(2);
  });

  it("uses the last duplicate binding and clears an inherited known type", async () => {
    const root =
      "{include 'middle.latte', value: 'known', value: makeUnknown()}";
    const { context } = makeHarness({
      "leaf.latte": "{$item}",
      "middle.latte": "{include 'leaf.latte', item: $value}",
      "root.latte": root,
    });

    const [binding] = await netteIncludedTemplateArguments(context, "leaf.latte");

    expect(binding).toEqual(expect.objectContaining({
      expression: "makeUnknown()",
      sourceSpan: spanOf(root, "makeUnknown()"),
      type: null,
    }));
    expect(binding?.provenance[0]?.nameSpan).toEqual(
      spanOf(root, "value", 1),
    );
  });

  it(
    "selects the first existing candidate even when traversal ancestry terminates it",
    async () => {
    const resolver = vi.fn((reference: string, caller: string) => {
      if (caller === "a.latte" && reference === "cycle") {
        return ["root.latte", "fallback.latte"];
      }

      return defaultCandidates(reference, caller);
    });
    const { context } = makeHarness(
      {
        "a.latte": "{include 'cycle', leaked: 2}",
        "fallback.latte": "{$leaked}",
        "root.latte": "{include 'a.latte', value: 1}",
      },
      { resolveTemplateCandidatePaths: resolver },
    );

    await expect(
      netteIncludedTemplateArguments(context, "fallback.latte"),
    ).resolves.toEqual([]);
    await expect(
      netteIncludedTemplateArguments(context, "root.latte"),
    ).resolves.toEqual([]);
    expect(resolver).toHaveBeenCalledWith("cycle", "a.latte");
    },
  );

  it("builds once, caches target queries, and dedupes concurrent work", async () => {
    let release: ((paths: readonly string[]) => void) | undefined;
    const enumerateTemplateRelativePaths = vi.fn(
      () =>
        new Promise<readonly string[]>((resolve) => {
          release = resolve;
        }),
    );
    const files = {
      "caller.latte": "{include 'partial.latte', value: 1}",
      "partial.latte": "{$value}",
    };
    const { context, deps, inFlight } = makeHarness(files, {
      enumerateTemplateRelativePaths,
    });

    const first = netteIncludedTemplateArguments(context, "partial.latte");
    const second = netteIncludedTemplateArguments(context, "partial.latte");
    await vi.waitFor(() => expect(enumerateTemplateRelativePaths).toHaveBeenCalledTimes(1));
    release?.(Object.keys(files));
    const [firstResult, secondResult] = await Promise.all([first, second]);
    const thirdResult = await netteIncludedTemplateArguments(context, "partial.latte");

    expect(firstResult).toBe(secondResult);
    expect(thirdResult).toBe(firstResult);
    expect(deps.readFileContent).toHaveBeenCalledTimes(2);
    expect(inFlight.graphs.size).toBe(0);
    expect(inFlight.queries.size).toBe(0);
  });

  it("does not coalesce concurrent target queries with different limits", async () => {
    const { context } = makeHarness({
      "a.latte": "{include 'leaf.latte', item: 1}",
      "b.latte": "{include 'leaf.latte', item: 2}",
      "leaf.latte": "{$item}",
    });
    await netteIncludedTemplateArguments(context, "missing.latte");
    const narrow = { ...context, maxTraversalStates: 1 };
    const wide = { ...context, maxTraversalStates: 2 };

    const [narrowResult, wideResult] = await Promise.all([
      netteIncludedTemplateArguments(narrow, "leaf.latte"),
      netteIncludedTemplateArguments(wide, "leaf.latte"),
    ]);

    expect(narrowResult).toHaveLength(1);
    expect(wideResult).toHaveLength(2);
    expect(narrowResult).not.toBe(wideResult);
  });

  it("isolates projects and invalidates graph and query caches by generation", async () => {
    const files = {
      "caller.latte": "{include 'partial.latte', value: 1}",
      "partial.latte": "{$value}",
    };
    const { cache, context, deps, generation } = makeHarness(files);

    await netteIncludedTemplateArguments(context, "partial.latte");
    const otherContext = { ...context, requestedRoot: "/other" };
    await netteIncludedTemplateArguments(otherContext, "partial.latte");
    generation.current = 2;
    const nextContext = { ...context, generation: 2 };
    await netteIncludedTemplateArguments(nextContext, "partial.latte");

    expect(deps.enumerateTemplateRelativePaths).toHaveBeenCalledTimes(3);
    expect(Object.keys(cache).sort()).toEqual(["/other", ROOT]);
    expect(cache[ROOT]?.generation).toBe(2);
  });

  it("drops stale enumeration, reads, and type results without cache writes", async () => {
    const files: Record<string, string> = {
      "caller.latte": "{include 'partial.latte', value: $product}",
      "partial.latte": "{$value}",
    };
    const enumeration = makeHarness(files);
    enumeration.deps.enumerateTemplateRelativePaths = vi.fn(async () => {
      enumeration.root.active = false;
      return Object.keys(files);
    });
    await expect(
      netteIncludedTemplateArguments(enumeration.context, "partial.latte"),
    ).resolves.toEqual([]);
    expect(enumeration.cache).toEqual({});

    const read = makeHarness(files);
    read.deps.readFileContent = vi.fn(async (path) => {
      read.generation.current += 1;
      return files[relativeFromAbsolute(path)] ?? "";
    });
    await expect(
      netteIncludedTemplateArguments(read.context, "partial.latte"),
    ).resolves.toEqual([]);
    expect(read.cache).toEqual({});

    const type = makeHarness(files, {
      resolveCallerVariableType: vi.fn(async () => {
        type.root.active = false;
        return "App\\Model\\Product";
      }),
    });
    await expect(
      netteIncludedTemplateArguments(type.context, "partial.latte"),
    ).resolves.toEqual([]);
    expect(type.cache[ROOT]?.queryResults.size).toBe(0);
  });

  it("bounds branching traversal and performs linear graph work", async () => {
    const files: Record<string, string> = {
      "leaf.latte": "{$item}",
    };

    for (let index = 0; index < 30; index += 1) {
      files[`caller-${index}.latte`] =
        "{include 'leaf.latte', item: $product}";
    }

    const { context, deps } = makeHarness(files);
    context.maxTraversalStates = 10;
    const result = await netteIncludedTemplateArguments(context, "leaf.latte");

    expect(result).toHaveLength(10);
    expect(deps.readFileContent).toHaveBeenCalledTimes(Object.keys(files).length);
    expect(deps.resolveCallerVariableType).toHaveBeenCalledTimes(10);
  });

  it("never leaks a long cycle when the traversal budget is smaller", async () => {
    const files: Record<string, string> = {};
    const cycleLength = 40;

    for (let index = 0; index < cycleLength; index += 1) {
      const next = (index + 1) % cycleLength;
      files[`cycle-${index}.latte`] =
        `{include 'cycle-${next}.latte', value: ${index}}`;
    }

    const { cache, context } = makeHarness(files);
    context.maxTraversalStates = 2;

    await expect(
      netteIncludedTemplateArguments(context, "cycle-0.latte"),
    ).resolves.toEqual([]);
    expect(cache[ROOT]?.graph.cyclicEdgeIds.size).toBe(cycleLength);
  });

  it("analyzes cycles linearly and shares one bounded traversal budget", async () => {
    const files: Record<string, string> = {
      "leaf.latte": "{$item}",
      "self.latte": "{include 'self.latte', value: 1}",
    };

    for (let index = 0; index < 50; index += 1) {
      const target = index === 49 ? "leaf.latte" : `node-${index + 1}.latte`;
      files[`node-${index}.latte`] =
        `{include '${target}', item: $product}`;
    }

    const { cache, context, deps } = makeHarness(files);
    context.maxTraversalStates = 7;
    await netteIncludedTemplateArguments(context, "leaf.latte");
    const graph = cache[ROOT]?.graph;

    if (!graph) {
      throw new Error("graph was not cached");
    }

    const vertexCount = Object.keys(files).length;
    expect(graph.cycleAnalysisOperations).toBeLessThanOrEqual(
      2 * vertexCount + 3 * graph.edges.length,
    );
    expect(graph.cyclicEdgeIds.size).toBe(1);
    expect(deps.resolveCallerVariableType).toHaveBeenCalledTimes(1);
  });

  it("stops transitive alias resolution at maximum depth", async () => {
    const { context } = makeHarness({
      "a.latte": "{include 'b.latte', value: $value}",
      "b.latte": "{include 'leaf.latte', item: $value}",
      "leaf.latte": "{$item}",
      "root.latte": "{include 'a.latte', value: 1}",
    });
    context.maxDepth = 2;

    await expect(
      netteIncludedTemplateArguments(context, "leaf.latte"),
    ).resolves.toEqual([]);
  });

  it("never indexes dynamic targets", async () => {
    const { context, deps } = makeHarness({
      "caller.latte": "{include $template, value: 1}",
      "partial.latte": "{$value}",
    });

    await expect(
      netteIncludedTemplateArguments(context, "partial.latte"),
    ).resolves.toEqual([]);
    expect(deps.resolveTemplateCandidatePaths).not.toHaveBeenCalled();
  });
});
