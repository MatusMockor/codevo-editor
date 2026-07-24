// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import type { DebugWatchDefinition } from "../domain/debugWatchExpressions";
import type { DebugWatchEvaluation } from "./useDebugWatchExpressions";
import { useDebugWatchExpressionMutations } from "./useDebugWatchExpressionMutations";

describe("useDebugWatchExpressionMutations", () => {
  it("projects an exact row capability and closes it across definition A→B→A", async () => {
    const original: DebugWatchDefinition = {
      id: "watch-1",
      expression: "count",
      enabled: true,
      revision: 3,
    };
    const evaluation: DebugWatchEvaluation = {
      owner: { rootKey: "/workspace", sessionId: 1, pauseGeneration: 2, frameId: 3 },
      definitionRevision: 3,
      frameId: 3,
      result: { status: "ok", value: "42", setExpressionReference: 9 },
    };
    const setExpression = vi.fn().mockResolvedValue({ status: "ok", value: "43" });
    let definitions: readonly DebugWatchDefinition[] = [original];
    let evaluations: Readonly<Record<string, DebugWatchEvaluation>> = { "watch-1": evaluation };
    let provider!: ReturnType<typeof useDebugWatchExpressionMutations>;
    const root = createRoot(document.createElement("div"));
    function Harness() {
      provider = useDebugWatchExpressionMutations({ definitions, evaluations, setExpression });
      return null;
    }
    act(() => root.render(<Harness />));
    const mutation = provider.forWatch(original, evaluation)!;
    expect(mutation).toMatchObject({
      identity: { definitionId: "watch-1", definitionRevision: 3, expression: "count" },
      currentValue: "42",
    });

    definitions = [{ ...original, revision: 4, expression: "other" }];
    evaluations = {};
    act(() => root.render(<Harness />));
    definitions = [{ ...original }];
    evaluations = { "watch-1": { ...evaluation } };
    act(() => root.render(<Harness />));
    await expect(mutation.setValue("43")).resolves.toBeNull();
    expect(setExpression).not.toHaveBeenCalled();
    root.unmount();
  });
});
