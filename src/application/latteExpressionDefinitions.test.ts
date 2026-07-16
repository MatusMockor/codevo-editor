import { describe, expect, it, vi } from "vitest";
import type { PhpMethodCompletion } from "../domain/phpMethodCompletions";
import type { NetteIncludedTemplateArgument } from "./netteIncludedTemplateArguments";
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
const TEMPLATE_PATH = "app/UI/Invoice/default.latte";
const TEMPLATE_ROOT = "/ws";

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
  includedArguments = [],
  includedSources = {},
  members = [],
  receiverType = "App\\Model\\Invoice",
  requestedRoot = TEMPLATE_ROOT,
  viewDataEntries = [makeEntry()],
  viewNames = ["Invoice:default"],
}: {
  active?: boolean | (() => boolean);
  includedArguments?: readonly NetteIncludedTemplateArgument[];
  includedSources?: Readonly<Record<string, string>>;
  members?: PhpMethodCompletion[];
  receiverType?: string | null;
  requestedRoot?: string;
  viewDataEntries?: NetteViewDataEntry[];
  viewNames?: string[];
} = {}): LatteExpressionDefinitionContext {
  const isActive = typeof active === "function" ? active : () => active;

  return {
    currentTemplateRelativePath: TEMPLATE_PATH,
    deps: {
      joinPath: (rootPath, relativePath) => `${rootPath}/${relativePath}`,
      openPhpMethodTarget: vi.fn(async () => true),
      openPhpPropertyTarget: vi.fn(async () => true),
      openTarget: vi.fn(async () => true),
      readFileContent: vi.fn(async (path) => {
        const source = includedSources[path];

        if (source === undefined) {
          throw new Error(`Missing test file: ${path}`);
        }

        return source;
      }),
      resolvePhpReceiverCompletions: vi.fn(async () => members),
      synthesizeTypedReceiverSource: vi.fn((variableName, typeName) => ({
        position: { column: 1, lineNumber: 3 },
        source: `<?php\n/** @var \\${typeName} $${variableName} */\n$${variableName}->`,
      })),
    },
    isRequestedRootActive: isActive,
    loadIncludedTemplateArguments: vi.fn(async () => includedArguments),
    loadViewDataEntries: vi.fn(async () => viewDataEntries),
    requestedRoot,
    resolveControlVariableDefinition: vi.fn(async () => true),
    resolveVariableType: vi.fn(async () => receiverType),
    viewNames: vi.fn(async () => viewNames),
  };
}

