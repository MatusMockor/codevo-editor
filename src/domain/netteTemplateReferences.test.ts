import { describe, expect, it } from "vitest";
import { missingLatteTemplateReferenceAt } from "./netteTemplateReferences";

describe("missingLatteTemplateReferenceAt", () => {
  it("reports a missing quoted template include relative to the current template", () => {
    const source = "{include 'partials/menu'}";

    expect(
      missingLatteTemplateReferenceAt(
        source,
        source.indexOf("menu"),
        "app/UI/Home/default.latte",
        ["app/UI/Home/default.latte"],
      ),
    ).toEqual({
      name: "partials/menu",
      nameEnd: 23,
      nameStart: 10,
      relativePath: "app/UI/Home/partials/menu.latte",
    });
  });

  it("does not report a template reference when one candidate already exists", () => {
    const source = "{include 'partials/menu'}";

    expect(
      missingLatteTemplateReferenceAt(
        source,
        source.indexOf("menu"),
        "app/UI/Home/default.latte",
        ["app/UI/Home/partials/menu.latte"],
      ),
    ).toBeNull();
  });

  it("ignores block includes and reserved layout references", () => {
    expect(
      missingLatteTemplateReferenceAt(
        "{include sidebar}",
        "{include sidebar}".indexOf("sidebar"),
        "app/UI/Home/default.latte",
        ["app/UI/Home/default.latte"],
      ),
    ).toBeNull();
    expect(
      missingLatteTemplateReferenceAt(
        "{layout none}",
        "{layout none}".indexOf("none"),
        "app/UI/Home/default.latte",
        ["app/UI/Home/default.latte"],
      ),
    ).toBeNull();
  });

  it("ignores dynamic or invalid template references", () => {
    expect(
      missingLatteTemplateReferenceAt(
        "{include $template}",
        "{include $template}".indexOf("template"),
        "app/UI/Home/default.latte",
        ["app/UI/Home/default.latte"],
      ),
    ).toBeNull();
    expect(
      missingLatteTemplateReferenceAt(
        "{include 'pkg::menu'}",
        "{include 'pkg::menu'}".indexOf("menu"),
        "app/UI/Home/default.latte",
        ["app/UI/Home/default.latte"],
      ),
    ).toBeNull();
  });
});
