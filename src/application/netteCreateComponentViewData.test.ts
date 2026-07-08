import { describe, expect, it, vi } from "vitest";
import {
  netteCreateComponentViewDataEntryFromSource,
} from "./netteCreateComponentViewData";
import { factoryDerivedLatteCandidateViewNames } from "./netteFactoryDerivedLatteViewNames";
import { componentOwnerCandidatePathsForTemplate } from "./netteTemplateOwnerCandidates";

const ROOT = "/ws";

const deps = {
  resolveDeclaredType: (_source: string, typeHint: string | null) => typeHint,
};

describe("netteCreateComponentViewDataEntryFromSource", () => {
  it("extracts template variables assigned inside createComponent factories", () => {
    const source = `<?php
namespace App\\UI\\Home;

class HomePresenter
{
    protected function createComponentProductList(): ProductListControl
    {
        $control = new ProductListControl();
        /** @var \\App\\Model\\Product $product */
        $product = $this->products->get(1);
        $control->template->product = $product;

        return $control;
    }
}
`;

    expect(netteCreateComponentViewDataEntryFromSource(deps, source).bindings)
      .toEqual([
        {
          variables: [
            {
              detail: "createComponent factory",
              name: "$product",
              typeHint: "\\App\\Model\\Product",
              valueExpression: "$product",
              valueOffset: source.indexOf("$product;"),
            },
          ],
          viewName: "ProductList:default",
        },
      ]);
  });

  it("accepts Component and Widget suffixes as component template owners", () => {
    const source = `<?php
class DashboardPresenter
{
    protected function createComponentStats(): StatsWidget
    {
        $stats = new StatsWidget();
        $stats->template->total = new TotalCount();

        return $stats;
    }
}
`;

    expect(netteCreateComponentViewDataEntryFromSource(deps, source).bindings)
      .toMatchObject([
        {
          variables: [
            {
              name: "$total",
              typeHint: "TotalCount",
            },
          ],
          viewName: "Stats:default",
        },
      ]);
  });
});

describe("factoryDerivedLatteCandidateViewNames", () => {
  it("derives control owner view names from a presenter factory and active template", async () => {
    const presenterSource = `<?php
class HomePresenter
{
    protected function createComponentProductList(): App\\Components\\ProductListControl
    {
        return new App\\Components\\ProductListControl();
    }
}
`;
    const readFileContent = vi.fn(async (path: string) => {
      if (path === `${ROOT}/app/UI/Home/HomePresenter.php`) {
        return presenterSource;
      }

      throw new Error(`missing ${path}`);
    });

    await expect(
      factoryDerivedLatteCandidateViewNames({
        action: "default",
        deps: {
          joinPath: (rootPath, relativePath) => `${rootPath}/${relativePath}`,
          readFileContent,
          resolveDeclaredType: (_source, typeHint) => typeHint,
        },
        isRequestedRootActive: () => true,
        requestedRoot: ROOT,
        templateRelativePath: "app/UI/Home/product_list.latte",
      }),
    ).resolves.toEqual(["ProductList:default", "ProductList:*"]);
  });
});

describe("componentOwnerCandidatePathsForTemplate", () => {
  it("keeps presenter and colocated component owners in one deterministic list", () => {
    expect(componentOwnerCandidatePathsForTemplate("app/UI/Home/default.latte"))
      .toEqual(["app/UI/Home/HomePresenter.php"]);

    expect(
      componentOwnerCandidatePathsForTemplate(
        "app/Components/ProductList/template.latte",
      ),
    ).toContain("app/Components/ProductList/ProductListControl.php");
  });
});
