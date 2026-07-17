import { describe, expect, it } from "vitest";
import { parseLatteTemplateRelations } from "./latteBlockGraph";

describe("parseLatteTemplateRelations", () => {
  it("parses quoted extends, layout, import and embed targets with spans", () => {
    const source = [
      "{extends '../@layout.latte'}",
      "{import 'blocks.latte'}",
      "{embed \"partials/box.latte\"}{/embed}",
    ].join("\n");

    const parsed = parseLatteTemplateRelations(source);

    expect(parsed.hasParentTag).toBe(true);
    expect(parsed.relations).toEqual([
      {
        kind: "extends",
        path: "../@layout.latte",
        pathSpan: { end: 26, start: 10 },
      },
      {
        kind: "import",
        path: "blocks.latte",
        pathSpan: {
          end: source.indexOf("blocks.latte") + "blocks.latte".length,
          start: source.indexOf("blocks.latte"),
        },
      },
      {
        kind: "embed",
        path: "partials/box.latte",
        pathSpan: {
          end: source.indexOf("partials/box.latte") + "partials/box.latte".length,
          start: source.indexOf("partials/box.latte"),
        },
      },
    ]);
  });

  it("parses a bare layout target that looks like a file path", () => {
    const parsed = parseLatteTemplateRelations("{layout ../@layout.latte}");

    expect(parsed.hasParentTag).toBe(true);
    expect(parsed.relations).toEqual([
      {
        kind: "layout",
        path: "../@layout.latte",
        pathSpan: { end: 24, start: 8 },
      },
    ]);
  });

  it("treats extends none and layout none as parent tags without targets", () => {
    for (const source of ["{extends none}", "{layout none}"]) {
      const parsed = parseLatteTemplateRelations(source);

      expect(parsed.hasParentTag).toBe(true);
      expect(parsed.relations).toEqual([]);
    }
  });

  it("keeps auto layout lookup enabled for extends auto", () => {
    const parsed = parseLatteTemplateRelations("{extends auto}");

    expect(parsed.hasParentTag).toBe(false);
    expect(parsed.relations).toEqual([]);
  });

  it("suppresses auto layout for a dynamic parent target without guessing", () => {
    const parsed = parseLatteTemplateRelations("{extends $layoutFile}");

    expect(parsed.hasParentTag).toBe(true);
    expect(parsed.relations).toEqual([]);
  });

  it("skips dynamic and non-file import targets without marking a parent", () => {
    const parsed = parseLatteTemplateRelations("{import $file}\n{import block}");

    expect(parsed.hasParentTag).toBe(false);
    expect(parsed.relations).toEqual([]);
  });

  it("ignores relation tags inside comments and syntax-off regions", () => {
    const source = [
      "{* {extends 'commented.latte'} *}",
      "{syntax off}{import 'masked.latte'}{/syntax}",
      "{import 'real.latte'}",
    ].join("\n");

    const parsed = parseLatteTemplateRelations(source);

    expect(parsed.relations.map((relation) => relation.path)).toEqual([
      "real.latte",
    ]);
  });

  it("ignores closing tags and unrelated tags", () => {
    const parsed = parseLatteTemplateRelations(
      "{embed 'box.latte'}{block a}x{/block}{/embed}{include 'other.latte'}",
    );

    expect(parsed.relations).toEqual([
      {
        kind: "embed",
        path: "box.latte",
        pathSpan: { end: 17, start: 8 },
      },
    ]);
  });

  it("treats an unclosed quoted parent target as a parent without a relation", () => {
    const parsed = parseLatteTemplateRelations("{extends 'broken.latte\n}");

    expect(parsed.hasParentTag).toBe(true);
    expect(parsed.relations).toEqual([]);
  });

  it("reports no dynamic relation for static, auto, and none targets", () => {
    const source = [
      "{extends '../@layout.latte'}",
      "{import 'blocks.latte'}",
      "{layout none}",
      "{extends auto}",
    ].join("\n");

    expect(parseLatteTemplateRelations(source).hasDynamicRelation).toBe(false);
  });

  it("reports a dynamic relation for a variable parent target", () => {
    const parsed = parseLatteTemplateRelations("{extends $layoutFile}");

    expect(parsed.hasDynamicRelation).toBe(true);
  });

  it("reports a dynamic relation for unresolvable relation targets", () => {
    expect(
      parseLatteTemplateRelations("{extends 'broken.latte\n}").hasDynamicRelation,
    ).toBe(true);
    expect(
      parseLatteTemplateRelations("{import block}").hasDynamicRelation,
    ).toBe(true);
  });

  it("ignores dynamic relations inside comments and syntax-off regions", () => {
    const parsed = parseLatteTemplateRelations(
      "{* {extends $commented} *}\n{syntax off}{import $masked}{/syntax}",
    );

    expect(parsed.hasDynamicRelation).toBe(false);
  });
});
