import { describe, expect, it, vi } from "vitest";
import type { PhpMethodCompletion } from "../domain/phpMethodCompletions";
import {
  resolveLatteMemberDefinition,
  resolveNettePresenterVariableDefinition,
  type LatteExpressionDefinitionContext,
} from "./latteExpressionDefinitions";
import type { NetteViewDataEntry } from "./netteViewDataEntries";

const PRESENTER_SOURCE = `<?php
class InvoicePresenter
{
    public function renderDefault(): void
    {
        $this->template->invoice = $invoice;
    }
}
`;

function makeEntry(): NetteViewDataEntry {
  return {
    bindings: [
      {
        variables: [
          {
            detail: "presenter data",
            name: "$invoice",
            typeHint: "App\\Model\\Invoice",
            valueExpression: "$invoice",
            valueOffset: PRESENTER_SOURCE.indexOf("$invoice"),
          },
        ],
        viewName: "Invoice:default",
      },
    ],
    source: PRESENTER_SOURCE,
    sourcePath: "/ws/app/UI/Invoice/InvoicePresenter.php",
  };
}

function method(
  overrides: Partial<PhpMethodCompletion> = {},
): PhpMethodCompletion {
  return {
    declaringClassName: "App\\Model\\Invoice",
    name: "total",
    parameters: "",
    returnType: "Money",
    ...overrides,
  };
}

function makeContext({
  active = true,
  members = [],
  receiverType = "App\\Model\\Invoice",
  viewDataEntries = [makeEntry()],
  viewNames = ["Invoice:default"],
}: {
  active?: boolean | (() => boolean);
  members?: PhpMethodCompletion[];
  receiverType?: string | null;
  viewDataEntries?: NetteViewDataEntry[];
  viewNames?: string[];
} = {}): LatteExpressionDefinitionContext {
  const isActive = typeof active === "function" ? active : () => active;

  return {
    deps: {
      openPhpMethodTarget: vi.fn(async () => true),
      openPhpPropertyTarget: vi.fn(async () => true),
      openTarget: vi.fn(async () => true),
      resolvePhpReceiverCompletions: vi.fn(async () => members),
      synthesizeTypedReceiverSource: vi.fn((variableName, typeName) => ({
        position: { column: 1, lineNumber: 3 },
        source: `<?php\n/** @var \\${typeName} $${variableName} */\n$${variableName}->`,
      })),
    },
    isRequestedRootActive: isActive,
    loadViewDataEntries: vi.fn(async () => viewDataEntries),
    resolveControlVariableDefinition: vi.fn(async () => true),
    resolveVariableType: vi.fn(async () => receiverType),
    viewNames: vi.fn(async () => viewNames),
  };
}

describe("resolveNettePresenterVariableDefinition", () => {
  it("opens the presenter variable assignment that feeds the active template", async () => {
    const context = makeContext();
    const source = "{if $invoice}\n{/if}";

    await expect(
      resolveNettePresenterVariableDefinition(
        context,
        source,
        source.indexOf("$invoice") + 2,
      ),
    ).resolves.toBe(true);
    expect(context.deps.openTarget).toHaveBeenCalledWith(
      "/ws/app/UI/Invoice/InvoicePresenter.php",
      { column: 36, lineNumber: 6 },
      "$invoice",
    );
  });

  it("delegates $control navigation to the control resolver", async () => {
    const context = makeContext();
    const source = "{$control}";

    await expect(
      resolveNettePresenterVariableDefinition(
        context,
        source,
        source.indexOf("$control") + 2,
      ),
    ).resolves.toBe(true);
    expect(context.resolveControlVariableDefinition).toHaveBeenCalledOnce();
  });

  it("drops stale-root presenter data after async load", async () => {
    let active = true;
    const context = makeContext({
      active: () => active,
    });
    context.loadViewDataEntries = vi.fn(async () => {
      active = false;
      return [makeEntry()];
    });
    const source = "{$invoice}";

    await expect(
      resolveNettePresenterVariableDefinition(
        context,
        source,
        source.indexOf("$invoice") + 2,
      ),
    ).resolves.toBe(false);
    expect(context.deps.openTarget).not.toHaveBeenCalled();
  });
});

describe("resolveLatteMemberDefinition", () => {
  it("opens method targets from typed receiver completions", async () => {
    const context = makeContext({
      members: [method({ name: "total" })],
    });
    const source = "{$invoice->total()}";

    await expect(
      resolveLatteMemberDefinition(
        context,
        source,
        source.indexOf("total") + 2,
      ),
    ).resolves.toBe(true);
    expect(context.deps.openPhpMethodTarget).toHaveBeenCalledWith(
      "App\\Model\\Invoice",
      "total",
    );
  });

  it("opens property targets for properties and relation fallback when method target is missing", async () => {
    const propertyContext = makeContext({
      members: [method({ kind: "property", name: "number" })],
    });
    const propertySource = "{$invoice->number}";

    await expect(
      resolveLatteMemberDefinition(
        propertyContext,
        propertySource,
        propertySource.indexOf("number") + 2,
      ),
    ).resolves.toBe(true);
    expect(propertyContext.deps.openPhpPropertyTarget).toHaveBeenCalledWith(
      "App\\Model\\Invoice",
      "number",
    );

    const relationContext = makeContext({
      members: [method({ kind: "relation", name: "items" })],
    });
    relationContext.deps.openPhpMethodTarget = vi.fn(async () => false);
    const relationSource = "{$invoice->items}";

    await expect(
      resolveLatteMemberDefinition(
        relationContext,
        relationSource,
        relationSource.indexOf("items") + 2,
      ),
    ).resolves.toBe(true);
    expect(relationContext.deps.openPhpPropertyTarget).toHaveBeenCalledWith(
      "App\\Model\\Invoice",
      "items",
    );
  });
});
