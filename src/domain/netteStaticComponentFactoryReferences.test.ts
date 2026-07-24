import { describe, expect, it } from "vitest";
import { netteStaticComponentFactoryReferences } from "./netteStaticComponentFactoryReferences";

describe("netteStaticComponentFactoryReferences", () => {
  it("projects exact static control and form names", () => {
    const source = "{control cart}\n{form 'checkoutForm'}{/form}";

    expect(netteStaticComponentFactoryReferences(source, 10)).toEqual({
      complete: true,
      references: [
        {
          end: source.indexOf("cart") + 4,
          kind: "control",
          name: "cart",
          start: source.indexOf("cart"),
        },
        {
          end: source.indexOf("checkoutForm") + "checkoutForm".length,
          kind: "form",
          name: "checkoutForm",
          start: source.indexOf("checkoutForm"),
        },
      ],
    });
  });

  it("keeps a validated render-part base and omits unsafe targets", () => {
    const source = [
      "{control $dynamic}",
      "{control grid:paginator}",
      "{control grid.child}",
      "{control broken:}",
      "{control doubled::part}",
      "{control callable()}",
      "{control indexed[$dynamic]}",
      "{control arrow->render}",
      "{control nullsafe?->render}",
      "{control Uppercase}",
      "{control _private}",
      "{form checkout extra}",
      "{* {control hidden} *}",
      "{syntax off}{control disabled}{/syntax}",
    ].join("\n");

    expect(netteStaticComponentFactoryReferences(source, 10)).toEqual({
      complete: true,
      references: [
        {
          end: source.indexOf("grid:paginator") + "grid".length,
          kind: "control",
          name: "grid",
          start: source.indexOf("grid:paginator"),
        },
      ],
    });
  });

  it("accepts only a syntactically complete render-part target", () => {
    const source = "{control grid:pagination}\n{control grid:pagination $page}";

    expect(netteStaticComponentFactoryReferences(source, 10)).toEqual({
      complete: true,
      references: [
        expect.objectContaining({ name: "grid", start: 9 }),
        expect.objectContaining({
          name: "grid",
          start: source.lastIndexOf("grid"),
        }),
      ],
    });
  });

  it("fails closed instead of returning a partial capped projection", () => {
    expect(netteStaticComponentFactoryReferences("{control one}\n{control two}", 1)).toEqual({
      complete: false,
      references: [],
    });
  });
});
