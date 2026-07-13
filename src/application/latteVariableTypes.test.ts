import { describe, expect, it, vi } from "vitest";
import type { LatteTemplateTypePropertySighting } from "./netteTemplateTypes";
import {
  collectLatteVariableCandidates,
  extractLatteElementType,
  resolveLatteVariableType,
  type LatteVariableResolutionContext,
  type LatteVariableTypeDependencies,
} from "./latteVariableTypes";
import type { NetteViewDataEntry } from "./netteViewDataEntries";

const PRESENTER_SOURCE = `<?php
namespace App\\UI\\Invoice;

class InvoicePresenter
{
    public function renderDefault(): void
    {
        $this->template->invoice = $this->repository->get(1);
    }
}
`;

function makeTemplateSighting(
  name: string,
  type: string,
): LatteTemplateTypePropertySighting {
  return {
    property: {
      name,
      type,
    },
    source: "<?php namespace App\\Templates; class InvoiceTemplate {}",
  };
}

function makeViewDataEntry(
  variable: {
    name: string;
    typeHint: string | null;
    valueExpression?: string | null;
  },
  viewName = "Invoice:default",
): NetteViewDataEntry {
  return {
    bindings: [
      {
        variables: [
          {
            detail: "presenter data",
            name: variable.name,
            typeHint: variable.typeHint,
            valueExpression: variable.valueExpression ?? null,
            valueOffset:
              variable.valueExpression === undefined ||
              variable.valueExpression === null
                ? null
                : PRESENTER_SOURCE.indexOf(variable.valueExpression),
          },
        ],
        viewName,
      },
    ],
    source: PRESENTER_SOURCE,
  };
}

function makeContext({
  active = true,
  controlClassName = "App\\UI\\Invoice\\InvoiceControl",
  deps = {},
  presenterClassName = "App\\UI\\Invoice\\InvoicePresenter",
  templateSightings = [],
  viewDataEntries = [],
  viewNames = ["Invoice:default"],
}: {
  active?: boolean | (() => boolean);
  controlClassName?: string | null;
  deps?: Partial<LatteVariableTypeDependencies>;
  presenterClassName?: string | null;
  templateSightings?: LatteTemplateTypePropertySighting[];
  viewDataEntries?: NetteViewDataEntry[];
  viewNames?: string[];
} = {}): LatteVariableResolutionContext {
  const isActive = typeof active === "function" ? active : () => active;

  return {
    currentControlClassName: vi.fn(async () => controlClassName),
    currentPresenterClassName: vi.fn(async () => presenterClassName),
    deps: {
      resolveDeclaredType: vi.fn((_source, typeHint) => {
        if (typeHint === "InvoiceTemplateShort") {
          return "App\\Templates\\InvoiceTemplateShort";
        }

        if (typeHint === "Invoice") {
          return "App\\Model\\Invoice";
        }

        return typeHint;
      }),
      resolveExpressionType: vi.fn(async (_source, _position, expression) => {
        if (expression.includes("repository->get")) {
          return "App\\Model\\Invoice";
        }

        if (expression.includes("items")) {
          return "Doctrine\\Common\\Collections\\Collection<int, App\\Model\\Item>";
        }

        if (expression.includes("orders")) {
          return "App\\Model\\Order[]";
        }

        return null;
      }),
      ...deps,
    },
    isRequestedRootActive: isActive,
    loadTemplateTypePropertySightings: vi.fn(async () => templateSightings),
    loadViewDataEntries: vi.fn(async () => viewDataEntries),
    maxTypeResolutionDepth: 5,
    viewNames: vi.fn(async () => viewNames),
  };
}

