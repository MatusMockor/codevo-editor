import { describe, expect, it } from "vitest";
import { latteGrammar } from "../infrastructure/grammars/latteGrammar";
import {
  LATTE_TAGS,
  detectLatteIncludeCompletionAt,
  detectLatteReferenceAt,
  detectLatteTagCompletionAt,
  isInsideLatteComment,
} from "./latteNavigation";

/**
 * Returns the offset of the FIRST occurrence of `needle` in `source`, advanced
 * by `withinOffset` characters so a test can target a precise cursor position.
 */
function offsetOf(source: string, needle: string, withinOffset = 0): number {
  const index = source.indexOf(needle);

  if (index < 0) {
    throw new Error(`needle not found in source: ${needle}`);
  }

  return index + withinOffset;
}

describe("detectLatteReferenceAt", () => {
  it("detects an {include 'file.latte'} as a template reference", () => {
    const source = "{include 'parts/menu.latte'}";
    const offset = offsetOf(source, "parts/menu.latte", 2);

    expect(detectLatteReferenceAt(source, offset)).toEqual({
      kind: "template",
      tag: "include",
      name: "parts/menu.latte",
      nameStart: source.indexOf("parts/menu.latte"),
      nameEnd: source.indexOf("parts/menu.latte") + "parts/menu.latte".length,
    });
  });

  it("detects an include with the cursor just after the closing quote", () => {
    const source = "{include 'menu.latte'}";
    const offset = source.indexOf("'}") + 1;

    expect(detectLatteReferenceAt(source, offset)?.kind).toBe("template");
    expect(detectLatteReferenceAt(source, offset)?.name).toBe("menu.latte");
  });

  it("supports double-quoted include literals", () => {
    const source = "{include \"menu.latte\"}";
    const offset = offsetOf(source, "menu.latte", 2);

    expect(detectLatteReferenceAt(source, offset)?.name).toBe("menu.latte");
  });

  it("detects an unquoted include path as a template reference", () => {
    const source = "{include partials/@showHeader.latte}";
    const offset = offsetOf(source, "@showHeader", 2);

    expect(detectLatteReferenceAt(source, offset)).toEqual({
      kind: "template",
      tag: "include",
      name: "partials/@showHeader.latte",
      nameStart: source.indexOf("partials/@showHeader.latte"),
      nameEnd:
        source.indexOf("partials/@showHeader.latte") +
        "partials/@showHeader.latte".length,
    });
  });

  it("stops an unquoted include path before named arguments", () => {
    const source = "{include partials/@showSubmenu.latte 'group' => $group}";
    const offset = offsetOf(source, "@showSubmenu", 2);

    expect(detectLatteReferenceAt(source, offset)).toMatchObject({
      kind: "template",
      name: "partials/@showSubmenu.latte",
    });
  });

  it("detects a {layout '...'} template reference", () => {
    const source = "{layout '../@layout.latte'}";
    const offset = offsetOf(source, "@layout.latte", 2);

    expect(detectLatteReferenceAt(source, offset)).toEqual({
      kind: "template",
      tag: "layout",
      name: "../@layout.latte",
      nameStart: source.indexOf("../@layout.latte"),
      nameEnd: source.indexOf("../@layout.latte") + "../@layout.latte".length,
    });
  });

  it("detects an {extends '...'} template reference", () => {
    const source = "{extends 'base.latte'}";
    const offset = offsetOf(source, "base.latte", 1);

    expect(detectLatteReferenceAt(source, offset)?.kind).toBe("template");
    expect(detectLatteReferenceAt(source, offset)?.tag).toBe("extends");
  });

  it("detects an {import '...'} template reference", () => {
    const source = "{import 'blocks.latte'}";
    const offset = offsetOf(source, "blocks.latte", 1);

    expect(detectLatteReferenceAt(source, offset)?.tag).toBe("import");
    expect(detectLatteReferenceAt(source, offset)?.kind).toBe("template");
  });

  it("detects an {embed '...'} template reference", () => {
    const source = "{embed 'card.latte'}";
    const offset = offsetOf(source, "card.latte", 1);

    expect(detectLatteReferenceAt(source, offset)?.tag).toBe("embed");
    expect(detectLatteReferenceAt(source, offset)?.kind).toBe("template");
  });

  it("detects a {sandbox '...'} template reference", () => {
    const source = "{sandbox 'untrusted.latte'}";
    const offset = offsetOf(source, "untrusted.latte", 1);

    expect(detectLatteReferenceAt(source, offset)?.tag).toBe("sandbox");
    expect(detectLatteReferenceAt(source, offset)?.kind).toBe("template");
  });

  it("classifies a bare {include blockname} as a block reference", () => {
    const source = "{include sidebar}";
    const offset = offsetOf(source, "sidebar", 2);

    expect(detectLatteReferenceAt(source, offset)).toEqual({
      kind: "block",
      tag: "include",
      name: "sidebar",
      nameStart: source.indexOf("sidebar"),
      nameEnd: source.indexOf("sidebar") + "sidebar".length,
    });
  });

  it("classifies an {include #blockname} form as a block reference", () => {
    const source = "{include #sidebar}";
    const offset = offsetOf(source, "sidebar", 2);

    expect(detectLatteReferenceAt(source, offset)?.kind).toBe("block");
    expect(detectLatteReferenceAt(source, offset)?.name).toBe("sidebar");
  });

  it("declines reserved include targets (parent / this)", () => {
    const parent = "{include parent}";
    const self = "{include this}";

    expect(
      detectLatteReferenceAt(parent, offsetOf(parent, "parent", 2)),
    ).toBeNull();
    expect(detectLatteReferenceAt(self, offsetOf(self, "this", 2))).toBeNull();
  });

  it("detects a {control name} as a control reference", () => {
    const source = "{control paginator}";
    const offset = offsetOf(source, "paginator", 3);

    expect(detectLatteReferenceAt(source, offset)).toEqual({
      kind: "control",
      tag: "control",
      name: "paginator",
      nameStart: source.indexOf("paginator"),
      nameEnd: source.indexOf("paginator") + "paginator".length,
    });
  });

  it("detects a {block name} as a block reference", () => {
    const source = "{block content}";
    const offset = offsetOf(source, "content", 2);

    expect(detectLatteReferenceAt(source, offset)?.kind).toBe("block");
    expect(detectLatteReferenceAt(source, offset)?.tag).toBe("block");
    expect(detectLatteReferenceAt(source, offset)?.name).toBe("content");
  });

  it("detects a {define name} as a block reference", () => {
    const source = "{define scripts}";
    const offset = offsetOf(source, "scripts", 2);

    expect(detectLatteReferenceAt(source, offset)?.tag).toBe("define");
    expect(detectLatteReferenceAt(source, offset)?.kind).toBe("block");
  });

  it("returns null when the cursor is on the tag name, not the argument", () => {
    const source = "{include 'menu.latte'}";
    const offset = offsetOf(source, "include", 3);

    expect(detectLatteReferenceAt(source, offset)).toBeNull();
  });

  it("returns null for an anonymous {block} with no name", () => {
    const source = "{block}";
    const offset = source.indexOf("block") + 2;

    expect(detectLatteReferenceAt(source, offset)).toBeNull();
  });

  it("returns null for a closing {/block} tag", () => {
    const source = "{/block}";
    const offset = offsetOf(source, "block", 2);

    expect(detectLatteReferenceAt(source, offset)).toBeNull();
  });

  it("returns null inside a {* comment *}", () => {
    const source = "{* {include 'menu.latte'} *}";
    const offset = offsetOf(source, "menu.latte", 2);

    expect(detectLatteReferenceAt(source, offset)).toBeNull();
  });

  it("returns null inside a {syntax off} block", () => {
    const source = "{syntax off}{include 'menu.latte'}{/syntax}";
    const offset = offsetOf(source, "menu.latte", 2);

    expect(detectLatteReferenceAt(source, offset)).toBeNull();
  });

  it("returns null for a namespaced include literal", () => {
    const source = "{include 'pkg::menu.latte'}";
    const offset = offsetOf(source, "menu.latte", 2);

    expect(detectLatteReferenceAt(source, offset)).toBeNull();
  });

  it("returns null on a plain variable echo {$var}", () => {
    const source = "{$product}";
    const offset = offsetOf(source, "product", 2);

    expect(detectLatteReferenceAt(source, offset)).toBeNull();
  });

  it("returns null on plain html outside any macro", () => {
    const source = "<div>plain text</div>";
    const offset = offsetOf(source, "plain", 2);

    expect(detectLatteReferenceAt(source, offset)).toBeNull();
  });

  it("returns null once the cursor moves past the closing brace", () => {
    const source = "{include 'menu.latte'} tail";
    const offset = offsetOf(source, "tail", 2);

    expect(detectLatteReferenceAt(source, offset)).toBeNull();
  });

  it("does not treat a `{*` inside a string literal as a fake comment start (F1)", () => {
    const source = "{$path . '{*'}\n{include 'real.latte'}";
    const offset = offsetOf(source, "real.latte", 2);

    expect(detectLatteReferenceAt(source, offset)).toEqual({
      kind: "template",
      tag: "include",
      name: "real.latte",
      nameStart: source.indexOf("real.latte"),
      nameEnd: source.indexOf("real.latte") + "real.latte".length,
    });
  });

  it("does not treat a `{syntax off}` written inside a closed comment as an open block (F2)", () => {
    const source = "{* {syntax off} *}\n{include 'real.latte'}";
    const offset = offsetOf(source, "real.latte", 2);

    expect(detectLatteReferenceAt(source, offset)?.name).toBe("real.latte");
  });

  it("masks a {syntax off} block with irregular internal whitespace, matching latteSyntax (F3)", () => {
    const source = "{syntax  off}{include 'menu.latte'}{/syntax}";
    const offset = offsetOf(source, "menu.latte", 2);

    expect(detectLatteReferenceAt(source, offset)).toBeNull();
  });
});

