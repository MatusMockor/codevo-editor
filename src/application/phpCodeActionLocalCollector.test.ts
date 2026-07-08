import { describe, expect, it } from "vitest";
import { parsePhpClassStructure } from "../domain/phpClassStructure";
import {
  collectPhpClassScopedCodeActions,
  collectPhpFileScopedCodeActions,
} from "./phpCodeActionLocalCollector";

describe("phpCodeActionLocalCollector", () => {
  it("collects file-scoped refactors before workspace-specific orchestration", () => {
    const source = `<?php

function answer()
{
    return 42;
}
`;

    const actions = collectPhpFileScopedCodeActions(source, {
      end: source.indexOf("answer") + "answer".length,
      start: source.indexOf("answer"),
    });

    expect(actions.map((action) => action.title)).toContain("Add return type");
  });

  it("collects class-scoped create/generate actions without workspace dependencies", () => {
    const source = `<?php

class Invoice
{
    private string $number;

    public function store(): void
    {
        $this->persist();
    }
}
`;
    const range = {
      end: source.indexOf("persist") + "persist".length,
      start: source.indexOf("persist"),
    };
    const structure = parsePhpClassStructure(source);

    const actions = collectPhpClassScopedCodeActions(source, range, structure);

    expect(actions.map((action) => action.title)).toEqual(
      expect.arrayContaining(["Create method 'persist'", "Generate constructor"]),
    );
  });
});
