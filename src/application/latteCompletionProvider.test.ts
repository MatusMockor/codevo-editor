import { describe, expect, it, vi } from "vitest";
import type { LatteProviderFlowFactoryOptions } from "./latteProviderFlowContext";
import { provideLatteCompletions } from "./latteCompletionProvider";

describe("provideLatteCompletions same-file blocks", () => {
  it("returns block symbols before the framework request gate", async () => {
    const source = [
      "{block #emptyState}<p />{/block emptyState}",
      "{define tableRow, $row}<tr />{/define tableRow}",
      "{block local helper}<i />{/block helper}",
      "{include block ta",
    ].join("\n");
    const getDependencies = vi.fn(() => {
      throw new Error("framework request should not be created");
    });

    await expect(
      provideLatteCompletions(
        { getDependencies } as unknown as LatteProviderFlowFactoryOptions,
        source,
        { column: "{include block ta".length + 1, lineNumber: 4 },
      ),
    ).resolves.toEqual([
      {
        detail: "Same-file Latte block",
        insertText: "tableRow",
        kind: "block",
        label: "tableRow",
        replaceEnd: source.length,
        replaceStart: source.length - 2,
      },
    ]);
    expect(getDependencies).not.toHaveBeenCalled();
  });

  it("returns an empty local result when the block prefix has no candidate", async () => {
    const source = "{block #emptyState}{/block}\n{include missing";
    const getDependencies = vi.fn(() => {
      throw new Error("framework request should not be created");
    });

    await expect(
      provideLatteCompletions(
        { getDependencies } as unknown as LatteProviderFlowFactoryOptions,
        source,
        { column: "{include missing".length + 1, lineNumber: 2 },
      ),
    ).resolves.toEqual([]);
    expect(getDependencies).not.toHaveBeenCalled();
  });

  it("passes a bare dotted include through to framework template completion", async () => {
    const source = [
      "{block #price.total}{/block price.total}",
      "{include price.to",
    ].join("\n");
    const getDependencies = vi.fn(() => {
      throw new Error("framework request reached");
    });

    await expect(
      provideLatteCompletions(
        { getDependencies } as unknown as LatteProviderFlowFactoryOptions,
        source,
        { column: "{include price.to".length + 1, lineNumber: 2 },
      ),
    ).rejects.toThrow("framework request reached");
    expect(getDependencies).toHaveBeenCalledOnce();
  });
});