describe("collectLatteVariableCandidates", () => {
  it("collects variables in priority order and keeps the first sighting", async () => {
    const source = `{templateType App\\Templates\\InvoiceTemplate}
{varType App\\Model\\InlineInvoice $invoice}
{foreach $orders as $orderId => $order}
  {$invoice}
{/foreach}`;
    const context = makeContext({
      templateSightings: [
        makeTemplateSighting("$invoice", "App\\Templates\\InvoiceFromTemplate"),
        makeTemplateSighting("$customer", "App\\Model\\Customer"),
      ],
      viewDataEntries: [
        makeViewDataEntry({
          name: "$invoice",
          typeHint: "Invoice",
          valueExpression: "$this->repository->get(1)",
        }),
        makeViewDataEntry({ name: "$presenterData", typeHint: "string" }),
      ],
    });

    await expect(
      collectLatteVariableCandidates(context, source, source.indexOf("{$invoice}")),
    ).resolves.toEqual([
      {
        detail: "template varType",
        name: "$invoice",
        typeHint: "InlineInvoice",
      },
      {
        detail: "template type",
        name: "$customer",
        typeHint: "Customer",
      },
      { detail: "foreach item", name: "$order", typeHint: null },
      { detail: "foreach key", name: "$orderId", typeHint: null },
      {
        detail: "Nette template context",
        name: "$presenter",
        typeHint: "Presenter",
      },
      {
        detail: "Nette template context",
        name: "$control",
        typeHint: "Control",
      },
      {
        detail: "presenter data",
        name: "$presenterData",
        typeHint: "string",
      },
    ]);
  });

  it("drops async results after the requested root becomes stale", async () => {
    let active = true;
    const context = makeContext({
      active: () => active,
      templateSightings: [makeTemplateSighting("$invoice", "App\\Model\\Invoice")],
    });
    context.loadTemplateTypePropertySightings = vi.fn(async () => {
      active = false;
      return [makeTemplateSighting("$invoice", "App\\Model\\Invoice")];
    });

    await expect(
      collectLatteVariableCandidates(context, "{$invoice}", 1),
    ).resolves.toEqual([]);
  });
});

