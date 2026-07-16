import { describe, expect, it, vi } from "vitest";
import type { NetteControlDependencies } from "./netteControlContracts";
import { netteAncestorComponentSources } from "./netteComponentAncestry";

describe("netteAncestorComponentSources bounds", () => {
  it("visits each class once when ancestry cycles", async () => {
    const sources = {
      First: phpClass("First", "Second"),
      Second: phpClass("Second", "First"),
    };
    const deps = makeDependencies(sources);

    const ancestors = await netteAncestorComponentSources(
      deps,
      () => true,
      `<?php class Owner extends First {}`,
    );

    expect(ancestors.map((ancestor) => ancestor.path)).toEqual([
      sources.First.path,
      sources.Second.path,
    ]);
    expect(deps.readPhpClassSource).toHaveBeenCalledTimes(2);
  });

  it("caps broad trait discovery at the source budget", async () => {
    const traitNames = Array.from(
      { length: 40 },
      (_, index) => `WideTrait${index + 1}`,
    );
    const sources = Object.fromEntries(
      traitNames.map((traitName) => [
        traitName,
        {
          path: `/project/${traitName}.php`,
          source: `<?php trait ${traitName} {}`,
        },
      ]),
    );
    const deps = makeDependencies(sources);

    const ancestors = await netteAncestorComponentSources(
      deps,
      () => true,
      `<?php class Owner { use ${traitNames.join(", ")}; }`,
    );

    expect(ancestors).toHaveLength(32);
    expect(deps.readPhpClassSource).toHaveBeenCalledTimes(32);
  });

  it("caps failed class reads independently of loaded sources", async () => {
    const traitNames = Array.from(
      { length: 80 },
      (_, index) => `MissingTrait${index + 1}`,
    );
    const deps = makeDependencies({});

    const ancestors = await netteAncestorComponentSources(
      deps,
      () => true,
      `<?php class Owner { use ${traitNames.join(", ")}; }`,
    );

    expect(ancestors).toEqual([]);
    expect(deps.readPhpClassSource).toHaveBeenCalledTimes(64);
  });
});

function makeDependencies(
  sources: Record<string, { path: string; source: string }>,
): NetteControlDependencies {
  return {
    joinPath: (...parts) => parts.join("/"),
    openPhpMethodTarget: vi.fn(async () => false),
    openTarget: vi.fn(async () => false),
    readFileContent: vi.fn(async () => ""),
    readPhpClassSource: vi.fn(
      async (className: string) => sources[className] ?? null,
    ),
    resolveDeclaredType: (_source, typeHint) => typeHint,
  };
}

function phpClass(
  className: string,
  parentClassName: string,
): { path: string; source: string } {
  return {
    path: `/project/${className}.php`,
    source: `<?php class ${className} extends ${parentClassName} {}`,
  };
}
