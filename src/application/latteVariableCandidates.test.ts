import { describe, expect, it, vi } from "vitest";
import type { NetteIncludedTemplateArgument } from "./netteIncludedTemplateArguments";
import { collectLatteVariableCandidates } from "./latteVariableCandidates";
import type { LatteVariableResolutionContext } from "./latteVariableContracts";

function includedArgument(
  name: string,
  type: string | null,
): NetteIncludedTemplateArgument {
  return {
    depth: 0,
    expression: "$source",
    name,
    provenance: [],
    sourceSpan: { end: 1, start: 0 },
    sourceTemplateRelativePath: "caller.latte",
    targetSpan: { end: 1, start: 0 },
    targetTemplateRelativePath: "partial.latte",
    type,
  };
}

function context(
  included: readonly NetteIncludedTemplateArgument[],
  resolveExpressionTypeAt?: LatteVariableResolutionContext["resolveExpressionTypeAt"],
): LatteVariableResolutionContext {
  return {
    currentControlClassName: vi.fn(async () => null),
    currentPresenterClassName: vi.fn(async () => null),
    currentTemplateRelativePath: "partial.latte",
    deps: {
      resolveDeclaredType: (_source, typeHint) => typeHint,
      resolveExpressionType: vi.fn(async () => null),
    },
    isRequestedRootActive: () => true,
    loadIncludedTemplateArguments: vi.fn(async () => included),
    loadTemplateTypePropertySightings: vi.fn(async () => []),
    loadViewDataEntries: vi.fn(async () => []),
    maxTypeResolutionDepth: 5,
    resolveExpressionTypeAt,
    viewNames: vi.fn(async () => []),
  } as LatteVariableResolutionContext;
}

describe("Latte include argument variable candidates", () => {
  it("places include arguments after local and foreach variables", async () => {
    const source = `{var $local = 1}
{foreach $items as $item}
  {$value}
{/foreach}`;
    const candidates = await collectLatteVariableCandidates(
      context([
        includedArgument("value", "App\\Model\\Invoice"),
        includedArgument("item", "App\\Model\\IncludedItem"),
      ]),
      source,
      source.indexOf("{$value}"),
    );

    expect(candidates.map(({ detail, name }) => ({ detail, name }))).toEqual([
      { detail: "template var", name: "$local" },
      { detail: "foreach item", name: "$item" },
      { detail: "include argument", name: "$value" },
      { detail: "Nette template context", name: "$presenter" },
      { detail: "Nette template context", name: "$control" },
    ]);
    expect(candidates.find(({ name }) => name === "$value")?.typeHint).toBe(
      "Invoice",
    );
  });

  it("keeps only a type shared by all typed caller sightings", async () => {
    const candidates = await collectLatteVariableCandidates(
      context([
        includedArgument("same", "App\\Model\\Invoice"),
        includedArgument("same", "\\App\\Model\\Invoice"),
        includedArgument("conflict", "App\\Model\\Invoice"),
        includedArgument("conflict", "App\\Model\\Order"),
      ]),
      "{$same}",
      2,
    );

    expect(candidates.find(({ name }) => name === "$same")?.typeHint).toBe(
      "Invoice",
    );
    expect(candidates.find(({ name }) => name === "$conflict")?.typeHint).toBeNull();
  });

  it("exposes only tableRow formals and lexically visible locals inside define", async () => {
    const source = `{varType App\\Root\\Migration $migration}
{define tableRow, $migration, $iterator}
  {var $migration = $decoratedMigration}
  {var $local = $migration}
  {$}
{/define}
{include tableRow $sourceMigration, $iterator}`;
    const includeOffset = source.indexOf(
      "$sourceMigration",
      source.indexOf("{include tableRow"),
    );
    const loadIncludedTemplateArguments = vi.fn(async () => [
      includedArgument("leaked", "App\\Included\\Leak"),
    ]);
    const resolutionContext = context([], async (_source, expression, offset) =>
      expression === "$sourceMigration" && offset === includeOffset
        ? "App\\Domain\\SubscriptionMigration"
        : null,
    );
    Object.assign(resolutionContext, { loadIncludedTemplateArguments });
    resolutionContext.loadTemplateTypePropertySightings = vi.fn(async () => [
      {
        property: { name: "$rootOnly", type: "App\\Root\\Only" },
        source: "<?php",
      },
    ]);
    resolutionContext.loadViewDataEntries = vi.fn(async () => [
      {
        bindings: [
          {
            variables: [
              {
                detail: "presenter data",
                name: "$presenterOnly",
                typeHint: "App\\Presenter\\Only",
                valueExpression: null,
                valueOffset: null,
              },
            ],
            viewName: "Home:default",
          },
        ],
        source: "<?php",
      },
    ]);

    const candidates = await collectLatteVariableCandidates(
      resolutionContext,
      source,
      source.indexOf("{$}"),
    );

    expect(candidates).toEqual([
      { detail: "template var", name: "$migration", typeHint: null },
      { detail: "define parameter", name: "$iterator", typeHint: null },
      { detail: "template var", name: "$local", typeHint: null },
    ]);
    expect(loadIncludedTemplateArguments).not.toHaveBeenCalled();
    expect(resolutionContext.loadTemplateTypePropertySightings).not.toHaveBeenCalled();
    expect(resolutionContext.loadViewDataEntries).not.toHaveBeenCalled();
  });
});
