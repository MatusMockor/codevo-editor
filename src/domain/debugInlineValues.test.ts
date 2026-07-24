import { describe, expect, it } from "vitest";
import type { DebugScope, DebugVariable } from "./debug";
import {
  MAX_DEBUG_INLINE_LINE_BYTES,
  MAX_DEBUG_INLINE_RENDERED_BYTES,
  MAX_DEBUG_INLINE_ROOT_SCOPES,
  MAX_DEBUG_INLINE_SOURCE_BYTES,
  MAX_DEBUG_INLINE_SOURCE_LINES,
  MAX_DEBUG_INLINE_VALUE_BYTES,
  MAX_DEBUG_INLINE_VALUES,
  MAX_DEBUG_INLINE_VARIABLES_PER_SCOPE,
  selectDebugInlineValues,
} from "./debugInlineValues";
import {
  createDebugVariablePagesState,
  type DebugInspectionOwner,
  type DebugVariablePage,
  type DebugVariablePagesState,
} from "./debugVariablePages";

const owner: DebugInspectionOwner = {
  rootKey: "/workspace",
  sessionId: 7,
  pauseGeneration: 3,
  frameId: 11,
};

const scope = (name: string, variablesReference: number): DebugScope => ({
  expensive: false,
  name,
  variablesReference,
});

const variable = (name: string, value: string, variablesReference = 0): DebugVariable => ({
  name,
  value,
  variablesReference,
});

function stateWithPages(
  pages: Readonly<Record<number, Readonly<Record<number, DebugVariablePage>>>>,
  stateOwner: DebugInspectionOwner | null = owner,
): DebugVariablePagesState {
  const references = Object.fromEntries(
    Object.entries(pages).map(([reference, referencePages]) => [
      reference,
      { errors: {}, limit: null, pages: referencePages, pending: {} },
    ]),
  );
  return {
    ...createDebugVariablePagesState(stateOwner),
    references,
  };
}

function page(start: number, variables: readonly DebugVariable[]): DebugVariablePage {
  return { nextStart: null, start, variables };
}

function select(
  source: string,
  lineNumber: number,
  scopes: readonly DebugScope[],
  variablePages: DebugVariablePagesState,
  selectionOwner = owner,
) {
  return selectDebugInlineValues({
    lineNumber,
    owner: selectionOwner,
    scopes,
    source,
    variablePages,
  });
}

