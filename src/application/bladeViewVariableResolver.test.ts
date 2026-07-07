import { describe, expect, it, vi } from "vitest";
import type { BladeViewDataEntry } from "../domain/bladeViewVariables";
import { createBladeViewVariableResolver } from "./bladeViewVariableResolver";

const ROOT = "/repo";

function viewEntry(
  source: string,
  viewName: string,
  variables: BladeViewDataEntry["bindings"][number]["variables"],
): BladeViewDataEntry {
  return {
    bindings: [{ variables, viewName }],
    source,
  };
}

function viewVariable(
  name: string,
  valueExpression: string | null,
  typeHint: string | null = null,
) {
  return {
    detail: "view data",
    name,
    typeHint,
    valueExpression,
    valueOffset: valueExpression ? 0 : null,
  };
}

function makeResolver(options: {
  currentRoot?: string | null;
  entries?: BladeViewDataEntry[] | null;
  resolveExpression?: (expression: string) => Promise<string | null>;
  resolveDeclared?: (typeName: string | null) => string | null;
  resolveRelation?: (
    className: string,
    propertyName: string,
    includeCollectionRelations?: boolean,
  ) => Promise<string | null>;
} = {}) {
  const currentWorkspaceRootRef = { current: options.currentRoot ?? ROOT };
  const ensureBladeViewDataEntriesLoaded = vi.fn(
    async () => options.entries ?? [],
  );
  const resolvePhpExpressionType = vi.fn(async (_source, _position, expression) =>
    options.resolveExpression
      ? options.resolveExpression(expression)
      : Promise.resolve(null),
  );
  const resolvePhpDeclaredType = vi.fn((_source, typeName) =>
    options.resolveDeclared ? options.resolveDeclared(typeName) : null,
  );
  const resolvePhpClassPropertyOrRelationType = vi.fn(
    async (className, propertyName, includeCollectionRelations) =>
      options.resolveRelation
        ? options.resolveRelation(
            className,
            propertyName,
            includeCollectionRelations,
          )
        : Promise.resolve(null),
  );

  return {
    currentWorkspaceRootRef,
    ensureBladeViewDataEntriesLoaded,
    resolvePhpClassPropertyOrRelationType,
    resolvePhpDeclaredType,
    resolvePhpExpressionType,
    resolver: createBladeViewVariableResolver({
      currentWorkspaceRootRef,
      ensureBladeViewDataEntriesLoaded,
      resolvePhpClassPropertyOrRelationType,
      resolvePhpDeclaredType,
      resolvePhpExpressionType,
      workspaceRoot: ROOT,
    }),
  };
}

describe("createBladeViewVariableResolver", () => {
  it("prefers expression inference and falls back to declared view-data types", async () => {
    const entries = [
      viewEntry("<?php return view('invoices.show');", "invoices.show", [
        viewVariable("$invoice", "$invoice", "Fallback\\Invoice"),
        viewVariable("$company", null, "App\\Models\\Company"),
      ]),
    ];
    const { resolver, resolvePhpDeclaredType } = makeResolver({
      entries,
      resolveDeclared: (typeName) => typeName,
      resolveExpression: async (expression) =>
        expression === "$invoice" ? "App\\Models\\Invoice" : null,
    });

    await expect(
      resolver.resolveBladeViewVariableTypeForView(
        "invoices.show",
        "$invoice",
      ),
    ).resolves.toBe("App\\Models\\Invoice");
    await expect(
      resolver.resolveBladeViewVariableTypeForView(
        "invoices.show",
        "$company",
      ),
    ).resolves.toBe("App\\Models\\Company");
    expect(resolvePhpDeclaredType).toHaveBeenCalledWith(
      entries[0].source,
      "App\\Models\\Company",
    );
  });

  it("keeps completion display types conservative when controller sightings conflict", async () => {
    const entries = [
      viewEntry("<?php $invoice = first();", "invoices.show", [
        viewVariable("$invoice", "$invoice"),
      ]),
      viewEntry("<?php $invoice = draft();", "invoices.show", [
        viewVariable("$invoice", "$invoice"),
      ]),
    ];
    const { resolver } = makeResolver({
      entries,
      resolveExpression: async (_expression) => "App\\Models\\Invoice",
    });

    const variables = await resolver.collectBladeViewVariablesWithDisplayTypes(
      "invoices.show",
    );

    expect(variables).toEqual([
      expect.objectContaining({
        name: "$invoice",
        typeHint: "Invoice",
      }),
    ]);
  });

  it("drops stale results when the active workspace changes during loading", async () => {
    const currentWorkspaceRootRef = { current: ROOT };
    const entries = [
      viewEntry("<?php return view('invoices.show');", "invoices.show", [
        viewVariable("$invoice", "$invoice"),
      ]),
    ];
    const ensureBladeViewDataEntriesLoaded = vi.fn(async () => {
      currentWorkspaceRootRef.current = "/other";
      return entries;
    });
    const resolver = createBladeViewVariableResolver({
      currentWorkspaceRootRef,
      ensureBladeViewDataEntriesLoaded,
      resolvePhpClassPropertyOrRelationType: vi.fn(async () => null),
      resolvePhpDeclaredType: vi.fn(() => null),
      resolvePhpExpressionType: vi.fn(async () => "App\\Models\\Invoice"),
      workspaceRoot: ROOT,
    });

    await expect(
      resolver.resolveBladeViewVariableTypeForView(
        "invoices.show",
        "$invoice",
      ),
    ).resolves.toBeNull();
    await expect(
      resolver.collectBladeViewVariablesWithDisplayTypes("invoices.show"),
    ).resolves.toEqual([]);
  });

  it("resolves nested foreach variables through view-data collections and relation chains", async () => {
    const entries = [
      viewEntry("<?php return view('invoices.index');", "invoices.index", [
        viewVariable("$invoices", "$invoices"),
      ]),
    ];
    const { resolver, resolvePhpClassPropertyOrRelationType } = makeResolver({
      entries,
      resolveExpression: async (expression) =>
        expression === "$invoices"
          ? "Illuminate\\Database\\Eloquent\\Collection<int, App\\Models\\Invoice>"
          : null,
      resolveRelation: async (className, propertyName, includeCollections) => {
        if (
          className === "App\\Models\\Invoice" &&
          propertyName === "lines" &&
          includeCollections
        ) {
          return "App\\Models\\InvoiceLine";
        }

        return null;
      },
    });
    const source =
      "@foreach ($invoices as $invoice)\n" +
      "@foreach ($invoice->lines as $line)\n" +
      "{{ $line-> }}\n" +
      "@endforeach\n@endforeach\n";
    const offset = source.indexOf("$line->") + "$line->".length;

    await expect(
      resolver.resolveBladeForeachElementTypeForVariable(
        "invoices.index",
        source,
        offset,
        "line",
      ),
    ).resolves.toBe("App\\Models\\InvoiceLine");
    expect(resolvePhpClassPropertyOrRelationType).toHaveBeenCalledWith(
      "App\\Models\\Invoice",
      "lines",
      true,
    );
  });
});
