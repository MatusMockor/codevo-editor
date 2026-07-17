import { describe, expect, it } from "vitest";
import {
  detectLatteNAttributeCompletionAt,
  latteNAttributeEntries,
} from "./latteAttributeCompletions";
import { LATTE_TAG_NAMES } from "./latteSyntax";

function contextAt(source: string) {
  const offset = source.indexOf("|");
  const text = source.replace("|", "");

  return detectLatteNAttributeCompletionAt(text, offset);
}

describe("latteNAttributeEntries", () => {
  it("offers core pair-tag attributes and special attributes", () => {
    const names = latteNAttributeEntries().map((entry) => entry.name);

    expect(names).toContain("n:if");
    expect(names).toContain("n:foreach");
    expect(names).toContain("n:snippet");
    expect(names).toContain("n:class");
    expect(names).toContain("n:attr");
    expect(names).toContain("n:tag");
    expect(names).toContain("n:ifcontent");
    expect(names).toContain("n:href");
    expect(names).toContain("n:name");
    expect(names).toContain("n:nonce");
    expect(names).toContain("n:syntax");
  });

  it("generates inner- and tag- variants from pair tags", () => {
    const names = latteNAttributeEntries().map((entry) => entry.name);

    expect(names).toContain("n:inner-foreach");
    expect(names).toContain("n:inner-if");
    expect(names).toContain("n:tag-if");
    expect(names).toContain("n:tag-ifset");
  });

  it("does not offer non-attribute tags or prefixed special attributes", () => {
    const names = latteNAttributeEntries().map((entry) => entry.name);

    expect(names).not.toContain("n:include");
    expect(names).not.toContain("n:var");
    expect(names).not.toContain("n:inner-class");
    expect(names).not.toContain("n:tag-href");
  });

  it("stays free of duplicates and every pair base is a known Latte tag", () => {
    const entries = latteNAttributeEntries();
    const names = entries.map((entry) => entry.name);
    const tagNames = new Set(LATTE_TAG_NAMES);
    const bases = names
      .filter((name) => !/^n:(class|attr|tag|ifcontent|href|name|nonce|syntax)$/.test(name))
      .map((name) => name.replace(/^n:(inner-|tag-)?/, ""));

    expect(new Set(names).size).toBe(names.length);
    for (const base of bases) {
      expect(tagNames.has(base)).toBe(true);
    }
    for (const entry of entries) {
      expect(entry.detail.length).toBeGreaterThan(0);
    }
  });
});

describe("detectLatteNAttributeCompletionAt", () => {
  it("detects an empty n: prefix inside an open tag", () => {
    const source = '<div n:|';
    const context = contextAt(source);

    expect(context).toEqual({
      prefix: "n:",
      replaceStart: 5,
      replaceEnd: 7,
      usedAttributes: new Set(),
    });
  });

  it("detects a partial attribute name", () => {
    const context = contextAt("<div n:fo|");

    expect(context).toMatchObject({ prefix: "n:fo", replaceStart: 5 });
  });

  it("detects on anchor tags with other attributes present", () => {
    const context = contextAt('<a class="btn" n:hr| title="x">');

    expect(context).toMatchObject({ prefix: "n:hr", replaceStart: 15 });
  });

  it("detects across multi-line tags", () => {
    const context = contextAt('<div class="x"\n     n:i|>');

    expect(context).toMatchObject({ prefix: "n:i" });
  });

  it("collects already used n: attributes for dedup", () => {
    const context = contextAt('<div n:if="$ok" n:class="$c" n:|');

    expect(context?.usedAttributes).toEqual(new Set(["n:if", "n:class"]));
  });

  it("does not fire before n: is typed", () => {
    expect(contextAt("<div n|")).toBeNull();
    expect(contextAt("<div cl|")).toBeNull();
  });

  it("does not fire inside an attribute value", () => {
    expect(contextAt('<a href="n:|')).toBeNull();
    expect(contextAt('<a title="foo n:|bar">')).toBeNull();
  });

  it("does not fire in text outside a tag", () => {
    expect(contextAt("<div>n:|</div>")).toBeNull();
    expect(contextAt("plain n:| text")).toBeNull();
  });

  it("does not fire in a closing tag", () => {
    expect(contextAt("</div n:|")).toBeNull();
  });

  it("does not fire inside a Latte expression", () => {
    expect(contextAt("<div {if n:|")).toBeNull();
    expect(contextAt("{foreach $items as n:|")).toBeNull();
  });

  it("does not fire inside masked regions", () => {
    expect(contextAt("{* <div n:| *}")).toBeNull();
    expect(contextAt("{syntax off}<div n:|{/syntax}")).toBeNull();
  });

  it("does not fire when the found tag opener lies inside a masked region", () => {
    expect(contextAt("{* see <a href *} n:|")).toBeNull();
    expect(contextAt("{syntax off}<div{/syntax} n:|")).toBeNull();
  });

  it("does not fire on lookalike attribute names", () => {
    expect(contextAt("<div data-n:|")).toBeNull();
  });

  it("does not fire when the attribute continues after the cursor", () => {
    expect(contextAt('<input n:name|="e">')).toBeNull();
    expect(contextAt("<div n:fo|reach>")).toBeNull();
  });

  it("does not fire in HTML comments or doctype", () => {
    expect(contextAt("<!-- <div n:| -->")).toBeNull();
  });
});