describe("debug inline values", () => {
  it("selects cached root variables on the exact stopped line with Monaco ranges", () => {
    const source = ["const skipped = 0;", "total += count;"].join("\n");
    const result = select(
      source,
      2,
      [scope("Local", 10)],
      stateWithPages({ 10: { 0: page(0, [variable("total", "41"), variable("count", "1")]) } }),
    );

    expect(result).toEqual([
      {
        content: " = 41",
        name: "total",
        range: { startLineNumber: 2, startColumn: 1, endLineNumber: 2, endColumn: 6 },
        value: "41",
      },
      {
        content: " = 1",
        name: "count",
        range: { startLineNumber: 2, startColumn: 10, endLineNumber: 2, endColumn: 15 },
        value: "1",
      },
    ]);
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result[0])).toBe(true);
    expect(Object.isFrozen(result[0]?.range)).toBe(true);
  });

  it("uses the first scope value and only the first eligible source occurrence", () => {
    const result = select(
      "value + value + fallback",
      1,
      [scope("Local", 10), scope("Closure", 20)],
      stateWithPages({
        10: { 0: page(0, [variable("value", "local")]) },
        20: { 0: page(0, [variable("value", "closure"), variable("fallback", "yes")]) },
      }),
    );

    expect(result.map(({ name, value }) => [name, value])).toEqual([
      ["value", "local"],
      ["fallback", "yes"],
    ]);
    expect(result[0]?.range.startColumn).toBe(1);
  });

  it("supports JavaScript Unicode identifiers and exact UTF-16 columns", () => {
    const result = select(
      "😀 + κόσμος + cena_ž",
      1,
      [scope("Local", 10)],
      stateWithPages({
        10: { 0: page(0, [variable("κόσμος", "world"), variable("cena_ž", "12")]) },
      }),
    );

    expect(result.map(({ name, range }) => [name, range.startColumn, range.endColumn])).toEqual([
      ["κόσμος", 6, 12],
      ["cena_ž", 15, 21],
    ]);
  });

  it("excludes property occurrences while retaining an earlier receiver and later standalone name", () => {
    const result = select(
      "user.name + user ?. name + name",
      1,
      [scope("Local", 10)],
      stateWithPages({
        10: { 0: page(0, [variable("user", "object"), variable("name", "Ada")]) },
      }),
    );

    expect(result.map(({ name, range }) => [name, range.startColumn])).toEqual([
      ["user", 1],
      ["name", 28],
    ]);
  });

  it.each([
    ["const text = 'hidden'; visible", "hidden"],
    ['const text = "hidden"; visible', "hidden"],
    ["const text = `hidden ${alsoHidden}`; visible", "alsoHidden"],
    ["const pattern = /hidden/g; visible", "hidden"],
    ["/* hidden */ visible // hidden", "hidden"],
  ])("never selects identifiers from masked literals or comments %#", (source, hidden) => {
    const result = select(
      source,
      1,
      [scope("Local", 10)],
      stateWithPages({
        10: { 0: page(0, [variable(hidden, "no"), variable("visible", "yes")]) },
      }),
    );
    expect(result.map(({ name }) => name)).toEqual(["visible"]);
  });

  it("reads page zero of root scope references only", () => {
    const result = select(
      "root firstPage laterPage nested",
      1,
      [scope("Local", 10)],
      stateWithPages({
        10: {
          0: page(0, [variable("root", "object", 99), variable("firstPage", "yes")]),
          100: page(100, [variable("laterPage", "no")]),
        },
        99: { 0: page(0, [variable("nested", "no")]) },
      }),
    );

    expect(result.map(({ name }) => name)).toEqual(["root", "firstPage"]);
  });

  it("uses exactly the first two distinct non-expensive positive root references", () => {
    const result = select(
      "local global third expensive",
      1,
      [
        { ...scope("Expensive", 40), expensive: true },
        scope("Invalid", 0),
        scope("Local", 10),
        scope("Duplicate local", 10),
        scope("Global", 20),
        scope("Third", 30),
      ],
      stateWithPages({
        10: { 0: page(0, [variable("local", "yes")]) },
        20: { 0: page(0, [variable("global", "yes")]) },
        30: { 0: page(0, [variable("third", "no")]) },
        40: { 0: page(0, [variable("expensive", "no")]) },
      }),
    );

    expect(MAX_DEBUG_INLINE_ROOT_SCOPES).toBe(2);
    expect(result.map(({ name }) => name)).toEqual(["local", "global"]);
  });

  it("does not substitute a third root when either selected page zero is absent", () => {
    const result = select(
      "first second third",
      1,
      [scope("First", 10), scope("Second", 20), scope("Third", 30)],
      stateWithPages({
        10: { 0: page(0, [variable("first", "yes")]) },
        30: { 0: page(0, [variable("third", "no")]) },
      }),
    );

    expect(result.map(({ name }) => name)).toEqual(["first"]);
  });

  it("inspects at most the first 100 variables from each selected page zero", () => {
    const locals = Array.from({ length: MAX_DEBUG_INLINE_VARIABLES_PER_SCOPE + 1 }, (_, index) =>
      variable(`local${index}`, String(index)),
    );
    const globals = Array.from({ length: MAX_DEBUG_INLINE_VARIABLES_PER_SCOPE + 1 }, (_, index) =>
      variable(`global${index}`, String(index)),
    );
    const result = select(
      "local99 local100 global99 global100 third",
      1,
      [scope("Local", 10), scope("Global", 20), scope("Third", 30)],
      stateWithPages({
        10: { 0: page(0, locals) },
        20: { 0: page(0, globals) },
        30: { 0: page(0, [variable("third", "no")]) },
      }),
    );

    expect(result.map(({ name }) => name)).toEqual(["local99", "global99"]);
  });

  it.each([
    { ...owner, rootKey: "/other" },
    { ...owner, sessionId: 8 },
    { ...owner, pauseGeneration: 4 },
    { ...owner, frameId: 12 },
  ])("fails closed when any owner field is stale %#", (stateOwner) => {
    expect(
      select(
        "value",
        1,
        [scope("Local", 10)],
        stateWithPages({ 10: { 0: page(0, [variable("value", "1")]) } }, stateOwner),
      ),
    ).toEqual([]);
  });

  it("rejects a matching but structurally invalid owner", () => {
    const invalidOwner = { ...owner, frameId: 0 };
    const state = {
      ...stateWithPages({ 10: { 0: page(0, [variable("value", "1")]) } }),
      owner: invalidOwner,
    };
    expect(select("value", 1, [scope("Local", 10)], state, invalidOwner)).toEqual([]);
  });

  it("sanitizes controls and malformed Unicode and truncates values on a UTF-8 boundary", () => {
    const exact = "ž".repeat(MAX_DEBUG_INLINE_VALUE_BYTES / 2);
    const result = select(
      "exact dirty malformed",
      1,
      [scope("Local", 10)],
      stateWithPages({
        10: {
          0: page(0, [
            variable("exact", exact),
            variable("dirty", "one\r\ntwo\t\u0000three"),
            variable("malformed", "before\ud800after"),
          ]),
        },
      }),
    );

    expect(result[0]?.value).toBe(exact);
    expect(result[1]?.value).toBe("one��two��three");
    expect(result[2]?.value).toBe("before�after");
    const truncated = select(
      "value",
      1,
      [scope("Local", 10)],
      stateWithPages({
        10: { 0: page(0, [variable("value", "ž".repeat(MAX_DEBUG_INLINE_VALUE_BYTES))]) },
      }),
    )[0]!.value;
    expect(new TextEncoder().encode(truncated).byteLength).toBeLessThanOrEqual(
      MAX_DEBUG_INLINE_VALUE_BYTES,
    );
    expect(truncated.endsWith("…")).toBe(true);
  });

  it("neutralizes bidi formatting controls and Unicode line separators", () => {
    const result = select(
      "spoof layout",
      1,
      [scope("Local", 10)],
      stateWithPages({
        10: {
          0: page(0, [
            variable("spoof", "safe\u202eevil\u202c\u2066tail\u2069"),
            variable("layout", "first\u2028second\u2029third"),
          ]),
        },
      }),
    );

    expect(result.map(({ value }) => value)).toEqual(["safe�evil��tail�", "first�second�third"]);
  });

  it("caps decorations and rendered content deterministically", () => {
    const names = Array.from({ length: MAX_DEBUG_INLINE_VALUES + 4 }, (_, index) => `v${index}`);
    const result = select(
      names.join(" + "),
      1,
      [scope("Local", 10)],
      stateWithPages({
        10: {
          0: page(
            0,
            names.map((name) => variable(name, "x".repeat(256))),
          ),
        },
      }),
    );

    expect(result).toHaveLength(MAX_DEBUG_INLINE_VALUES);
    expect(result.map(({ name }) => name)).toEqual(names.slice(0, MAX_DEBUG_INLINE_VALUES));
    expect(
      new TextEncoder().encode(result.map(({ content }) => content).join("")).byteLength,
    ).toBeLessThanOrEqual(MAX_DEBUG_INLINE_RENDERED_BYTES);
  });

  it("enforces source, line and line-count boundaries", () => {
    const state = stateWithPages({ 10: { 0: page(0, [variable("value", "1")]) } });
    const scopes = [scope("Local", 10)];
    const exactLine = `value${" ".repeat(MAX_DEBUG_INLINE_LINE_BYTES - 5)}`;
    expect(select(exactLine, 1, scopes, state)).toHaveLength(1);
    expect(select(`${exactLine} `, 1, scopes, state)).toEqual([]);

    const exactLines = `${"x\n".repeat(MAX_DEBUG_INLINE_SOURCE_LINES - 1)}value`;
    expect(select(exactLines, MAX_DEBUG_INLINE_SOURCE_LINES, scopes, state)).toHaveLength(1);
    expect(select(`${exactLines}\n`, MAX_DEBUG_INLINE_SOURCE_LINES, scopes, state)).toEqual([]);

    const exactSource = sourceOfExactBytes(MAX_DEBUG_INLINE_SOURCE_BYTES);
    expect(select(exactSource, 1, scopes, state)).toHaveLength(1);
    expect(select(`${exactSource} `, 1, scopes, state)).toEqual([]);
  });

  it("rejects invalid positions, malformed source Unicode and absent page zero", () => {
    const state = stateWithPages({ 10: { 100: page(100, [variable("value", "1")]) } });
    const scopes = [scope("Local", 10)];
    expect(select("value", 0, scopes, state)).toEqual([]);
    expect(select("value", 2, scopes, state)).toEqual([]);
    expect(select("value\ud800", 1, scopes, state)).toEqual([]);
    expect(select("value", 1, scopes, state)).toEqual([]);
  });

  it("keeps CRLF Monaco columns exact after a multiline block comment", () => {
    const result = select(
      "/* hidden\r\nstillHidden */ value",
      2,
      [scope("Local", 10)],
      stateWithPages({
        10: {
          0: page(0, [
            variable("hidden", "no"),
            variable("stillHidden", "no"),
            variable("value", "1"),
          ]),
        },
      }),
    );

    expect(result).toEqual([
      {
        content: " = 1",
        name: "value",
        range: { startLineNumber: 2, startColumn: 16, endLineNumber: 2, endColumn: 21 },
        value: "1",
      },
    ]);
  });
});

function sourceOfExactBytes(byteLength: number): string {
  const lineCount = 17;
  const separators = lineCount - 1;
  const firstLine = "value";
  let remaining = byteLength - separators - firstLine.length;
  const lines = [firstLine];
  for (let index = 1; index < lineCount; index += 1) {
    const slots = lineCount - index;
    const length = Math.floor(remaining / slots);
    lines.push(" ".repeat(length));
    remaining -= length;
  }
  return lines.join("\n");
}
