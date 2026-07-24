import { describe, expect, it } from "vitest";
import {
  MAX_DEBUG_HOVER_EXPRESSION_BYTES,
  MAX_DEBUG_HOVER_LINE_BYTES,
  MAX_DEBUG_HOVER_SOURCE_BYTES,
  MAX_DEBUG_HOVER_SOURCE_LINES,
  createDebugHoverExpressionIndex,
} from "./debugHoverExpression";

describe("debug hover expression index", () => {
  it.each([
    ["const total = invoice.total;", 15, "invoice.total", 15, 28],
    ["const total = invoice.total;", 23, "invoice.total", 15, 28],
    ["const total = invoice?.customer.name;", 29, "invoice?.customer.name", 15, 37],
    ["const total = κόσμος.τιμή;", 23, "κόσμος.τιμή", 15, 26],
    ["const total = invoice . total;", 25, "invoice . total", 15, 30],
  ])(
    "extracts the bounded member expression at a hovered identifier %#",
    (source, column, expression, startColumn, endColumn) => {
      expect(createDebugHoverExpressionIndex(source)?.at({ lineNumber: 1, column })).toEqual({
        expression,
        range: { startLineNumber: 1, startColumn, endLineNumber: 1, endColumn },
      });
    },
  );

  it("reuses one immutable full-source mask across lookups", () => {
    const source = ["const first = user.name;", "const second = account.id;"].join("\n");
    const index = createDebugHoverExpressionIndex(source);
    expect(Object.isFrozen(index)).toBe(true);
    expect(index?.at({ lineNumber: 1, column: 17 })?.expression).toBe("user.name");
    expect(index?.at({ lineNumber: 2, column: 18 })?.expression).toBe("account.id");
  });

  it.each([
    ["/* user.name\nstill.hidden */ const visible = account.id;", 2, 8],
    ["const text = `user.name`; const visible = account.id;", 1, 20],
    ["const pattern = /user\\.name/; const visible = account.id;", 1, 20],
    ["const text = `before ${user.name} after`;", 1, 25],
  ])("does not evaluate masked source content %#", (source, lineNumber, column) => {
    expect(createDebugHoverExpressionIndex(source)?.at({ lineNumber, column })).toBeNull();
  });

  it.each([
    ["getUser().name", 11],
    ["users[0].name", 10],
    ["user.name()", 6],
    ["user.#name", 8],
    ["user.", 2],
    [".name", 3],
    ["return user", 3],
  ])("fails closed for unsupported or incomplete syntax %#", (source, column) => {
    expect(createDebugHoverExpressionIndex(source)?.at({ lineNumber: 1, column })).toBeNull();
  });

  it("rejects dots, whitespace, end columns and malformed positions", () => {
    const index = createDebugHoverExpressionIndex("user.name");
    for (const position of [
      { lineNumber: 1, column: 5 },
      { lineNumber: 1, column: 10 },
      { lineNumber: 0, column: 1 },
      { lineNumber: 1, column: 0 },
      { lineNumber: 2, column: 1 },
      { lineNumber: 1, column: Number.MAX_SAFE_INTEGER + 1 },
    ]) {
      expect(index?.at(position)).toBeNull();
    }
  });

  it("accepts exact construction caps and rejects every over-limit boundary", () => {
    const exactSource = `value${" ".repeat(MAX_DEBUG_HOVER_SOURCE_BYTES - 5)}`;
    expect(createDebugHoverExpressionIndex(exactSource)).not.toBeNull();
    expect(createDebugHoverExpressionIndex(`${exactSource} `)).toBeNull();
    const exactLines = `${"x\n".repeat(MAX_DEBUG_HOVER_SOURCE_LINES - 1)}x`;
    expect(createDebugHoverExpressionIndex(exactLines)).not.toBeNull();
    expect(createDebugHoverExpressionIndex("x\n".repeat(MAX_DEBUG_HOVER_SOURCE_LINES))).toBeNull();

    const exactLine = `value${" ".repeat(MAX_DEBUG_HOVER_LINE_BYTES - 5)}`;
    expect(
      createDebugHoverExpressionIndex(exactLine)?.at({ lineNumber: 1, column: 2 }),
    ).not.toBeNull();
    const longLine = `${exactLine} `;
    expect(
      createDebugHoverExpressionIndex(longLine)?.at({ lineNumber: 1, column: longLine.length }),
    ).toBeNull();
    const exactExpression = "x".repeat(MAX_DEBUG_HOVER_EXPRESSION_BYTES);
    expect(
      createDebugHoverExpressionIndex(exactExpression)?.at({ lineNumber: 1, column: 1 })
        ?.expression,
    ).toBe(exactExpression);
    const longExpression = "x".repeat(MAX_DEBUG_HOVER_EXPRESSION_BYTES + 1);
    expect(
      createDebugHoverExpressionIndex(longExpression)?.at({ lineNumber: 1, column: 1 }),
    ).toBeNull();
  });

  it.each(["\ud800", "\udc00"])("rejects malformed Unicode source %j", (surrogate) => {
    expect(createDebugHoverExpressionIndex(`const ${surrogate} = 1;`)).toBeNull();
  });

  it("uses UTF-8 rather than UTF-16 for source and line caps", () => {
    expect(
      createDebugHoverExpressionIndex("ž".repeat(MAX_DEBUG_HOVER_SOURCE_BYTES / 2)),
    ).not.toBeNull();
    expect(
      createDebugHoverExpressionIndex("ž".repeat(MAX_DEBUG_HOVER_SOURCE_BYTES / 2 + 1)),
    ).toBeNull();
    const line = `value${"ž".repeat(MAX_DEBUG_HOVER_LINE_BYTES / 2)}`;
    expect(createDebugHoverExpressionIndex(line)?.at({ lineNumber: 1, column: 2 })).toBeNull();
  });
});
