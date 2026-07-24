import { describe, expect, it } from "vitest";
import { maskJavaScriptSource } from "./javascriptSourceMask";

describe("maskJavaScriptSource", () => {
  it("preserves offsets and line breaks while hiding strings and comments", () => {
    const source = "call('value'); // route()\n/* block */ next();";
    const masked = maskJavaScriptSource(source);

    expect(masked).toHaveLength(source.length);
    expect(masked.split("\n")).toHaveLength(source.split("\n").length);
    expect(masked).toContain("call(       );");
    expect(masked).toContain("next();");
    expect(masked).not.toContain("route");
    expect(masked).not.toContain("block");
  });

  it("hides template content and nested interpolation expressions", () => {
    const source = "const value = `before ${route({ id: 1 })} after`; app();";
    const masked = maskJavaScriptSource(source);

    expect(masked).toHaveLength(source.length);
    expect(masked).not.toContain("route");
    expect(masked).toContain("app();");
  });

  it("hides regex literals with escapes and character classes without masking division", () => {
    const source =
      "const example = /app.get(['\\\"]\\/ghost['\\\"], handler)/gi; const ratio = total / count; const coerced = '4' / 2; app();";
    const masked = maskJavaScriptSource(source);

    expect(masked).toHaveLength(source.length);
    expect(masked).not.toContain("ghost");
    expect(masked).toContain("const ratio = total / count;");
    expect(masked).toContain("const coerced =     / 2;");
    expect(masked).toContain("app();");
  });

  it("recognizes regex statement bodies after control headers but preserves call division", () => {
    const source = [
      "if (enabled) /if-pattern/.test(value);",
      "while (ready()) /while-pattern/.test(value);",
      "for (; ready();) /for-pattern/.test(value);",
      "with (context) /with-pattern/.test(value);",
      "catch (error) /catch-pattern/.test(value);",
      "const ratio = compute() / divisor;",
      "const groupedRatio = (total + extra) / divisor;",
    ].join("\n");
    const masked = maskJavaScriptSource(source);

    expect(masked).toHaveLength(source.length);
    expect(masked).not.toMatch(/(?:if|while|for|with|catch)-pattern/);
    expect(masked).toContain("const ratio = compute() / divisor;");
    expect(masked).toContain("const groupedRatio = (total + extra) / divisor;");
  });
});
