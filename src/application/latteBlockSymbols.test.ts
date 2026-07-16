import { describe, expect, it } from "vitest";
import {
  isValidLatteBlockSymbolName,
  latteBlockIncludeCompletionAt,
  latteBlockSymbolOccurrenceAt,
  latteBlockSymbolOccurrences,
} from "./latteBlockSymbols";

const FIXTURE = `{* {block #emptyState}{/block emptyState} *}
{block #emptyState}
  <p>No rows</p>
{/block emptyState}

{define tableRow, $row}
  <tr><td>{$row->id}</td></tr>
{/define tableRow}

{block local helper}<i />{/block helper}
{include block tableRow, row: $row}
{include #emptyState}
{include helper}`;

function offsetOf(text: string, occurrence = 0): number {
  let offset = -1;

  for (let index = 0; index <= occurrence; index += 1) {
    offset = FIXTURE.indexOf(text, offset + 1);
  }

  return offset;
}

describe("Latte block symbols", () => {
  it("finds declarations, includes, and matching named closers by exact name", () => {
    expect(
      latteBlockSymbolOccurrences(FIXTURE, "tableRow").map(({ kind, span }) => [
        kind,
        FIXTURE.slice(span.start, span.end),
      ]),
    ).toEqual([
      ["declaration", "tableRow"],
      ["closing", "tableRow"],
      ["include", "tableRow"],
    ]);
    expect(latteBlockSymbolOccurrences(FIXTURE, "emptyState")).toHaveLength(3);
    expect(latteBlockSymbolOccurrences(FIXTURE, "decoy")).toEqual([]);
  });

  it("reports the occurrence at an opening, include, or named closer", () => {
    expect(latteBlockSymbolOccurrenceAt(FIXTURE, offsetOf("tableRow", 0) + 2)).toMatchObject({
      declarationKind: "define",
      kind: "declaration",
      name: "tableRow",
    });
    expect(latteBlockSymbolOccurrenceAt(FIXTURE, offsetOf("tableRow", 1) + 2)).toMatchObject({
      declarationSpan: { start: offsetOf("tableRow", 0) },
      kind: "closing",
      name: "tableRow",
    });
    expect(latteBlockSymbolOccurrenceAt(FIXTURE, offsetOf("tableRow", 2) + 2)).toMatchObject({
      kind: "include",
      name: "tableRow",
    });
  });

  it("completes same-file declarations for bare, block-marker, and hash includes", () => {
    for (const suffix of ["{include ta", "{include block ta", "{include #ta"]) {
      const source = `${FIXTURE}\n${suffix}`;
      const completion = latteBlockIncludeCompletionAt(source, source.length);

      expect(completion?.prefix).toBe("ta");
      expect(completion?.candidates.map(({ name }) => name)).toEqual(["tableRow"]);
      expect(source.slice(completion!.replaceSpan.start, completion!.replaceSpan.end)).toBe("ta");
    }
  });

  it("replaces the complete existing block token when invoked mid-name", () => {
    const source = `${FIXTURE}\n{include tableRow}`;
    const nameStart = source.lastIndexOf("tableRow");
    const completion = latteBlockIncludeCompletionAt(source, nameStart + 3);

    expect(completion?.prefix).toBe("tab");
    expect(completion?.replaceSpan).toEqual({
      end: nameStart + "tableRow".length,
      start: nameStart,
    });
  });

  it("leaves bare dotted includes to template-path completion", () => {
    const declaration = "{block #price.total}<span />{/block price.total}";
    const bare = `${declaration}\n{include price.to`;
    const hashed = `${declaration}\n{include #price.to`;
    const explicit = `${declaration}\n{include block price.to`;

    expect(latteBlockIncludeCompletionAt(bare, bare.length)).toBeNull();
    expect(
      latteBlockIncludeCompletionAt(hashed, hashed.length)?.candidates.map(
        ({ name }) => name,
      ),
    ).toEqual(["price.total"]);
    expect(
      latteBlockIncludeCompletionAt(explicit, explicit.length)?.candidates.map(
        ({ name }) => name,
      ),
    ).toEqual(["price.total"]);
  });

  it("does not complete through an unterminated syntax-off region", () => {
    const source = `${FIXTURE}\n{syntax off}\n{include ta`;

    expect(latteBlockIncludeCompletionAt(source, source.length)).toBeNull();
  });

  it("rejects a nested include-looking string inside a malformed outer tag", () => {
    const source = `${FIXTURE}\n{$value = '{include ta`;

    expect(latteBlockIncludeCompletionAt(source, source.length)).toBeNull();
  });

  it("does not confuse local headers, file includes, comments, or malformed input with completion", () => {
    const cases = [
      "{block local hel",
      "{include 'partials/ta",
      "{include partials/ta",
      "{include $dynamic",
      "{* {include ta",
      "{include ta, row:",
    ];

    for (const suffix of cases) {
      const source = `${FIXTURE}\n${suffix}`;
      expect(latteBlockIncludeCompletionAt(source, source.length)).toBeNull();
    }
  });

  it("validates rename targets without accepting include-reserved names", () => {
    expect(isValidLatteBlockSymbolName("row.compact-state")).toBe(true);
    expect(isValidLatteBlockSymbolName("9rows")).toBe(false);
    expect(isValidLatteBlockSymbolName("row card")).toBe(false);
    expect(isValidLatteBlockSymbolName("parent")).toBe(false);
  });
});