describe("detectLatteTagCompletionAt", () => {
  it("returns an empty prefix immediately after {", () => {
    const source = "<div>{</div>";
    const offset = offsetOf(source, "{") + 1;

    expect(detectLatteTagCompletionAt(source, offset)).toEqual({
      prefix: "",
      start: source.indexOf("{"),
    });
  });

  it("returns the partial tag prefix being typed", () => {
    const source = "<div>{fore</div>";
    const offset = offsetOf(source, "{fore") + "{fore".length;

    expect(detectLatteTagCompletionAt(source, offset)).toEqual({
      prefix: "fore",
      start: source.indexOf("{"),
    });
  });

  it("recognises a closing tag prefix {/fore", () => {
    const source = "{/fore";
    const offset = source.length;

    expect(detectLatteTagCompletionAt(source, offset)).toEqual({
      prefix: "fore",
      start: 0,
    });
  });

  it("returns null when not after an opening brace", () => {
    const source = "plain text";
    const offset = offsetOf(source, "text", 2);

    expect(detectLatteTagCompletionAt(source, offset)).toBeNull();
  });

  it("returns null inside a {* comment *}", () => {
    const source = "{* {inc *}";
    const offset = offsetOf(source, "{inc") + "{inc".length;

    expect(detectLatteTagCompletionAt(source, offset)).toBeNull();
  });

  it("returns null inside a {syntax off} block", () => {
    const source = "{syntax off}{inc{/syntax}";
    const offset = offsetOf(source, "{inc") + "{inc".length;

    expect(detectLatteTagCompletionAt(source, offset)).toBeNull();
  });
});

