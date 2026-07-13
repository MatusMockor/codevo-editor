import { describe, expect, it, vi } from "vitest";
import type { PhpMethodCompletion } from "../domain/phpMethodCompletions";
import {
  latteExpressionCompletions,
  type LatteExpressionCompletionContext,
} from "./latteExpressionCompletions";

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
}: {
  active?: boolean | (() => boolean);
  members?: PhpMethodCompletion[];
  receiverType?: string | null;
} = {}): LatteExpressionCompletionContext {
  const isActive = typeof active === "function" ? active : () => active;

  return {
    collectVariableCandidates: vi.fn(async () => [
      {
        detail: "presenter data",
        name: "$invoice",
        typeHint: "Invoice",
      },
      {
        detail: "foreach item",
        name: "$item",
        typeHint: null,
      },
    ]),
    deps: {
      resolvePhpReceiverCompletions: vi.fn(async () => members),
      synthesizeTypedReceiverSource: vi.fn((variableName, typeName) => ({
        position: { column: 1, lineNumber: 3 },
        source: `<?php\n/** @var \\${typeName} $${variableName} */\n$${variableName}->`,
      })),
    },
    isRequestedRootActive: isActive,
    maxCompletions: 10,
    resolveVariableType: vi.fn(async () => receiverType),
  };
}

describe("latteExpressionCompletions", () => {
  it("returns variable completions with type details", async () => {
    const context = makeContext();
    const source = "{$inv}";

    await expect(
      latteExpressionCompletions(context, source, source.length - 1),
    ).resolves.toEqual([
      {
        detail: "presenter data · Invoice",
        insertText: "$invoice",
        kind: "variable",
        label: "$invoice",
        replaceEnd: 5,
        replaceStart: 1,
      },
    ]);
  });

  it("returns member completions for a typed receiver", async () => {
    const context = makeContext({
      members: [
        method({ kind: "property", name: "number", returnType: "string" }),
        method({ name: "total" }),
      ],
    });
    const source = "{$invoice->to}";

    await expect(
      latteExpressionCompletions(context, source, source.length - 1),
    ).resolves.toEqual([
      {
        detail: "App\\Model\\Invoice::total(): Money",
        insertText: "total()",
        kind: "member",
        label: "total",
        replaceEnd: 13,
        replaceStart: 11,
      },
    ]);
  });

  it("returns filter completions from the static Latte filter list", async () => {
    const context = makeContext();
    const source = "{$invoice|lo}";

    const result = await latteExpressionCompletions(
      context,
      source,
      source.length - 1,
    );

    expect(result[0]).toMatchObject({
      detail: "Latte filter",
      kind: "filter",
      replaceEnd: 12,
      replaceStart: 10,
    });
  });

  it("returns member completions inside an n:if attribute value", async () => {
    const context = makeContext({
      members: [method({ name: "total" })],
    });
    const source = '<span n:if="$invoice->to">x</span>';
    const offset = source.indexOf("->to") + "->to".length;

    await expect(
      latteExpressionCompletions(context, source, offset),
    ).resolves.toEqual([
      {
        detail: "App\\Model\\Invoice::total(): Money",
        insertText: "total()",
        kind: "member",
        label: "total",
        replaceEnd: offset,
        replaceStart: offset - 2,
      },
    ]);
  });

  it("returns variable completions inside an n:foreach attribute value", async () => {
    const context = makeContext();
    const source = '<tr n:foreach="$inv as $row">x</tr>';
    const offset = source.indexOf("$inv") + "$inv".length;

    await expect(
      latteExpressionCompletions(context, source, offset),
    ).resolves.toEqual([
      {
        detail: "presenter data · Invoice",
        insertText: "$invoice",
        kind: "variable",
        label: "$invoice",
        replaceEnd: offset,
        replaceStart: source.indexOf("$inv"),
      },
    ]);
  });

  it("returns filter completions inside an n:class attribute expression", async () => {
    const context = makeContext();
    const source = '<div n:class="($invoice|lo)">x</div>';
    const offset = source.indexOf("|lo") + "|lo".length;

    const result = await latteExpressionCompletions(context, source, offset);

    expect(result[0]).toMatchObject({
      detail: "Latte filter",
      kind: "filter",
      label: "localDate",
      replaceEnd: offset,
      replaceStart: offset - 2,
    });
  });

  it("drops stale-root member completions after receiver type resolution", async () => {
    let active = true;
    const context = makeContext({
      active: () => active,
      members: [method({ name: "total" })],
    });
    context.resolveVariableType = vi.fn(async () => {
      active = false;
      return "App\\Model\\Invoice";
    });
    const source = "{$invoice->to}";

    await expect(
      latteExpressionCompletions(context, source, source.length - 1),
    ).resolves.toEqual([]);
    expect(context.deps.resolvePhpReceiverCompletions).not.toHaveBeenCalled();
  });
});
