import { describe, expect, it } from "vitest";
import {
  NETTE_VIEW_DATA_SEARCH_QUERIES,
  netteTemplateClassPropertiesFromSource,
  netteViewDataEntryFromSource,
  netteViewDataSourceFactsFromSource,
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

  it("extracts Control::render() setParameters() and add() variables for the default template", () => {
    const source = `<?php

class CartSummaryControl extends Nette\\Application\\UI\\Control
{
    public function render(): void
    {
        $cart = new ShoppingCart();
        $this->template->setParameters([
            'cart' => $cart,
        ]);
        $this->template->add('itemCount', $cart->count());
    }
}
`;

    expect(netteViewDataEntryFromSource(source).bindings).toEqual([
      {
        viewName: "CartSummary:default",
        variables: [
          {
            detail: "template setParameters()",
            name: "$cart",
            typeHint: "ShoppingCart",
            valueExpression: "$cart",
            valueOffset: source.indexOf("$cart,"),
          },
          {
            detail: "template add()",
            name: "$itemCount",
            typeHint: null,
            valueExpression: "$cart->count()",
            valueOffset: source.indexOf("$cart->count"),
          },
        ],
      },
    ]);
  });

  it("maps named Control::renderPart() parameters and setParameters() to that component template", () => {
    const source = `<?php

use App\\Model\\PageInfo;

class ProductListControl extends Nette\\Application\\UI\\Control
{
    public function renderPagination(PageInfo $pageInfo): void
    {
        $this->template->setParameters([
            'pageInfo' => $pageInfo,
        ]);
    }
}
`;

    expect(netteViewDataEntryFromSource(source).bindings).toEqual([
      {
        viewName: "ProductList:pagination",
        variables: [
          {
            detail: "template setParameters()",
            name: "$pageInfo",
            typeHint: "PageInfo",
            valueExpression: "$pageInfo",
            valueOffset: source.indexOf("$pageInfo,"),
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

  it("infers template data types from injected presenter and control properties", () => {
    const presenterSource = `<?php

class ProductPresenter extends Nette\\Application\\UI\\Presenter
{
    #[Nette\\DI\\Attributes\\Inject]
    public ProductRepository $products;

    public function renderShow(): void
    {
        $this->template->products = $this->products;
    }
}
`;

    const controlSource = `<?php
class CartSummaryControl extends Nette\\Application\\UI\\Control
{
    /**
     * @inject
     * @var CartFacade
     */
    public $cartFacade;

    public function render(): void
    {
        $this->template->cartFacade = $this->cartFacade;
    }
}
`;

    expect(netteViewDataEntryFromSource(presenterSource).bindings).toEqual([
      {
        viewName: "Product:show",
        variables: [
          {
            detail: "template data",
            name: "$products",
            typeHint: "ProductRepository",
            valueExpression: "$this->products",
            valueOffset: presenterSource.indexOf("$this->products;"),
          },
        ],
      },
    ]);

    expect(netteViewDataEntryFromSource(controlSource).bindings).toEqual([
      {
        viewName: "CartSummary:default",
        variables: [
          {
            detail: "template data",
            name: "$cartFacade",
            typeHint: "CartFacade",
            valueExpression: "$this->cartFacade",
            valueOffset: controlSource.indexOf("$this->cartFacade;"),
          },
        ],
      },
    ]);
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

describe("netteViewDataSourceFactsFromSource", () => {
  it("reports the owner and ordered lifecycle methods with their own variables", () => {
    const source = `<?php
class ProductPresenter extends BasePresenter
{
    protected function startup(): void
    {
        parent::startup();
        $this->template->site = $this->site;
    }

    protected function beforeRender(): void
    {
        $this->template->navigation = $this->navigation;
    }

    public function actionShow(int $id): void
    {
        parent::actionShow($id);
    }

    public function renderShow(Product $product): void
    {
        $this->template->product = $product;
    }
}
`;

    expect(netteViewDataSourceFactsFromSource(source)).toEqual({
      owner: { kind: "presenter", name: "Product" },
      methods: [
        {
          methodName: "startup",
          action: "*",
          callsParent: true,
          parentCallOffset: source.indexOf("parent::startup"),
          variables: [
            expect.objectContaining({
              name: "$site",
              valueExpression: "$this->site",
            }),
          ],
        },
        {
          methodName: "beforeRender",
          action: "*",
          callsParent: false,
          parentCallOffset: null,
          variables: [
            expect.objectContaining({
              name: "$navigation",
              valueExpression: "$this->navigation",
            }),
          ],
        },
        {
          methodName: "actionShow",
          action: "show",
          callsParent: true,
          parentCallOffset: source.indexOf("parent::actionShow"),
          variables: [expect.objectContaining({ name: "$id" })],
        },
        {
          methodName: "renderShow",
          action: "show",
          callsParent: false,
          parentCallOffset: null,
          variables: [
            expect.objectContaining({ name: "$product", typeHint: "Product" }),
          ],
        },
      ],
    });
  });

  it("retains empty overrides and ignores unrelated methods", () => {
    const source = `<?php
class EmptyPresenter extends BasePresenter
{
    protected function startup(): void {}
    protected function beforeRender(): void {}
    public function actionDefault(): void {}
    public function renderDefault(): void {}
    public function helper(): void { $this->template->ignored = true; }
}
`;

    expect(netteViewDataSourceFactsFromSource(source).methods).toEqual([
      {
        methodName: "startup",
        action: "*",
        callsParent: false,
        parentCallOffset: null,
        variables: [],
      },
      {
        methodName: "beforeRender",
        action: "*",
        callsParent: false,
        parentCallOffset: null,
        variables: [],
      },
      {
        methodName: "actionDefault",
        action: "default",
        callsParent: false,
        parentCallOffset: null,
        variables: [],
      },
      {
        methodName: "renderDefault",
        action: "default",
        callsParent: false,
        parentCallOffset: null,
        variables: [],
      },
    ]);
  });

  it("only detects executable calls to the same parent method", () => {
    const source = `<?php
class FakeParentPresenter extends BasePresenter
{
    protected function startup(): void
    {
        // parent::startup();
        $fake = 'parent::startup()';
        parent::beforeRender();
    }

    protected function beforeRender(): void
    {
        /* parent::beforeRender(); */
        $fake = "parent::beforeRender()";
        $nowdoc = <<<'PHP'
parent::beforeRender();
PHP;
        $parent::beforeRender();
    }

    public function actionShow(): void
    {
        parent /* executable comment */ :: actionShow();
    }
}
`;

    expect(
      netteViewDataSourceFactsFromSource(source).methods.map((method) => [
        method.methodName,
        method.callsParent,
      ]),
    ).toEqual([
      ["startup", false],
      ["beforeRender", false],
      ["actionShow", true],
    ]);
  });

  it("parses multiline signatures with braces in defaults, strings, and comments", () => {
    const source = `<?php
class SignaturePresenter extends BasePresenter
{
    // function renderFake(): void { parent::renderFake(); }
    public function actionEdit(
        string $label = "}",
        array $options = ['shape' => '{'],
    ): void /* { not the body */
    {
        parent::actionEdit($label, $options);
    }

    public function renderEdit(): void
    {
    }
}
`;

    const facts = netteViewDataSourceFactsFromSource(source);

    expect(facts.methods.map((method) => method.methodName)).toEqual([
      "actionEdit",
      "renderEdit",
    ]);
    expect(facts.methods[0]).toMatchObject({
      action: "edit",
      callsParent: true,
      variables: [
        { name: "$label", typeHint: "string" },
        { name: "$options", typeHint: "array" },
      ],
    });
  });

  it("returns a null owner for non-Nette source", () => {
    expect(
      netteViewDataSourceFactsFromSource("<?php class Service {}"),
    ).toEqual({ owner: null, methods: [] });
  });

  it("reports control ownership", () => {
    expect(
      netteViewDataSourceFactsFromSource(`<?php
class SummaryControl extends Nette\\Application\\UI\\Control
{
    public function renderDetail(): void {}
}
`),
    ).toMatchObject({
      owner: { kind: "control", name: "Summary" },
      methods: [{ methodName: "renderDetail", action: "detail" }],
    });
  });

  it("stops masking at heredoc and nowdoc labels with comma, semicolon, or no punctuation", () => {
    const source = `<?php
class HeredocPresenter extends BasePresenter
{
    private function commaValue(): void
    {
        $values = [<<<TEXT
comma
TEXT,
        ];
    }

    public function actionComma(): void {}

    private function semicolonValue(): void
    {
        $value = <<<'TEXT'
semicolon
TEXT;
    }

    public function actionSemicolon(): void {}

    private function bareValue(): void
    {
        consume(<<<"TEXT"
bare
TEXT
        );
    }

    public function actionBare(): void {}
}
`;

    expect(
      netteViewDataSourceFactsFromSource(source).methods.map(
        (method) => method.methodName,
      ),
    ).toEqual(["actionComma", "actionSemicolon", "actionBare"]);
  });

  it("treats PHP attributes as code and keeps same-line actions scoped", () => {
    const source = `<?php
class AttributePresenter extends BasePresenter
{
    #[RequiresRole('editor')] public function actionShow(): void
    {
        $this->template->item = $this->item;
    }
}
`;

    expect(netteViewDataSourceFactsFromSource(source).methods).toMatchObject([
      {
        methodName: "actionShow",
        action: "show",
        variables: [{ name: "$item" }],
      },
    ]);
    expect(netteViewDataEntryFromSource(source).bindings).toMatchObject([
      { viewName: "Attribute:show", variables: [{ name: "$item" }] },
    ]);
  });

  it("restricts facts to direct methods of the selected owner class", () => {
    const source = `<?php
trait SharedLifecycle
{
    protected function startup(): void
    {
        $this->template->traitValue = true;
    }
}

class ProductPresenter extends BasePresenter
{
    use SharedLifecycle;

    public function actionShow(): void
    {
        $this->template->product = $this->product;
    }

    private function factory(): object
    {
        return new class {
            public function renderAnonymous(): void
            {
                $this->template->anonymousValue = true;
            }
        };
    }

    public function renderShow(): void {}
}

class SummaryControl extends Nette\\Application\\UI\\Control
{
    public function renderControl(): void
    {
        $this->template->controlValue = true;
    }
}

class SecondaryPresenter extends BasePresenter
{
    protected function beforeRender(): void
    {
        $this->template->secondaryValue = true;
    }
}

$outside = new class {
    public function actionOutside(): void {}
};
`;

    const facts = netteViewDataSourceFactsFromSource(source);

    expect(facts.owner).toEqual({ kind: "presenter", name: "Product" });
    expect(facts.methods).toMatchObject([
      {
        methodName: "actionShow",
        action: "show",
        variables: [{ name: "$product" }],
      },
      {
        methodName: "renderShow",
        action: "show",
        variables: [],
      },
    ]);
  });

  it("masks inline HTML when detecting executable parent calls", () => {
    const source = `<?php
class InlineHtmlPresenter extends BasePresenter
{
    protected function startup(): void
    {
?>
        parent::startup();
<?php
    }
}
`;

    expect(netteViewDataSourceFactsFromSource(source).methods).toMatchObject([
      { methodName: "startup", callsParent: false },
    ]);
  });

  it("ignores commented parameters while preserving the real parameter offset", () => {
    const source = `<?php
class ParameterPresenter extends BasePresenter
{
    public function actionShow(
        /* string $id, FakeType $fake */
        int /* WrongType $wrong */ $id,
    ): void {}
}
`;

    expect(netteViewDataSourceFactsFromSource(source).methods[0]).toMatchObject({
      methodName: "actionShow",
      variables: [
        {
          name: "$id",
          typeHint: "int",
          valueOffset: source.lastIndexOf("$id"),
        },
      ],
    });
    expect(netteViewDataEntryFromSource(source).bindings).toMatchObject([
      {
        viewName: "Parameter:show",
        variables: [{ name: "$id", typeHint: "int" }],
      },
    ]);
  });

  it("ignores template data syntax in strings and comments", () => {
    const source = `<?php
class MaskedSightingsPresenter extends BasePresenter
{
    public function renderShow(): void
    {
        $single = '$this->template->singleFake = $bad;';
        $double = "$this->template->add('doubleFake', $bad);";

        // $this->template->setParameters(['lineFake' => $bad]);
        /*
         * $this->template->blockFake = $bad;
         * $this->template->add('blockAddFake', $bad);
         */

        $heredoc = <<<TEXT
$this->template->heredocFake = $bad;
$this->template->add('heredocAddFake', $bad);
$this->template->setParameters(['heredocSetFake' => $bad]);
TEXT;

        $nowdoc = <<<'TEXT'
$this->template->nowdocFake = $bad;
$this->template->add('nowdocAddFake', $bad);
$this->template->setParameters(['nowdocSetFake' => $bad]);
TEXT;

        $this->template->realAssignment = 'kept';
        $this->template->add('realAdd', $realAdd);
        $this->template->setParameters([
            'realSet' => $realSet,
        ]);
    }
}
`;
    const expectedNames = ["$realAssignment", "$realAdd", "$realSet"];

    expect(
      netteViewDataEntryFromSource(source).bindings[0]?.variables.map(
        (variable) => variable.name,
      ),
    ).toEqual(expectedNames);
    expect(
      netteViewDataSourceFactsFromSource(source).methods[0]?.variables.map(
        (variable) => variable.name,
      ),
    ).toEqual(expectedNames);
    expect(netteViewDataEntryFromSource(source).bindings[0]).toMatchObject({
      viewName: "MaskedSightings:show",
      variables: [
        {
          name: "$realAssignment",
          valueExpression: "'kept'",
          valueOffset: source.indexOf("'kept'"),
        },
        {
          name: "$realAdd",
          valueExpression: "$realAdd",
          valueOffset: source.indexOf("$realAdd);"),
        },
        {
          name: "$realSet",
          valueExpression: "$realSet",
          valueOffset: source.indexOf("$realSet,"),
        },
      ],
    });
  });

  it("reports the executable parent-call offset relative to assignments", () => {
    const source = `<?php
class OrderingPresenter extends BasePresenter
{
    protected function startup(): void
    {
        $this->template->beforeParent = 1;
        // parent::startup();
        parent::startup();
        $this->template->afterParent = 2;
    }

    public function renderShow(): void
    {
        parent::renderShow();
        $this->template->afterRenderParent = 3;
    }
}
`;
    const methods = netteViewDataSourceFactsFromSource(source).methods;
    const startup = methods[0];
    const render = methods[1];

    expect(startup).toMatchObject({
      callsParent: true,
      methodName: "startup",
      parentCallOffset: source.lastIndexOf("parent::startup"),
    });
    expect(startup?.variables[0]?.valueOffset).toBeLessThan(
      startup?.parentCallOffset ?? 0,
    );
    expect(startup?.variables[1]?.valueOffset).toBeGreaterThan(
      startup?.parentCallOffset ?? source.length,
    );
    expect(render).toMatchObject({
      callsParent: true,
      methodName: "renderShow",
      parentCallOffset: source.indexOf("parent::renderShow"),
    });
    expect(render?.parentCallOffset).toBeLessThan(
      render?.variables[0]?.valueOffset ?? 0,
    );
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
