import { describe, expect, it } from "vitest";
import { cssColorToHex } from "./cssColor";

describe("cssColorToHex", () => {
  it("passes six digit hex colours through", () => {
    expect(cssColorToHex("#4FCDB3")).toBe("#4FCDB3");
    expect(cssColorToHex(" #0e0f10 ")).toBe("#0e0f10");
  });

  it("converts rgba colours to eight digit hex with rounded alpha", () => {
    expect(cssColorToHex("rgba(79, 205, 179, 0.13)")).toBe("#4fcdb321");
    expect(cssColorToHex("rgba(255, 255, 255, 0.07)")).toBe("#ffffff12");
    expect(cssColorToHex("rgba(0,0,0,1)")).toBe("#000000ff");
    expect(cssColorToHex("rgba(20, 24, 30, .09)")).toBe("#14181e17");
  });

  it("rejects colour syntaxes the palettes never use", () => {
    expect(() => cssColorToHex("hsl(0 0% 0%)")).toThrow("Unsupported colour value");
    expect(() => cssColorToHex("#fff")).toThrow("Unsupported colour value");
    expect(() => cssColorToHex("rgba(300, 0, 0, 0.5)")).toThrow("Unsupported colour value");
  });
});
