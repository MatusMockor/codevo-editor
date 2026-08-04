import { describe, expect, it, vi } from "vitest";
import type * as Monaco from "monaco-editor";
import { defaultLargeSmartDocumentPolicy } from "../../domain/largeDocumentPolicy";
import { policyGatedJavaScriptTypeScriptDocumentSymbolProvider } from "./registrationLifecycle";

function modelWithMetrics(lineCount: number, utf16Length: number): Monaco.editor.ITextModel {
  return {
    getLineCount: () => lineCount,
    getValueLength: () => utf16Length,
  } as unknown as Monaco.editor.ITextModel;
}

const token = {} as Monaco.CancellationToken;

describe("policyGatedJavaScriptTypeScriptDocumentSymbolProvider", () => {
  it("fails closed on a policy-large document without invoking the underlying provider", async () => {
    const provideDocumentSymbols = vi.fn(async () => []);
    const gated = policyGatedJavaScriptTypeScriptDocumentSymbolProvider({ provideDocumentSymbols });
    const largeByLines = modelWithMetrics(defaultLargeSmartDocumentPolicy.lineLimit + 1, 200_000);
    const largeByChars = modelWithMetrics(100, defaultLargeSmartDocumentPolicy.characterLimit + 1);

    expect(await gated.provideDocumentSymbols(largeByLines, token)).toBeNull();
    expect(await gated.provideDocumentSymbols(largeByChars, token)).toBeNull();
    expect(provideDocumentSymbols).not.toHaveBeenCalled();
  });

  it("forwards eligible documents to the underlying provider and returns its result", async () => {
    const symbols = [{ name: "processEvent1" }] as unknown as Monaco.languages.DocumentSymbol[];
    const provideDocumentSymbols = vi.fn(async () => symbols);
    const gated = policyGatedJavaScriptTypeScriptDocumentSymbolProvider({ provideDocumentSymbols });
    const eligible = modelWithMetrics(2000, 59_354);

    expect(await gated.provideDocumentSymbols(eligible, token)).toBe(symbols);
    expect(provideDocumentSymbols).toHaveBeenCalledTimes(1);
    expect(provideDocumentSymbols).toHaveBeenCalledWith(eligible, token);
  });

  it("re-enables the exact document once it shrinks back inside the policy limits", async () => {
    const provideDocumentSymbols = vi.fn(async () => []);
    const gated = policyGatedJavaScriptTypeScriptDocumentSymbolProvider({ provideDocumentSymbols });
    let lineCount = defaultLargeSmartDocumentPolicy.lineLimit + 1;
    const model = {
      getLineCount: () => lineCount,
      getValueLength: () => 200_000,
    } as unknown as Monaco.editor.ITextModel;

    expect(await gated.provideDocumentSymbols(model, token)).toBeNull();
    lineCount = defaultLargeSmartDocumentPolicy.lineLimit;
    expect(await gated.provideDocumentSymbols(model, token)).toEqual([]);
    expect(provideDocumentSymbols).toHaveBeenCalledTimes(1);
  });

  it("gates per model so a large tab never disables symbols for an eligible tab", async () => {
    const provideDocumentSymbols = vi.fn(async () => []);
    const gated = policyGatedJavaScriptTypeScriptDocumentSymbolProvider({ provideDocumentSymbols });
    const large = modelWithMetrics(100_000, 3_029_826);
    const eligible = modelWithMetrics(2000, 59_354);

    expect(await gated.provideDocumentSymbols(large, token)).toBeNull();
    expect(await gated.provideDocumentSymbols(eligible, token)).toEqual([]);
    expect(await gated.provideDocumentSymbols(large, token)).toBeNull();
    expect(provideDocumentSymbols).toHaveBeenCalledTimes(1);
    expect(provideDocumentSymbols).toHaveBeenCalledWith(eligible, token);
  });

  it("fails closed on invalid metrics instead of forwarding the request", async () => {
    const provideDocumentSymbols = vi.fn(async () => []);
    const gated = policyGatedJavaScriptTypeScriptDocumentSymbolProvider({ provideDocumentSymbols });
    const broken = modelWithMetrics(Number.NaN, Number.NaN);

    expect(await gated.provideDocumentSymbols(broken, token)).toBeNull();
    expect(provideDocumentSymbols).not.toHaveBeenCalled();
  });
});
