import { describe, expect, it } from "vitest";
import {
  NETTE_VIEW_DATA_SEARCH_QUERIES,
  netteTemplateClassPropertiesFromSource,
  netteViewDataEntryFromSource,
} from "./netteViewData";

describe("netteViewDataEntryFromSource", () => {
  it("extracts $this->template->x assignments scoped to the render action", () => {
    const source = `<?php
namespace App\\Presenters;

use App\\Model\\Product;

class ProductPresenter extends BasePresenter
{
    public function renderShow(int $id): void
    {
        /** @var Product $product */
        $product = $this->products->get($id);
        $this->template->product = $product;
        $this->template->title = 'Detail';
    }
}
`;

    expect(netteViewDataEntryFromSource(source).bindings).toEqual([
      {
        viewName: "Product:show",
        variables: [
          {
            detail: "render/action parameter",
            name: "$id",
            typeHint: "int",
            valueExpression: "$id",
            valueOffset: source.indexOf("$id"),
          },
          {
            detail: "template data",
            name: "$product",
            typeHint: "Product",
            valueExpression: "$product",
            valueOffset: source.indexOf("$product;"),
          },
          {
            detail: "template data",
            name: "$title",
            typeHint: null,
            valueExpression: "'Detail'",
            valueOffset: source.indexOf("'Detail'"),
          },
        ],
      },
    ]);
  });

  it("extracts setParameters([...]) entries for action* methods", () => {
    const source = `<?php

class OrderPresenter extends BasePresenter
{
    public function actionDetail(int $id): void
    {
        $order = $this->orders->find($id);
        $this->template->setParameters([
            'order' => $order,
            'total' => $order->total,
        ]);
    }
}
`;

    expect(netteViewDataEntryFromSource(source).bindings).toEqual([
      {
        viewName: "Order:detail",
        variables: [
          {
            detail: "render/action parameter",
            name: "$id",
            typeHint: "int",
            valueExpression: "$id",
            valueOffset: source.indexOf("$id"),
          },
          {
            detail: "template setParameters()",
            name: "$order",
            typeHint: null,
            valueExpression: "$order",
            valueOffset: source.indexOf("$order,"),
          },
          {
            detail: "template setParameters()",
            name: "$total",
            typeHint: null,
            valueExpression: "$order->total",
            valueOffset: source.indexOf("$order->total"),
          },
        ],
      },
    ]);
  });

  it("extracts Template::add() entries from a local template alias", () => {
    const source = `<?php

use Nette\\Bridges\\ApplicationLatte\\DefaultTemplate;

class ParentalControlsAdminPresenter extends BasePresenter
{
    public function renderShow(string $id): void
    {
        /** @var DefaultTemplate $template */
        $template = $this->template;
        $template->add('range', $this->ranges->find($id));
    }
}
`;

    expect(netteViewDataEntryFromSource(source).bindings).toEqual([
      {
        viewName: "ParentalControlsAdmin:show",
        variables: [
          {
            detail: "render/action parameter",
            name: "$id",
            typeHint: "string",
            valueExpression: "$id",
            valueOffset: source.indexOf("$id"),
          },
          {
            detail: "template add()",
            name: "$range",
            typeHint: null,
            valueExpression: "$this->ranges->find($id)",
            valueOffset: source.indexOf("$this->ranges->find"),
          },
        ],
      },
    ]);
  });

  it("infers display hints from render parameters, @param docs, and presenter properties", () => {
    const source = `<?php

use App\\Model\\Profile;
use App\\Model\\SelectedProfile;
use App\\Model\\Token;
use App\\Model\\TypedCurrentUser;

class ProfilePresenter extends BasePresenter
{
    /** @var Token */
    private $token;

    private TypedCurrentUser $currentUser;

    /**
     * @param SelectedProfile $profile
     */
    public function renderShow(Profile $profile): void
    {
        $this->template->profile = $profile;
        $this->template->token = $this->token;
        $this->template->currentUser = $this->currentUser;
    }
}
`;

    const [binding] = netteViewDataEntryFromSource(source).bindings;

    expect(binding?.variables).toEqual([
      {
        detail: "template data",
        name: "$profile",
        typeHint: "SelectedProfile",
        valueExpression: "$profile",
        valueOffset: source.indexOf("$profile;"),
      },
      {
        detail: "template data",
        name: "$token",
        typeHint: "Token",
        valueExpression: "$this->token",
        valueOffset: source.indexOf("$this->token;"),
      },
      {
        detail: "template data",
        name: "$currentUser",
        typeHint: "TypedCurrentUser",
        valueExpression: "$this->currentUser",
        valueOffset: source.indexOf("$this->currentUser;"),
      },
    ]);
  });

  it("exposes named render/action method parameters as template variables", () => {
    const source = `<?php

use App\\Model\\Product;

class ProductPresenter extends BasePresenter
{
    public function actionShow(int $id): void
    {
    }

    public function renderShow(Product $product, ?string $tab = null): void
    {
    }
}
`;

    expect(netteViewDataEntryFromSource(source).bindings).toEqual([
      {
        viewName: "Product:show",
        variables: [
          {
            detail: "render/action parameter",
            name: "$id",
            typeHint: "int",
            valueExpression: "$id",
            valueOffset: source.indexOf("$id"),
          },
          {
            detail: "render/action parameter",
            name: "$product",
            typeHint: "Product",
            valueExpression: "$product",
            valueOffset: source.indexOf("$product"),
          },
          {
            detail: "render/action parameter",
            name: "$tab",
            typeHint: "?string",
            valueExpression: "$tab",
            valueOffset: source.indexOf("$tab"),
          },
        ],
      },
    ]);
  });

  it("lets explicit template assignments override same-named render parameters", () => {
    const source = `<?php

class ProductPresenter extends BasePresenter
{
    public function renderShow(Product $product): void
    {
        $this->template->product = $this->products->decorate($product);
    }
}
`;

    const [binding] = netteViewDataEntryFromSource(source).bindings;

    expect(binding?.variables).toEqual([
      {
        detail: "template data",
        name: "$product",
        typeHint: null,
        valueExpression: "$this->products->decorate($product)",
        valueOffset: source.indexOf("$this->products"),
      },
    ]);
  });

  it("assigns chained $this->template->a = $this->template->b = value to both", () => {
    const source = `<?php

class GridPresenter extends BasePresenter
{
    public function renderList(): void
    {
        $this->template->primary = $this->template->fallback = $value;
    }
}
`;

    const [binding] = netteViewDataEntryFromSource(source).bindings;

    expect(binding?.viewName).toBe("Grid:list");
    expect(binding?.variables).toEqual([
      {
        detail: "template data",
        name: "$primary",
        typeHint: null,
        valueExpression: "$value",
        valueOffset: source.indexOf("$value;"),
      },
      {
        detail: "template data",
        name: "$fallback",
        typeHint: null,
        valueExpression: "$value",
        valueOffset: source.indexOf("$value;"),
      },
    ]);
  });

  it("maps startup/beforeRender assignments to the presenter wildcard action", () => {
    const source = `<?php

class ArticlePresenter extends BasePresenter
{
    protected function beforeRender(): void
    {
        $this->template->siteName = $this->config->name;
    }

    public function renderDefault(): void
    {
        $this->template->article = $this->article;
    }
}
`;

    const bindings = netteViewDataEntryFromSource(source).bindings;

    expect(bindings.map((binding) => binding.viewName)).toEqual([
      "Article:*",
      "Article:default",
    ]);
    expect(bindings[0]?.variables.map((variable) => variable.name)).toEqual([
      "$siteName",
    ]);
    expect(bindings[1]?.variables.map((variable) => variable.name)).toEqual([
      "$article",
    ]);
  });

  it("supports the $template render-parameter property form", () => {
    const source = `<?php

class GalleryPresenter extends BasePresenter
{
    public function renderList(): void
    {
        $template = $this->template;
        $template->items = $this->items;
    }
}
`;

    expect(netteViewDataEntryFromSource(source).bindings).toEqual([
      {
        viewName: "Gallery:list",
        variables: [
          {
            detail: "template data",
            name: "$items",
            typeHint: null,
            valueExpression: "$this->items",
            valueOffset: source.indexOf("$this->items;"),
          },
        ],
      },
    ]);
  });

  it("maps bare Control::render() template assignments to the default component template", () => {
    const source = `<?php

class CartSummaryControl extends Nette\\Application\\UI\\Control
{
    public function render(): void
    {
        $this->template->cart = $this->cart;
    }
}
`;

    expect(netteViewDataEntryFromSource(source).bindings).toEqual([
      {
        viewName: "CartSummary:default",
        variables: [
          {
            detail: "template data",
            name: "$cart",
            typeHint: null,
            valueExpression: "$this->cart",
            valueOffset: source.indexOf("$this->cart;"),
          },
        ],
      },
    ]);
  });

  it("keeps bare Presenter::render() assignments as wildcard view data", () => {
    const source = `<?php

class ProductPresenter extends BasePresenter
{
    public function render(): void
    {
        $this->template->shared = $this->shared;
    }
}
`;

    expect(netteViewDataEntryFromSource(source).bindings).toEqual([
      {
        viewName: "Product:*",
        variables: [
          {
            detail: "template data",
            name: "$shared",
            typeHint: null,
            valueExpression: "$this->shared",
            valueOffset: source.indexOf("$this->shared;"),
          },
        ],
      },
    ]);
  });

  it("infers a display type hint from a local new-instance assignment", () => {
    const source = `<?php

class CartPresenter extends BasePresenter
{
    public function renderShow(): void
    {
        $cart = new ShoppingCart();
        $this->template->cart = $cart;
    }
}
`;

    const [binding] = netteViewDataEntryFromSource(source).bindings;

    expect(binding?.variables[0]).toEqual({
      detail: "template data",
      name: "$cart",
      typeHint: "ShoppingCart",
      valueExpression: "$cart",
      valueOffset: source.indexOf("$cart;"),
    });
  });

  it("keeps the full arrow-function value expression instead of truncating at its inner =>", () => {
    const source = `<?php

class CallbackPresenter extends BasePresenter
{
    public function renderShow(): void
    {
        $this->template->setParameters([
            'cb' => fn($x) => $x + 1,
        ]);
    }
}
`;

    const [binding] = netteViewDataEntryFromSource(source).bindings;

    expect(binding?.variables).toEqual([
      {
        detail: "template setParameters()",
        name: "$cb",
        typeHint: null,
        valueExpression: "fn($x) => $x + 1",
        valueOffset: source.indexOf("fn($x)"),
      },
    ]);
  });

  it("skips a non-presenter class declared before the real presenter/control", () => {
    const source = `<?php

class ProductTemplate
{
}

class ProductPresenter extends BasePresenter
{
    public function renderShow(): void
    {
        $this->template->product = 1;
    }
}
`;

    const [binding] = netteViewDataEntryFromSource(source).bindings;

    expect(binding?.viewName).toBe("Product:show");
  });

  it("does not let an anonymous `new class extends` expression hijack the presenter name", () => {
    const source = `<?php

function makeHandler() {
    return new class extends BasePresenter {
    };
}

class ProductPresenter extends BasePresenter
{
    public function renderShow(): void
    {
        $this->template->product = 1;
    }
}
`;

    const [binding] = netteViewDataEntryFromSource(source).bindings;

    expect(binding?.viewName).toBe("Product:show");
  });

  it("returns no bindings for a Laravel controller source", () => {
    const source = `<?php

class CommentController
{
    public function show(): mixed
    {
        return view('comments.show', ['comment' => $comment]);
    }
}
`;

    expect(netteViewDataEntryFromSource(source).bindings).toEqual([]);
  });

  it("preserves the raw source on the entry", () => {
    const source = "<?php class X {}";

    expect(netteViewDataEntryFromSource(source).source).toBe(source);
  });

  it("exposes byte-precise search anchors", () => {
    expect(NETTE_VIEW_DATA_SEARCH_QUERIES).toEqual([
      "->template->",
      "template->add(",
      "setParameters(",
      "function render",
      "function action",
    ]);
  });
});

describe("netteTemplateClassPropertiesFromSource", () => {
  it("extracts typed public properties and @property annotations", () => {
    const source = `<?php
namespace App\\UI\\Product;

use Nette\\Bridges\\ApplicationLatte\\Template;

/**
 * @property-read string $title
 * @property Product[] $related
 */
class ProductTemplate extends Template
{
    public Product $product;

    public readonly int $count;
}
`;

    expect(netteTemplateClassPropertiesFromSource(source)).toEqual([
      { name: "$title", type: "string" },
      { name: "$related", type: "Product[]" },
      { name: "$product", type: "Product" },
      { name: "$count", type: "int" },
    ]);
  });

  it("returns nothing for a class that is not a Template", () => {
    const source = `<?php

class ProductService
{
    public Product $product;
}
`;

    expect(netteTemplateClassPropertiesFromSource(source)).toEqual([]);
  });
});
