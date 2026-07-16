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
});