describe("detectLatteIncludeCompletionAt", () => {
  it("detects a template-name completion inside an include literal", () => {
    const source = "{include 'parts/me'}";
    const offset = offsetOf(source, "'parts/me") + "'parts/me".length;

    expect(detectLatteIncludeCompletionAt(source, offset)).toEqual({
      tag: "include",
      prefix: "parts/me",
      replaceStart: source.indexOf("parts/me"),
      replaceEnd: source.indexOf("parts/me") + "parts/me".length,
    });
  });

  it("offers a completion with an empty prefix right after the quote", () => {
    const source = "{include '";
    const offset = source.length;

    expect(detectLatteIncludeCompletionAt(source, offset)).toEqual({
      tag: "include",
      prefix: "",
      replaceStart: source.length,
      replaceEnd: source.length,
    });
  });

  it("detects a completion inside a {layout '...'} literal", () => {
    const source = "{layout 'ba'}";
    const offset = offsetOf(source, "'ba") + "'ba".length;

    expect(detectLatteIncludeCompletionAt(source, offset)?.tag).toBe("layout");
    expect(detectLatteIncludeCompletionAt(source, offset)?.prefix).toBe("ba");
  });

  it("returns null for a bare block include (no quote)", () => {
    const source = "{include sideb}";
    const offset = offsetOf(source, "sideb") + "sideb".length;

    expect(detectLatteIncludeCompletionAt(source, offset)).toBeNull();
  });

  it("returns null inside a {* comment *}", () => {
    const source = "{* {include 'me *}";
    const offset = offsetOf(source, "'me") + "'me".length;

    expect(detectLatteIncludeCompletionAt(source, offset)).toBeNull();
  });
});

