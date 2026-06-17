import { describe, expect, it } from "vitest";
import { isTypeProjectSymbol } from "./projectSymbols";

describe("isTypeProjectSymbol", () => {
  it("accepts class-like symbols and rejects callable symbols", () => {
    expect(isTypeProjectSymbol({ kind: "class" })).toBe(true);
    expect(isTypeProjectSymbol({ kind: "interface" })).toBe(true);
    expect(isTypeProjectSymbol({ kind: "trait" })).toBe(true);
    expect(isTypeProjectSymbol({ kind: "enum" })).toBe(true);

    expect(isTypeProjectSymbol({ kind: "function" })).toBe(false);
    expect(isTypeProjectSymbol({ kind: "method" })).toBe(false);
    expect(isTypeProjectSymbol({ kind: "constant" })).toBe(false);
  });
});
