import { describe, expect, it } from "vitest";
import type { LanguageServerWorkspaceSymbol } from "./languageServerFeatures";
import {
  MAX_WORKSPACE_SYMBOL_CONTAINER_UTF8_BYTES,
  MAX_WORKSPACE_SYMBOL_NAME_UTF8_BYTES,
  MAX_WORKSPACE_SYMBOL_QUERY_UTF8_BYTES,
  MAX_WORKSPACE_SYMBOL_RESULTS,
  workspaceSymbolQueryFitsProjection,
  workspaceSymbolsFitProjection,
} from "./workspaceSymbolProjection";

describe("workspace symbol projection", () => {
  it("accepts N results and fails the whole response at N+1", () => {
    expect(
      workspaceSymbolsFitProjection(
        Array.from({ length: MAX_WORKSPACE_SYMBOL_RESULTS }, (_, index) => symbol(index)),
      ),
    ).toBe(true);
    expect(
      workspaceSymbolsFitProjection(
        Array.from({ length: MAX_WORKSPACE_SYMBOL_RESULTS + 1 }, (_, index) => symbol(index)),
      ),
    ).toBe(false);
  });

  it("enforces UTF-8 field boundaries without partial publication", () => {
    expect(
      workspaceSymbolsFitProjection([
        { ...symbol(1), name: "😀".repeat(MAX_WORKSPACE_SYMBOL_NAME_UTF8_BYTES / 4) },
      ]),
    ).toBe(true);
    expect(
      workspaceSymbolsFitProjection([
        { ...symbol(1), name: "😀".repeat(MAX_WORKSPACE_SYMBOL_NAME_UTF8_BYTES / 4 + 1) },
      ]),
    ).toBe(false);
    expect(
      workspaceSymbolsFitProjection([
        {
          ...symbol(1),
          containerName: "x".repeat(MAX_WORKSPACE_SYMBOL_CONTAINER_UTF8_BYTES + 1),
        },
      ]),
    ).toBe(false);
  });

  it("fails the whole response when the projected aggregate exceeds 2 MiB", () => {
    expect(
      workspaceSymbolsFitProjection(
        Array.from({ length: MAX_WORKSPACE_SYMBOL_RESULTS }, (_, index) => ({
          ...symbol(index),
          containerName: "y".repeat(MAX_WORKSPACE_SYMBOL_CONTAINER_UTF8_BYTES),
          name: "x".repeat(MAX_WORKSPACE_SYMBOL_NAME_UTF8_BYTES),
        })),
      ),
    ).toBe(false);
  });

  it("validates query bytes before IPC", () => {
    expect(
      workspaceSymbolQueryFitsProjection("😀".repeat(MAX_WORKSPACE_SYMBOL_QUERY_UTF8_BYTES / 4)),
    ).toBe(true);
    expect(
      workspaceSymbolQueryFitsProjection(
        "😀".repeat(MAX_WORKSPACE_SYMBOL_QUERY_UTF8_BYTES / 4 + 1),
      ),
    ).toBe(false);
  });

  it("rejects malformed kinds, positions and reversed ranges", () => {
    expect(workspaceSymbolsFitProjection(null)).toBe(false);
    expect(workspaceSymbolsFitProjection({ length: 0 })).toBe(false);
    expect(workspaceSymbolsFitProjection([null])).toBe(false);
    expect(workspaceSymbolsFitProjection([{ ...symbol(1), kind: 27 }])).toBe(false);
    expect(
      workspaceSymbolsFitProjection([
        {
          ...symbol(1),
          location: {
            ...symbol(1).location!,
            range: {
              end: { character: 0, line: 1 },
              start: { character: 1, line: 1 },
            },
          },
        },
      ]),
    ).toBe(false);
  });
});

function symbol(index: number): LanguageServerWorkspaceSymbol {
  return {
    containerName: "App",
    kind: 5,
    location: {
      range: {
        end: { character: 1, line: index },
        start: { character: 0, line: index },
      },
      uri: `file:///project/symbol-${index}.ts`,
    },
    name: `Symbol${index}`,
  };
}