describe("LATTE_TAGS", () => {
  it("contains key Latte tags", () => {
    for (const tag of [
      "if",
      "foreach",
      "include",
      "layout",
      "extends",
      "block",
      "define",
      "control",
      "embed",
      "import",
    ]) {
      expect(LATTE_TAGS).toContain(tag);
    }
  });

  it("has no duplicate entries", () => {
    expect(new Set(LATTE_TAGS).size).toBe(LATTE_TAGS.length);
  });

  it("stays in sync with the grammar tag allowlist", () => {
    const begin = String(latteGrammar.repository?.["latte-tag"]?.begin ?? "");
    const alternation = /\(\?:\(([^)]*)\)/.exec(begin)?.[1] ?? "";
    const grammarTags = alternation.split("|").filter((tag) => tag.length > 0);

    expect(new Set(LATTE_TAGS)).toEqual(new Set(grammarTags));
  });
});

describe("isInsideLatteComment", () => {
  it("reports offsets inside a comment", () => {
    const source = "before {* hidden *} after";
    expect(isInsideLatteComment(source, offsetOf(source, "hidden"))).toBe(true);
  });

  it("reports offsets outside a comment as false", () => {
    const source = "before {* hidden *} after";
    expect(isInsideLatteComment(source, offsetOf(source, "after"))).toBe(false);
  });

  it("treats an unterminated comment as running to the end", () => {
    const source = "text {* never closed";
    expect(isInsideLatteComment(source, source.length)).toBe(true);
  });
});

describe("hang safety", () => {
  it("handles an empty source", () => {
    expect(detectLatteReferenceAt("", 0)).toBeNull();
    expect(detectLatteTagCompletionAt("", 0)).toBeNull();
    expect(detectLatteIncludeCompletionAt("", 0)).toBeNull();
  });

  it("handles a source that is a single open brace", () => {
    expect(detectLatteReferenceAt("{", 1)).toBeNull();
    expect(detectLatteTagCompletionAt("{", 1)).toEqual({ prefix: "", start: 0 });
  });

  it("handles an unterminated include tag", () => {
    const source = "{include 'menu.latte";
    const offset = offsetOf(source, "menu", 2);

    expect(() => detectLatteReferenceAt(source, offset)).not.toThrow();
  });

  it("stays linear on a large document", () => {
    const source = `${"x".repeat(200000)}{include 'menu.latte'}`;
    const offset = source.indexOf("menu.latte") + 2;

    const started = Date.now();
    const result = detectLatteReferenceAt(source, offset);
    const elapsed = Date.now() - started;

    expect(result?.name).toBe("menu.latte");
    expect(elapsed).toBeLessThan(1000);
  });

  it("does not detect a construct nested inside a comment in a large document", () => {
    const source = `${"y".repeat(50000)}{* {include 'menu.latte'} *}`;
    const offset = source.indexOf("menu.latte") + 2;

    expect(detectLatteReferenceAt(source, offset)).toBeNull();
  });

  it("handles out-of-range offsets", () => {
    expect(detectLatteReferenceAt("{include 'a.latte'}", -5)).toBeNull();
    expect(detectLatteReferenceAt("{include 'a.latte'}", 9999)).toBeNull();
  });
});
