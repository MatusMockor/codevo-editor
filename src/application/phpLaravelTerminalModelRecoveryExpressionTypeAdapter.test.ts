import { describe, expect, it, vi } from "vitest";
import { phpLaravelTerminalModelRecoveryExpressionTypeAdapter } from "./phpLaravelTerminalModelRecoveryExpressionTypeAdapter";

describe("phpLaravelTerminalModelRecoveryExpressionTypeAdapter", () => {
  it("resolves a collection property relation before its fallback", async () => {
    const calls: string[] = [];
    const adapter = phpLaravelTerminalModelRecoveryExpressionTypeAdapter({
      resolvePropertyOrRelationType: vi.fn(
        async (className, propertyName, includeCollectionRelations) => {
          calls.push(
            `relation:${className}:${propertyName}:${includeCollectionRelations}`,
          );
          return "App\\Models\\Comment";
        },
      ),
    });

    await expect(
      adapter.collectionTerminalModelType({
        receiverExpression: "$model->comments",
        resolveCollectionModelType: vi.fn(async () => {
          calls.push("collection");
          return "App\\Models\\Fallback";
        }),
        resolveExpressionType: vi.fn(async (expression) => {
          calls.push(`owner:${expression}`);
          return "App\\Models\\Post";
        }),
      }),
    ).resolves.toBe("App\\Models\\Comment");
    expect(calls).toEqual([
      "owner:$model",
      "relation:App\\Models\\Post:comments:true",
    ]);
  });

  it("falls back after a collection property relation miss", async () => {
    const calls: string[] = [];
    const adapter = phpLaravelTerminalModelRecoveryExpressionTypeAdapter({
      resolvePropertyOrRelationType: vi.fn(async () => {
        calls.push("relation");
        return null;
      }),
    });

    await expect(
      adapter.collectionTerminalModelType({
        receiverExpression: "$model->comments",
        resolveCollectionModelType: vi.fn(async () => {
          calls.push("collection");
          return "App\\Models\\Fallback";
        }),
        resolveExpressionType: vi.fn(async () => {
          calls.push("owner");
          return "App\\Models\\Post";
        }),
      }),
    ).resolves.toBe("App\\Models\\Fallback");
    expect(calls).toEqual(["owner", "relation", "collection"]);
  });

  it("peels mixed classified chains for a builder relation hit", async () => {
    const calls: string[] = [];
    const adapter = phpLaravelTerminalModelRecoveryExpressionTypeAdapter({
      resolvePropertyOrRelationType: vi.fn(
        async (className, propertyName, includeCollectionRelations) => {
          calls.push(
            `relation:${className}:${propertyName}:${includeCollectionRelations}`,
          );
          return "App\\Models\\Comment";
        },
      ),
    });

    await expect(
      adapter.builderTerminalModelType({
        receiverExpression: "$model->comments()->get()->filter()",
        resolveBuilderModelType: vi.fn(async () => {
          calls.push("builder");
          return "App\\Models\\Fallback";
        }),
        resolveExpressionType: vi.fn(async (expression) => {
          calls.push(`owner:${expression}`);
          return "App\\Models\\Post";
        }),
      }),
    ).resolves.toBe("App\\Models\\Comment");
    expect(calls).toEqual([
      "owner:$model",
      "relation:App\\Models\\Post:comments:true",
    ]);
  });

  it("prefers a method relation candidate and falls back after a miss", async () => {
    const calls: string[] = [];
    const adapter = phpLaravelTerminalModelRecoveryExpressionTypeAdapter({
      resolvePropertyOrRelationType: vi.fn(
        async (className, propertyName, includeCollectionRelations) => {
          calls.push(
            `relation:${className}:${propertyName}:${includeCollectionRelations}`,
          );
          return null;
        },
      ),
    });

    await expect(
      adapter.builderTerminalModelType({
        receiverExpression: "$model->comments()",
        resolveBuilderModelType: vi.fn(async () => {
          calls.push("builder");
          return "App\\Models\\Fallback";
        }),
        resolveExpressionType: vi.fn(async (expression) => {
          calls.push(`owner:${expression}`);
          return "App\\Models\\Post";
        }),
      }),
    ).resolves.toBe("App\\Models\\Fallback");
    expect(calls).toEqual([
      "owner:$model",
      "relation:App\\Models\\Post:comments:true",
      "builder",
    ]);
  });

  it("does not peel an unclassified method", async () => {
    const calls: string[] = [];
    const adapter = phpLaravelTerminalModelRecoveryExpressionTypeAdapter({
      resolvePropertyOrRelationType: vi.fn(async (_className, propertyName) => {
        calls.push(`relation:${propertyName}`);
        return null;
      }),
    });

    await adapter.builderTerminalModelType({
      receiverExpression: "$model->comments()->custom()",
      resolveBuilderModelType: vi.fn(async () => {
        calls.push("builder");
        return null;
      }),
      resolveExpressionType: vi.fn(async (expression) => {
        calls.push(`owner:${expression}`);
        return "App\\Models\\Comment";
      }),
    });

    expect(calls).toEqual([
      "owner:$model->comments()",
      "relation:custom",
      "builder",
    ]);
  });
});
