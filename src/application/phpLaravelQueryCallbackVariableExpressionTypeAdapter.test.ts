import { describe, expect, it, vi } from "vitest";
import { phpLaravelQueryCallbackVariableExpressionTypeAdapter } from "./phpLaravelQueryCallbackVariableExpressionTypeAdapter";

const CALLBACK_SOURCE = `<?php
Post::query()->whereHas('comments', function ($query): void {
    $query->where('active', true);
});
`;
const CALLBACK_POSITION = { column: 17, lineNumber: 3 };

function context(
  overrides: Partial<
    Parameters<
      typeof phpLaravelQueryCallbackVariableExpressionTypeAdapter.variableType
    >[0]
  > = {},
) {
  return {
    position: CALLBACK_POSITION,
    resolveBuilderModelType: vi.fn(async () => "App\\Models\\Comment"),
    source: CALLBACK_SOURCE,
    variableName: "query",
    ...overrides,
  };
}

describe("phpLaravelQueryCallbackVariableExpressionTypeAdapter", () => {
  it("returns Builder after recovering the callback model exactly once", async () => {
    const adapterContext = context();

    await expect(
      phpLaravelQueryCallbackVariableExpressionTypeAdapter.variableType(
        adapterContext,
      ),
    ).resolves.toBe("Illuminate\\Database\\Eloquent\\Builder");
    expect(adapterContext.resolveBuilderModelType).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["a missing variable", null, CALLBACK_SOURCE, CALLBACK_POSITION],
    [
      "a non-callback variable",
      "query",
      "<?php\n$query->where();\n",
      { column: 7, lineNumber: 2 },
    ],
  ])(
    "returns null without resolving a model for %s",
    async (_label, variableName, source, position) => {
      const adapterContext = context({ position, source, variableName });

      await expect(
        phpLaravelQueryCallbackVariableExpressionTypeAdapter.variableType(
          adapterContext,
        ),
      ).resolves.toBeNull();
      expect(adapterContext.resolveBuilderModelType).not.toHaveBeenCalled();
    },
  );

  it("returns null when the callback model cannot be recovered", async () => {
    const resolveBuilderModelType = vi.fn(async () => null);

    await expect(
      phpLaravelQueryCallbackVariableExpressionTypeAdapter.variableType(
        context({ resolveBuilderModelType }),
      ),
    ).resolves.toBeNull();
    expect(resolveBuilderModelType).toHaveBeenCalledTimes(1);
  });
});
