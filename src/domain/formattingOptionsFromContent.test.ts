import { describe, expect, it } from "vitest";
import { formattingOptionsFromContent } from "./formattingOptionsFromContent";

describe("formattingOptionsFromContent", () => {
  it("detects four-space indentation", () => {
    const content = [
      "function greet() {",
      "    const value = 1;",
      "    return value;",
      "}",
      "",
    ].join("\n");

    expect(formattingOptionsFromContent(content)).toEqual({
      insertSpaces: true,
      tabSize: 4,
    });
  });

  it("detects two-space indentation", () => {
    const content = [
      "function greet() {",
      "  const value = 1;",
      "  return value;",
      "}",
      "",
    ].join("\n");

    expect(formattingOptionsFromContent(content)).toEqual({
      insertSpaces: true,
      tabSize: 2,
    });
  });

  it("detects tab indentation", () => {
    const content = [
      "function greet() {",
      "\tconst value = 1;",
      "\treturn value;",
      "}",
      "",
    ].join("\n");

    const options = formattingOptionsFromContent(content);

    expect(options.insertSpaces).toBe(false);
  });

  it("falls back to two-space indentation for content without indentation", () => {
    expect(formattingOptionsFromContent("const value = 1;\n")).toEqual({
      insertSpaces: true,
      tabSize: 2,
    });
  });

  it("falls back to two-space indentation for empty content", () => {
    expect(formattingOptionsFromContent("")).toEqual({
      insertSpaces: true,
      tabSize: 2,
    });
  });

  it("detects nested four-space indentation", () => {
    const content = [
      "class Service {",
      "    run() {",
      "        return 1;",
      "    }",
      "}",
      "",
    ].join("\n");

    expect(formattingOptionsFromContent(content)).toEqual({
      insertSpaces: true,
      tabSize: 4,
    });
  });
});
