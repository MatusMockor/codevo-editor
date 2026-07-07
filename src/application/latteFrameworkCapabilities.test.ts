import { describe, expect, it } from "vitest";
import type { PhpFrameworkProvider } from "../domain/phpFrameworkProviders";
import { netteLatteFrameworkCapabilities } from "./latteFrameworkCapabilities";

const CUSTOM_LATTE_TEMPLATE_PROVIDER: PhpFrameworkProvider = {
  id: "custom-latte-template",
  latte: {
    supportsTemplateIntelligence: true,
  },
};

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
  it("allows template-only Latte providers without enabling presenter links", () => {
    expect(
      netteLatteFrameworkCapabilities.supportsLatteTemplateIntelligence([
        CUSTOM_LATTE_TEMPLATE_PROVIDER,
      ]),
    ).toBe(true);
    expect(
      netteLatteFrameworkCapabilities.supportsLattePresenterLinkIntelligence([
        CUSTOM_LATTE_TEMPLATE_PROVIDER,
      ]),
    ).toBe(false);
  });

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

  it("keeps Nette presenter link parsing wired into the capability object", () => {
    const source = "$this->redirect('Product:show');";
    const detection = netteLatteFrameworkCapabilities.detectPhpPresenterLinkAt(
      source,
      source.indexOf("Product:show"),
    );

    expect(detection?.target).toBe("Product:show");
    expect(
      netteLatteFrameworkCapabilities.parsePresenterLinkTarget("Product:show"),
    ).toMatchObject({ action: "show", presenter: "Product" });
  });
});
