import { describe, expect, it, vi } from "vitest";
import { phpLaravelCollectionCallbackVariableExpressionTypeAdapter } from "./phpLaravelCollectionCallbackVariableExpressionTypeAdapter";

const CALLBACK_SOURCE = `<?php
$users->map(fn ($user) => $user->nam);
`;
const CALLBACK_POSITION = { column: 34, lineNumber: 2 };

function context(
  overrides: Partial<
    Parameters<
      typeof phpLaravelCollectionCallbackVariableExpressionTypeAdapter.variableType
    >[0]
  > = {},
) {
  return {
    position: CALLBACK_POSITION,
    resolveCollectionElementType: vi.fn(async () => "App\\Models\\User"),
    source: CALLBACK_SOURCE,
    variableName: "user",
    ...overrides,
  };
}

describe("phpLaravelCollectionCallbackVariableExpressionTypeAdapter", () => {
  it("resolves the element type for the callback receiver exactly once", async () => {
    const adapterContext = context();

    await expect(
      phpLaravelCollectionCallbackVariableExpressionTypeAdapter.variableType(
        adapterContext,
      ),
    ).resolves.toBe("App\\Models\\User");
    expect(adapterContext.resolveCollectionElementType).toHaveBeenCalledTimes(1);
    expect(adapterContext.resolveCollectionElementType).toHaveBeenCalledWith(
      "$users",
    );
  });

  it.each([
    ["a missing variable", null, CALLBACK_SOURCE, CALLBACK_POSITION],
    [
      "a non-callback variable",
      "user",
      "<?php\n$user->save();\n",
      { column: 7, lineNumber: 2 },
    ],
    [
      "a control-flow callback",
      "user",
      "<?php\n$users->when($flag, fn ($user) => $user->nam);\n",
      { column: 42, lineNumber: 2 },
    ],
  ])(
    "returns null without resolving an element type for %s",
    async (_label, variableName, source, position) => {
      const adapterContext = context({ position, source, variableName });

      await expect(
        phpLaravelCollectionCallbackVariableExpressionTypeAdapter.variableType(
          adapterContext,
        ),
      ).resolves.toBeNull();
      expect(adapterContext.resolveCollectionElementType).not.toHaveBeenCalled();
    },
  );

  it("returns null when the element type cannot be resolved", async () => {
    const resolveCollectionElementType = vi.fn(async () => null);

    await expect(
      phpLaravelCollectionCallbackVariableExpressionTypeAdapter.variableType(
        context({ resolveCollectionElementType }),
      ),
    ).resolves.toBeNull();
    expect(resolveCollectionElementType).toHaveBeenCalledTimes(1);
  });
});
