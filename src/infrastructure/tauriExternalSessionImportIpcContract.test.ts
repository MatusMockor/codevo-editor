import { describe, expect, it } from "vitest";
import {
  parseImportedHistoryPage,
  parseSessionImportProgress,
} from "./tauriExternalSessionImportIpcContract";
const history = {
  provider: "codex",
  sessionId: "11111111-1111-4111-8111-111111111111",
  exchanges: [],
  exchangesTruncated: false,
  totalPreviewBytes: 0,
};
describe("imported history contracts", () => {
  it("distinguishes unloaded earlier pages from actual source loss", () => {
    expect(
      parseImportedHistoryPage({ history, hasEarlier: true, beforeOrdinal: 256, complete: true }),
    ).toEqual({ history, hasEarlier: true, beforeOrdinal: 256, complete: true });
  });
  it.each([
    null,
    {},
    { history, hasEarlier: true, beforeOrdinal: null, complete: true },
    { history, hasEarlier: false, beforeOrdinal: 1, complete: true },
    { history, hasEarlier: true, beforeOrdinal: -1, complete: true },
    { history, hasEarlier: false, beforeOrdinal: null, complete: true, extra: true },
  ])("rejects malformed history %s", (value) => {
    expect(() => parseImportedHistoryPage(value)).toThrow();
  });
  it("rejects invalid progress counts and unknown fields", () => {
    expect(
      parseSessionImportProgress({ complete: true, importedCount: 900, truncated: false }),
    ).toEqual({ complete: true, importedCount: 900, truncated: false });
    for (const importedCount of [-1, NaN, Infinity, 1.5])
      expect(() =>
        parseSessionImportProgress({ complete: true, importedCount, truncated: false }),
      ).toThrow();
  });
});
