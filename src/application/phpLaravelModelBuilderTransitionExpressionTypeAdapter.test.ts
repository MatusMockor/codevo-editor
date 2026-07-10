import { describe, expect, it, vi } from "vitest";
import { phpLaravelModelBuilderTransitionExpressionTypeAdapter } from "./phpLaravelModelBuilderTransitionExpressionTypeAdapter";

type MethodCallContext = Parameters<
  typeof phpLaravelModelBuilderTransitionExpressionTypeAdapter.methodCallType
>[0];

function makeContext(
  methodName: string,
  overrides: Partial<MethodCallContext> = {},
): MethodCallContext {
  return {
    methodName,
    resolveCollectionTerminalModelType: vi.fn(async () => null),
    resolveModelFactoryModelType: vi.fn(async () => null),
    resolveBuilderTerminalModelType: vi.fn(async () => null),
    resolveBuilderModelType: vi.fn(async () => null),
    resolveCollectionModelType: vi.fn(async () => null),
    ...overrides,
  };
}

describe("phpLaravelModelBuilderTransitionExpressionTypeAdapter", () => {
  it.each([
    ["collection terminal", "first", "resolveCollectionTerminalModelType", "App\\Models\\Collection", "App\\Models\\Collection"],
    ["model factory", "newQuery", "resolveModelFactoryModelType", "App\\Models\\Factory", "Illuminate\\Database\\Eloquent\\Builder"],
    ["builder terminal", "updateOrCreate", "resolveBuilderTerminalModelType", "App\\Models\\Terminal", "App\\Models\\Terminal"],
    ["builder collection", "get", "resolveBuilderModelType", "App\\Models\\Builder", "Illuminate\\Database\\Eloquent\\Collection"],
    ["collection fluent", "filter", "resolveCollectionModelType", "App\\Models\\Collection", "Illuminate\\Database\\Eloquent\\Collection"],
    ["builder fluent", "select", "resolveBuilderModelType", "App\\Models\\Builder", "Illuminate\\Database\\Eloquent\\Builder"],
  ] as const)(
    "resolves the %s transition lazily",
    async (_transition, methodName, callbackName, modelType, expectedType) => {
      const calls: string[] = [];
      const callback = vi.fn(async () => {
        calls.push(callbackName);
        return modelType;
      });
      const context = makeContext(methodName, { [callbackName]: callback });

      await expect(
        phpLaravelModelBuilderTransitionExpressionTypeAdapter.methodCallType(
          context,
        ),
      ).resolves.toBe(expectedType);
      expect(calls).toEqual([callbackName]);
      expect(context.resolveCollectionTerminalModelType).toHaveBeenCalledTimes(
        callbackName === "resolveCollectionTerminalModelType" ? 1 : 0,
      );
      expect(context.resolveModelFactoryModelType).toHaveBeenCalledTimes(
        callbackName === "resolveModelFactoryModelType" ? 1 : 0,
      );
      expect(context.resolveBuilderTerminalModelType).toHaveBeenCalledTimes(
        callbackName === "resolveBuilderTerminalModelType" ? 1 : 0,
      );
      expect(context.resolveBuilderModelType).toHaveBeenCalledTimes(
        callbackName === "resolveBuilderModelType" ? 1 : 0,
      );
      expect(context.resolveCollectionModelType).toHaveBeenCalledTimes(
        callbackName === "resolveCollectionModelType" ? 1 : 0,
      );
    },
  );

  it("probes a collection terminal before the overlapping builder terminal", async () => {
    const calls: string[] = [];
    const context = makeContext("first", {
      resolveCollectionTerminalModelType: vi.fn(async () => {
        calls.push("collection-terminal");
        return null;
      }),
      resolveBuilderTerminalModelType: vi.fn(async () => {
        calls.push("builder-terminal");
        return "App\\Models\\Post";
      }),
    });

    await expect(
      phpLaravelModelBuilderTransitionExpressionTypeAdapter.methodCallType(
        context,
      ),
    ).resolves.toBe("App\\Models\\Post");
    expect(calls).toEqual(["collection-terminal", "builder-terminal"]);
  });

  it("resolves updateOrCreate as terminal before its fluent overlap", async () => {
    const calls: string[] = [];
    const context = makeContext("updateOrCreate", {
      resolveBuilderTerminalModelType: vi.fn(async () => {
        calls.push("terminal");
        return "App\\Models\\Post";
      }),
      resolveBuilderModelType: vi.fn(async () => {
        calls.push("fluent");
        return "App\\Models\\Post";
      }),
    });

    await expect(
      phpLaravelModelBuilderTransitionExpressionTypeAdapter.methodCallType(
        context,
      ),
    ).resolves.toBe("App\\Models\\Post");
    expect(calls).toEqual(["terminal"]);
  });

  it("probes where as collection fluent before builder fluent", async () => {
    const calls: string[] = [];
    const context = makeContext("where", {
      resolveCollectionModelType: vi.fn(async () => {
        calls.push("collection");
        return null;
      }),
      resolveBuilderModelType: vi.fn(async () => {
        calls.push("builder");
        return "App\\Models\\Post";
      }),
    });

    await expect(
      phpLaravelModelBuilderTransitionExpressionTypeAdapter.methodCallType(
        context,
      ),
    ).resolves.toBe("Illuminate\\Database\\Eloquent\\Builder");
    expect(calls).toEqual(["collection", "builder"]);
  });

  it("keeps a failed factory probe distinct from receiver fluent recovery", async () => {
    const calls: string[] = [];
    const context = makeContext("newQuery", {
      resolveModelFactoryModelType: vi.fn(async () => {
        calls.push("complete-expression");
        return null;
      }),
      resolveBuilderModelType: vi.fn(async () => {
        calls.push("receiver");
        return "App\\Models\\Post";
      }),
    });

    await expect(
      phpLaravelModelBuilderTransitionExpressionTypeAdapter.methodCallType(
        context,
      ),
    ).resolves.toBe("Illuminate\\Database\\Eloquent\\Builder");
    expect(calls).toEqual(["complete-expression", "receiver"]);
  });

  it("returns null without probing callbacks for an unrelated method", async () => {
    const context = makeContext("save");

    await expect(
      phpLaravelModelBuilderTransitionExpressionTypeAdapter.methodCallType(
        context,
      ),
    ).resolves.toBeNull();
    expect(context.resolveCollectionTerminalModelType).not.toHaveBeenCalled();
    expect(context.resolveModelFactoryModelType).not.toHaveBeenCalled();
    expect(context.resolveBuilderTerminalModelType).not.toHaveBeenCalled();
    expect(context.resolveBuilderModelType).not.toHaveBeenCalled();
    expect(context.resolveCollectionModelType).not.toHaveBeenCalled();
  });

  it("gives a static terminal precedence over the static builder overlap", async () => {
    await expect(
      phpLaravelModelBuilderTransitionExpressionTypeAdapter.staticCallType({
        className: "App\\Models\\Post",
        methodName: "updateOrCreate",
      }),
    ).resolves.toBe("App\\Models\\Post");
    await expect(
      phpLaravelModelBuilderTransitionExpressionTypeAdapter.staticCallType({
        className: "App\\Models\\Post",
        methodName: "query",
      }),
    ).resolves.toBe("Illuminate\\Database\\Eloquent\\Builder");
  });

  it("guards static transitions without a class", async () => {
    await expect(
      phpLaravelModelBuilderTransitionExpressionTypeAdapter.staticCallType({
        className: null,
        methodName: "query",
      }),
    ).resolves.toBeNull();
  });
});
