import { describe, expect, it } from "vitest";
import type { LanguageServerCodeAction } from "./languageServerFeatures";
import {
  codeActionRequestContextFitsProjection,
  codeActionFitsProjection,
  codeActionsFitProjection,
  MAX_CODE_ACTION_DIAGNOSTICS,
  MAX_CODE_ACTION_DIAGNOSTIC_MESSAGE_UTF8_BYTES,
  MAX_CODE_ACTION_ITEM_UTF8_BYTES,
  MAX_CODE_ACTION_JSON_CONTAINER_ITEMS,
  MAX_CODE_ACTION_JSON_DEPTH,
  MAX_CODE_ACTION_RESULTS,
  MAX_CODE_ACTION_TITLE_UTF8_BYTES,
} from "./codeActionProjection";

describe("code action projection", () => {
  it("accepts N actions and fails the whole response at N+1", () => {
    expect(
      codeActionsFitProjection(
        Array.from({ length: MAX_CODE_ACTION_RESULTS }, (_, index) => action(index)),
      ),
    ).toBe(true);
    expect(
      codeActionsFitProjection(
        Array.from({ length: MAX_CODE_ACTION_RESULTS + 1 }, (_, index) => action(index)),
      ),
    ).toBe(false);
  });

  it("rejects oversized items and aggregate responses without truncation", () => {
    expect(
      codeActionFitsProjection(action(1, { payload: "a".repeat(MAX_CODE_ACTION_ITEM_UTF8_BYTES) })),
    ).toBe(false);
    expect(
      codeActionsFitProjection(
        Array.from({ length: 9 }, (_, index) => action(index, { payload: "a".repeat(240 * 1024) })),
      ),
    ).toBe(false);
    expect(
      codeActionsFitProjection([
        {
          ...action(1),
          title: "x".repeat(MAX_CODE_ACTION_TITLE_UTF8_BYTES + 1),
        },
      ]),
    ).toBe(false);
  });

  it("rejects excess nesting and container fan-out", () => {
    let exactDepth: unknown = "leaf";
    for (let depth = 0; depth < MAX_CODE_ACTION_JSON_DEPTH; depth += 1) {
      exactDepth = { nested: exactDepth };
    }
    let nested: unknown = "leaf";
    for (let depth = 0; depth <= MAX_CODE_ACTION_JSON_DEPTH; depth += 1) {
      nested = { nested };
    }
    const exactNodes = [
      ...Array.from({ length: 15 }, () => Array.from({ length: 255 }, () => null)),
      Array.from({ length: 254 }, () => null),
    ];
    const excessNodes = [
      ...Array.from({ length: 15 }, () => Array.from({ length: 255 }, () => null)),
      Array.from({ length: 255 }, () => null),
    ];
    expect(codeActionFitsProjection(action(1, exactDepth))).toBe(true);
    expect(codeActionFitsProjection(action(1, nested))).toBe(false);
    expect(codeActionFitsProjection(action(1, exactNodes))).toBe(true);
    expect(codeActionFitsProjection(action(1, excessNodes))).toBe(false);
    expect(
      codeActionFitsProjection(
        action(
          1,
          Array.from({ length: MAX_CODE_ACTION_JSON_CONTAINER_ITEMS + 1 }, () => null),
        ),
      ),
    ).toBe(false);
  });

  it("rejects oversized request contexts before they cross IPC", () => {
    const diagnostic = {
      code: 2304,
      data: null,
      message: "Cannot find name.",
      range: {
        end: { character: 1, line: 0 },
        start: { character: 0, line: 0 },
      },
      severity: 1,
      source: "typescript",
    };
    expect(
      codeActionRequestContextFitsProjection({
        diagnostics: Array.from({ length: MAX_CODE_ACTION_DIAGNOSTICS }, () => diagnostic),
        only: ["quickfix"],
        triggerKind: 1,
      }),
    ).toBe(true);
    expect(
      codeActionRequestContextFitsProjection({
        diagnostics: Array.from({ length: MAX_CODE_ACTION_DIAGNOSTICS + 1 }, () => diagnostic),
        only: ["quickfix"],
        triggerKind: 1,
      }),
    ).toBe(false);
    expect(
      codeActionRequestContextFitsProjection({
        diagnostics: [
          {
            ...diagnostic,
            message: "x".repeat(MAX_CODE_ACTION_DIAGNOSTIC_MESSAGE_UTF8_BYTES + 1),
          },
        ],
        only: ["quickfix"],
        triggerKind: 1,
      }),
    ).toBe(false);
  });
});

function action(index: number, data: unknown = null): LanguageServerCodeAction {
  return {
    command: null,
    data,
    edit: null,
    isPreferred: false,
    kind: "quickfix",
    title: `Fix ${index}`,
  };
}