describe("resolveNettePresenterVariableDefinition", () => {
  it("opens a visible local declaration before include and presenter definitions", async () => {
    const source = "{var $invoice = createInvoice()}\n{$invoice}";
    const context = makeContext({
      includedArguments: [includeArgument("invoice", "caller.latte", 10)],
    });

    await expect(
      resolveNettePresenterVariableDefinition(
        context,
        source,
        source.lastIndexOf("$invoice") + 2,
      ),
    ).resolves.toBe(true);
    expect(context.deps.openTarget).toHaveBeenCalledWith(
      "/ws/app/UI/Invoice/default.latte",
      { column: 1, lineNumber: 1 },
      "$invoice",
    );
    expect(context.loadIncludedTemplateArguments).not.toHaveBeenCalled();
    expect(context.loadViewDataEntries).not.toHaveBeenCalled();
  });

  it("opens an include argument at its exact caller value provenance before presenter data", async () => {
    const caller = "{include 'default.latte', invoice: $order->invoice}";
    const valueStart = caller.indexOf("$order");
    const context = makeContext({
      includedArguments: [
        includeArgument("invoice", "app/UI/Order/caller.latte", valueStart),
      ],
      includedSources: {
        "/ws/app/UI/Order/caller.latte": caller,
      },
    });
    const source = "{$invoice}";

    await expect(
      resolveNettePresenterVariableDefinition(
        context,
        source,
        source.indexOf("$invoice") + 2,
      ),
    ).resolves.toBe(true);
    expect(context.deps.openTarget).toHaveBeenCalledWith(
      "/ws/app/UI/Order/caller.latte",
      { column: valueStart + 1, lineNumber: 1 },
      "$invoice",
    );
    expect(context.loadViewDataEntries).not.toHaveBeenCalled();
  });

  it("chooses the loader's first matching caller deterministically", async () => {
    const firstCaller = "first\n{include 'default.latte', invoice: $first}";
    const secondCaller = "{include 'default.latte', invoice: $second}";
    const firstStart = firstCaller.indexOf("$first");
    const context = makeContext({
      includedArguments: [
        includeArgument("invoice", "a/first.latte", firstStart),
        includeArgument(
          "invoice",
          "z/second.latte",
          secondCaller.indexOf("$second"),
        ),
      ],
      includedSources: {
        "/ws/a/first.latte": firstCaller,
        "/ws/z/second.latte": secondCaller,
      },
    });

    await expect(
      resolveNettePresenterVariableDefinition(context, "{$invoice}", 3),
    ).resolves.toBe(true);
    expect(context.deps.openTarget).toHaveBeenCalledWith(
      "/ws/a/first.latte",
      {
        column: firstStart - firstCaller.lastIndexOf("\n", firstStart),
        lineNumber: 2,
      },
      "$invoice",
    );
    expect(context.deps.readFileContent).toHaveBeenCalledOnce();
  });

  it("opens include provenance inside the requested workspace root", async () => {
    const caller = "{include 'default.latte', invoice: $invoice}";
    const valueStart = caller.lastIndexOf("$invoice");
    const context = makeContext({
      includedArguments: [
        includeArgument("invoice", "caller.latte", valueStart),
      ],
      includedSources: { "/workspace-b/caller.latte": caller },
      requestedRoot: "/workspace-b",
    });

    await expect(
      resolveNettePresenterVariableDefinition(context, "{$invoice}", 3),
    ).resolves.toBe(true);
    expect(context.deps.readFileContent).toHaveBeenCalledWith(
      "/workspace-b/caller.latte",
    );
    expect(context.deps.openTarget).toHaveBeenCalledWith(
      "/workspace-b/caller.latte",
      { column: valueStart + 1, lineNumber: 1 },
      "$invoice",
    );
  });

  it("drops include provenance when the requested root becomes stale", async () => {
    let active = true;
    const caller = "{include 'default.latte', invoice: $invoice}";
    const context = makeContext({
      active: () => active,
      includedArguments: [
        includeArgument(
          "invoice",
          "caller.latte",
          caller.lastIndexOf("$invoice"),
        ),
      ],
      includedSources: { "/ws/caller.latte": caller },
    });
    context.deps.readFileContent = vi.fn(async () => {
      active = false;
      return caller;
    });

    await expect(
      resolveNettePresenterVariableDefinition(context, "{$invoice}", 3),
    ).resolves.toBe(false);
    expect(context.deps.openTarget).not.toHaveBeenCalled();
  });

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

  it("uses a precomputed navigation view instead of re-detecting", async () => {
    const context = makeContext();
    const source = "{if $invoice}\n{/if}";

    await expect(
      resolveNettePresenterVariableDefinition(context, source, 0, {
        memberReference: null,
        variableName: "invoice",
      }),
    ).resolves.toBe(true);
    expect(context.deps.openTarget).toHaveBeenCalledOnce();

    const skippedContext = makeContext();

    await expect(
      resolveNettePresenterVariableDefinition(
        skippedContext,
        source,
        source.indexOf("$invoice") + 2,
        { memberReference: null, variableName: null },
      ),
    ).resolves.toBe(false);
    expect(skippedContext.deps.openTarget).not.toHaveBeenCalled();
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

function includeArgument(
  name: string,
  sourceTemplateRelativePath: string,
  start: number,
): NetteIncludedTemplateArgument {
  const span = { end: start + 6, start };

  return {
    depth: 0,
    expression: "$value",
    name,
    provenance: [],
    sourceSpan: span,
    sourceTemplateRelativePath,
    targetSpan: { end: 1, start: 0 },
    targetTemplateRelativePath: TEMPLATE_PATH,
    type: "App\\Model\\Invoice",
  };
}

describe("resolveLatteMemberDefinition", () => {
  it("uses the shared variable resolver for an include-derived receiver type", async () => {
    const context = makeContext({
      members: [method({ declaringClassName: "Caller\\Invoice" })],
      receiverType: "Caller\\Invoice",
    });
    const source = "{$invoice->total()}";

    await expect(
      resolveLatteMemberDefinition(
        context,
        source,
        source.indexOf("total") + 2,
      ),
    ).resolves.toBe(true);
    expect(context.resolveVariableType).toHaveBeenCalledWith(
      source,
      source.indexOf("total") + 2,
      "invoice",
      0,
    );
    expect(context.loadIncludedTemplateArguments).not.toHaveBeenCalled();
    expect(context.deps.openPhpMethodTarget).toHaveBeenCalledWith(
      "Caller\\Invoice",
      "total",
    );
  });

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

  it("dispatches a method-chain receiver when opening its final definition", async () => {
    const context = makeContext({
      members: [method({ name: "getMethod" })],
    });
    const source = "{$api->getEndpoint()->getMethod()}";

    await resolveLatteMemberDefinition(
      context,
      source,
      source.indexOf("getMethod") + 2,
    );

    expect(context.deps.resolvePhpReceiverCompletions).toHaveBeenCalledWith(
      expect.any(String),
      expect.any(Object),
      "$api->getEndpoint()",
    );
  });

  it("uses a precomputed member view instead of re-detecting", async () => {
    const context = makeContext({
      members: [method({ name: "total" })],
    });
    const source = "{$invoice->total()}";

    await expect(
      resolveLatteMemberDefinition(context, source, 0, {
        memberReference: {
          memberName: "total",
          receiverExpression: "$invoice",
          variableName: "invoice",
        },
        variableName: null,
      }),
    ).resolves.toBe(true);
    expect(context.deps.openPhpMethodTarget).toHaveBeenCalledWith(
      "App\\Model\\Invoice",
      "total",
    );

    const skippedContext = makeContext({
      members: [method({ name: "total" })],
    });

    await expect(
      resolveLatteMemberDefinition(
        skippedContext,
        source,
        source.indexOf("total") + 2,
        { memberReference: null, variableName: null },
      ),
    ).resolves.toBe(false);
    expect(skippedContext.deps.openPhpMethodTarget).not.toHaveBeenCalled();
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
