import { phpNetteFrameworkProvider } from "../domain/phpFrameworkNetteProvider";
import { describe, expect, it } from "vitest";
import {
  type PhpFrameworkProvider,
} from "../domain/phpFrameworkProviders";
import { createLatteFrameworkCapabilities } from "./latteFrameworkCapabilities";

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

const TEMPLATE_ONLY_PROVIDER: PhpFrameworkProvider = {
  id: "custom-latte-template",
  latte: {
    supportsTemplateIntelligence: true,
  },
};

const PRESENTER_SOURCE = `<?php
namespace App\\UI\\Product;
class ProductPresenter extends Nette\\Application\\UI\\Presenter
{
    public function renderShow(): void {}
    public function handleDelete(): void {}
}
`;

describe("createLatteFrameworkCapabilities", () => {
  it("derives presenter-link intelligence from the active Nette provider", () => {
    const capabilities = createLatteFrameworkCapabilities(() => [
      phpNetteFrameworkProvider,
    ]);
    const linkSource = "{link Product:show}";

    expect(capabilities.supportsFactoryTemplateOwnerIntelligence()).toBe(true);

    expect(
      capabilities.detectLattePresenterLinkAt(
        linkSource,
        linkSource.indexOf("Product:show") + 2,
      ),
    ).toMatchObject({ target: "Product:show" });

    const completionSource = "{link Product:s}";
    expect(
      capabilities.lattePresenterLinkCompletionContextAt(
        completionSource,
        completionSource.indexOf("Product:s") + "Product:s".length,
      ),
    ).toMatchObject({ prefix: "Product:s" });

    const parsed = capabilities.parsePresenterLinkTarget("Product:show");
    expect(parsed).toMatchObject({ action: "show", presenter: "Product" });
    expect(
      capabilities.presenterActionMethodCandidates("show", false),
    ).toEqual(["actionShow", "renderShow"]);
    expect(parsed).not.toBeNull();
    expect(
      parsed
        ? capabilities.presenterClassCandidatePathsForLink(
            parsed,
            "app/UI/Home/default.latte",
          )
        : [],
    ).toContain("app/UI/Product/ProductPresenter.php");
    expect(capabilities.presenterScanDirectories).toEqual(["app"]);
    expect(
      capabilities.isPresenterSourcePath("app/UI/Product/ProductPresenter.php"),
    ).toBe(true);
    expect(capabilities.isPresenterSourcePath("app/Model/Product.php")).toBe(
      false,
    );
    expect(
      capabilities.presenterLinkTargetsFromSource(
        "app/UI/Product/ProductPresenter.php",
        PRESENTER_SOURCE,
      ),
    ).toEqual(expect.arrayContaining(["Product:show", "Product:delete!"]));
  });

  it("stays inert when the active provider ships no presenter-link capabilities", () => {
    const capabilities = createLatteFrameworkCapabilities(() => [
      TEMPLATE_ONLY_PROVIDER,
    ]);
    const source = "{link Product:show}";

    expect(capabilities.supportsFactoryTemplateOwnerIntelligence()).toBe(false);

    expect(
      capabilities.detectLattePresenterLinkAt(source, source.indexOf("P") + 1),
    ).toBeNull();
    expect(
      capabilities.lattePresenterLinkCompletionContextAt(
        source,
        source.length - 1,
      ),
    ).toBeNull();
    expect(capabilities.parsePresenterLinkTarget("Product:show")).toBeNull();
    expect(capabilities.presenterActionMethodCandidates("show", false)).toEqual(
      [],
    );
    expect(capabilities.presenterScanDirectories).toEqual([]);
    expect(
      capabilities.isPresenterSourcePath("app/UI/Product/ProductPresenter.php"),
    ).toBe(false);
    expect(
      capabilities.presenterLinkTargetsFromSource(
        "app/UI/Product/ProductPresenter.php",
        PRESENTER_SOURCE,
      ),
    ).toEqual([]);
  });

  it("reads the provider registry at call time", () => {
    let providers: readonly PhpFrameworkProvider[] = [];
    const capabilities = createLatteFrameworkCapabilities(() => providers);
    const source = "{link Product:show}";
    const offset = source.indexOf("Product:show") + 2;

    expect(capabilities.detectLattePresenterLinkAt(source, offset)).toBeNull();
    expect(capabilities.supportsFactoryTemplateOwnerIntelligence()).toBe(false);

    providers = [phpNetteFrameworkProvider];

    expect(capabilities.supportsFactoryTemplateOwnerIntelligence()).toBe(true);
    expect(
      capabilities.detectLattePresenterLinkAt(source, offset),
    ).toMatchObject({ target: "Product:show" });
  });

  it("delegates view-data extraction and search queries to active providers", () => {
    const capabilities = createLatteFrameworkCapabilities(() => [
      CUSTOM_LATTE_VIEW_DATA_PROVIDER,
    ]);
    const source = "<?php\n$custom = new Custom();\nassignView();\n";
    const entry = capabilities.viewDataEntryFromSource(source, [
      CUSTOM_LATTE_VIEW_DATA_PROVIDER,
    ]);

    expect(entry?.bindings[0]?.variables[0]).toMatchObject({
      name: "$custom",
      typeHint: "App\\Model\\Custom",
    });
    expect(
      capabilities.viewDataSearchQueries([CUSTOM_LATTE_VIEW_DATA_PROVIDER]),
    ).toEqual(["assignView("]);
  });
});
