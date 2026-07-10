import { describe, expect, it, vi } from "vitest";
import { genericPhpFrameworkTerminalModelRecoveryExpressionTypeAdapter } from "./phpFrameworkTerminalModelRecoveryExpressionTypeAdapter";

describe("phpFrameworkTerminalModelRecoveryExpressionTypeAdapter", () => {
  it("keeps the generic implementation inert", async () => {
    const resolveExpressionType = vi.fn(async () => "App\\Models\\Post");
    const resolveCollectionModelType = vi.fn(
      async () => "App\\Models\\CollectionFallback",
    );
    const resolveBuilderModelType = vi.fn(
      async () => "App\\Models\\BuilderFallback",
    );

    await expect(
      genericPhpFrameworkTerminalModelRecoveryExpressionTypeAdapter.collectionTerminalModelType(
        {
          receiverExpression: "$model->comments",
          resolveCollectionModelType,
          resolveExpressionType,
        },
      ),
    ).resolves.toBeNull();
    await expect(
      genericPhpFrameworkTerminalModelRecoveryExpressionTypeAdapter.builderTerminalModelType(
        {
          receiverExpression: "$model->comments()->get()",
          resolveBuilderModelType,
          resolveExpressionType,
        },
      ),
    ).resolves.toBeNull();

    expect(resolveExpressionType).not.toHaveBeenCalled();
    expect(resolveCollectionModelType).not.toHaveBeenCalled();
    expect(resolveBuilderModelType).not.toHaveBeenCalled();
  });
});
