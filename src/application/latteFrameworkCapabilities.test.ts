import { describe, expect, it } from "vitest";
import type { PhpFrameworkProvider } from "../domain/phpFrameworkProviders";
import { netteLatteFrameworkCapabilities } from "./latteFrameworkCapabilities";

const CUSTOM_LATTE_VIEW_DATA_PROVIDER: PhpFrameworkProvider = {
  id: "custom-latte-view-data",
  latte: {
    supportsTemplateIntelligence: true,
  },
  viewData: {
    entryFromSource: ({ source }) => ({
      bindings: source.includes("assignView(")
        ? [
            {
              variables: [
                {
                  detail: "$custom",
                  name: "$custom",
                  typeHint: "App\\Model\\Custom",
                  valueExpression: "$custom",
                  valueOffset: source.indexOf("$custom"),
                },
              ],
              viewName: "Home:default",
            },
          ]
        : [],
      source,
    }),
    searchQueries: ["assignView("],
  },
};

describe("netteLatteFrameworkCapabilities", () => {
  it("delegates view-data extraction and search queries to active providers", () => {
    const source = "<?php\n$custom = new Custom();\nassignView();\n";
    const entry = netteLatteFrameworkCapabilities.viewDataEntryFromSource(
      source,
      [CUSTOM_LATTE_VIEW_DATA_PROVIDER],
    );

    expect(entry?.bindings[0]?.variables[0]).toMatchObject({
      name: "$custom",
      typeHint: "App\\Model\\Custom",
    });
    expect(
      netteLatteFrameworkCapabilities.viewDataSearchQueries([
        CUSTOM_LATTE_VIEW_DATA_PROVIDER,
      ]),
    ).toEqual(["assignView("]);
  });

  it("keeps Latte presenter link completion and parsing in the capability object", () => {
    const source = "{link Product:s}";
    const completion =
      netteLatteFrameworkCapabilities.lattePresenterLinkCompletionContextAt(
        source,
        source.indexOf("Product:s") + "Product:s".length,
      );

    expect(completion?.prefix).toBe("Product:s");
    expect(
      netteLatteFrameworkCapabilities.parsePresenterLinkTarget("Product:show"),
    ).toMatchObject({ action: "show", presenter: "Product" });
  });
});
