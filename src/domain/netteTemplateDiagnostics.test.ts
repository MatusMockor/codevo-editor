import { describe, expect, it } from "vitest";
import { netteLatteReferenceDiagnostics } from "./netteTemplateDiagnostics";

describe("netteLatteReferenceDiagnostics", () => {
  it("reports a missing Latte template with source span and quick-fix data", () => {
    const source = "{include 'partials/menu'}";

    expect(
      netteLatteReferenceDiagnostics(
        source,
        "app/UI/Home/default.latte",
        ["app/UI/Home/default.latte"],
      ),
    ).toEqual([
      {
        character: 10,
        code: "nette.missingTemplate",
        data: {
          kind: "missing-template",
          name: "partials/menu",
          relativePath: "app/UI/Home/partials/menu.latte",
        },
        endCharacter: 23,
        endLine: 0,
        line: 0,
        message: "No Nette Latte template partials/menu was found.",
        severity: "warning",
        source: "Nette",
      },
    ]);
  });

  it("does not warn while the template index is empty", () => {
    expect(
      netteLatteReferenceDiagnostics(
        "{include 'partials/menu'}",
        "app/UI/Home/default.latte",
        [],
      ),
    ).toEqual([]);
  });

  it("does not warn when any candidate template exists", () => {
    expect(
      netteLatteReferenceDiagnostics(
        "{include 'partials/menu'}",
        "app/UI/Home/default.latte",
        ["app/UI/Home/partials/menu.latte"],
      ),
    ).toEqual([]);
  });

  it("ignores block and dynamic include references", () => {
    expect(
      netteLatteReferenceDiagnostics(
        "{include sidebar}\n{include $template}",
        "app/UI/Home/default.latte",
        ["app/UI/Home/default.latte"],
      ),
    ).toEqual([]);
  });
});