describe("resolveLatteVariableType", () => {
  it("prefers explicit template declarations over template type and presenter data", async () => {
    const context = makeContext({
      templateSightings: [makeTemplateSighting("$invoice", "App\\Model\\FromTemplate")],
      viewDataEntries: [
        makeViewDataEntry({ name: "$invoice", typeHint: "Invoice" }),
      ],
    });

    await expect(
      resolveLatteVariableType(
        context,
        "{varType App\\Model\\InlineInvoice $invoice}\n{$invoice}",
        50,
        "invoice",
      ),
    ).resolves.toBe("App\\Model\\InlineInvoice");
  });

  it("resolves template type properties against their declaring source", async () => {
    const context = makeContext({
      templateSightings: [
        makeTemplateSighting("$invoice", "InvoiceTemplateShort"),
      ],
    });

    await expect(
      resolveLatteVariableType(context, "{templateType Foo}", 15, "invoice"),
    ).resolves.toBe("App\\Templates\\InvoiceTemplateShort");
  });

  it("resolves local Latte assignments through expression inference", async () => {
    const resolveExpressionType = vi.fn(async () => "App\\Model\\LocalInvoice");
    const context = makeContext({
      deps: { resolveExpressionType },
    });
    const source = `{var $invoice = $this->repository->get(1)}
{$invoice}`;

    await expect(
      resolveLatteVariableType(context, source, source.length, "invoice"),
    ).resolves.toBe("App\\Model\\LocalInvoice");
    expect(resolveExpressionType).toHaveBeenCalledWith(
      "<?php\n$this->repository->get(1);\n",
      { column: 1, lineNumber: 3 },
      "$this->repository->get(1)",
    );
  });

  it("resolves implicit presenter and control variables", async () => {
    const context = makeContext({ controlClassName: null });

    await expect(
      resolveLatteVariableType(context, "{$presenter}", 3, "presenter"),
    ).resolves.toBe("App\\UI\\Invoice\\InvoicePresenter");
    await expect(
      resolveLatteVariableType(context, "{$control}", 3, "control"),
    ).resolves.toBe("Nette\\Application\\UI\\Control");
  });

  it("uses presenter value-expression inference before declared type hints", async () => {
    const context = makeContext({
      viewDataEntries: [
        makeViewDataEntry({
          name: "$invoice",
          typeHint: "Invoice",
          valueExpression: "$this->repository->get(1)",
        }),
      ],
    });

    await expect(
      resolveLatteVariableType(context, "{$invoice}", 3, "invoice"),
    ).resolves.toBe("App\\Model\\Invoice");
  });

  it("returns null for conflicting presenter data sightings", async () => {
    const context = makeContext({
      viewDataEntries: [
        makeViewDataEntry({ name: "$invoice", typeHint: "App\\Model\\Invoice" }),
        makeViewDataEntry({ name: "$invoice", typeHint: "App\\Model\\OtherInvoice" }),
      ],
    });

    await expect(
      resolveLatteVariableType(context, "{$invoice}", 3, "invoice"),
    ).resolves.toBeNull();
  });

  it("extracts foreach element types from arrays and nested relation chains", async () => {
    const context = makeContext({
      deps: {
        resolveExpressionType: vi.fn(async (_source, _position, expression) => {
          if (expression === "$orders") {
            return "App\\Model\\Order[]";
          }

          if (expression === "$order->items") {
            return "Doctrine\\Common\\Collections\\Collection<int, App\\Model\\Item>";
          }

          return null;
        }),
      },
    });
    const source = `{varType App\\Model\\Order[] $orders}
{foreach $orders as $order}
  {$order}
  {foreach $order->items as $item}
    {$item}
  {/foreach}
{/foreach}`;

    await expect(
      resolveLatteVariableType(context, source, source.indexOf("{$order}"), "order"),
    ).resolves.toBe("App\\Model\\Order");
    await expect(
      resolveLatteVariableType(context, source, source.indexOf("{$item}"), "item"),
    ).resolves.toBe("App\\Model\\Item");
  });

  it("falls back to current() for iterable object foreach element types", async () => {
    const resolveExpressionType = vi.fn(async (_source, _position, expression) =>
      expression === "$apiTokens->current()"
        ? "false|App\\Model\\ApiTokensActiveRow|null"
        : null,
    );
    const context = makeContext({
      deps: { resolveExpressionType },
    });
    const source = `{varType App\\Model\\ApiTokensSelection $apiTokens}
{foreach $apiTokens as $apiToken}
  {$apiToken}
{/foreach}`;

    await expect(
      resolveLatteVariableType(
        context,
        source,
        source.indexOf("{$apiToken}"),
        "apiToken",
      ),
    ).resolves.toBe("App\\Model\\ApiTokensActiveRow");
    expect(resolveExpressionType).toHaveBeenCalledWith(
      expect.stringContaining(
        "/** @var \\App\\Model\\ApiTokensSelection $apiTokens */",
      ),
      expect.any(Object),
      "$apiTokens->current()",
    );
  });

  it("falls back to fetch() when current() has no useful element type", async () => {
    const resolveExpressionType = vi.fn(async (_source, _position, expression) => {
      if (expression === "$subscriptionTypeGroups->current()") {
        return "false|null";
      }

      if (expression === "$subscriptionTypeGroups->fetch()") {
        return "null|false|App\\Model\\SubscriptionTypeGroupsActiveRow";
      }

      return null;
    });
    const context = makeContext({
      deps: { resolveExpressionType },
    });
    const source = `{varType App\\Model\\SubscriptionTypeGroupsSelection $subscriptionTypeGroups}
{foreach $subscriptionTypeGroups as $subscriptionTypeGroup}
  {$subscriptionTypeGroup}
{/foreach}`;

    await expect(
      resolveLatteVariableType(
        context,
        source,
        source.indexOf("{$subscriptionTypeGroup}"),
        "subscriptionTypeGroup",
      ),
    ).resolves.toBe("App\\Model\\SubscriptionTypeGroupsActiveRow");
    expect(resolveExpressionType).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(Object),
      "$subscriptionTypeGroups->fetch()",
    );
  });
});

describe("extractLatteElementType", () => {
  it("extracts array and nested generic element types", () => {
    expect(extractLatteElementType("App\\Model\\Invoice[]")).toBe(
      "App\\Model\\Invoice",
    );
    expect(
      extractLatteElementType(
        "Collection<int, Map<string, App\\Model\\Invoice>>",
      ),
    ).toBe("Map<string, App\\Model\\Invoice>");
    expect(extractLatteElementType("App\\Model\\Invoice")).toBeNull();
  });
});
