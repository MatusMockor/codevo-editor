import { describe, expect, it } from "vitest";
import { parsePhpClassStructure } from "../domain/phpClassStructure";
import {
  collectPhpClassScopedCodeActions,
  collectPhpFileScopedCodeActions,
} from "./phpCodeActionLocalCollector";
import type { PhpCodeActionDescriptor } from "./phpCodeActionTypes";

function positionOffset(
  source: string,
  lineNumber: number,
  column: number,
): number {
  const lines = source.split("\n");
  let offset = 0;

  for (let index = 0; index < lineNumber - 1; index += 1) {
    offset += (lines[index]?.length ?? 0) + 1;
  }

  return offset + column - 1;
}

function applyAction(source: string, action: PhpCodeActionDescriptor): string {
  const edits = action.edits.map((edit) => ({
    end: positionOffset(
      source,
      edit.range.endLineNumber,
      edit.range.endColumn,
    ),
    start: positionOffset(
      source,
      edit.range.startLineNumber,
      edit.range.startColumn,
    ),
    text: edit.text,
  }));

  return edits
    .sort((left, right) => right.start - left.start)
    .reduce(
      (result, edit) =>
        `${result.slice(0, edit.start)}${edit.text}${result.slice(edit.end)}`,
      source,
    );
}

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

  it("offers genuine promotion and applies its complete atomic edit set", () => {
    const source = `<?php

class Account
{
    private string $name;
    protected int $balance = 0;
}
`;
    const actions = collectPhpClassScopedCodeActions(
      source,
      { end: 0, start: 0 },
      parsePhpClassStructure(source),
    );
    const promotion = actions.find(
      (action) => action.title === "Generate constructor with promotion",
    );

    expect(promotion).toBeDefined();
    expect(promotion?.edits).toHaveLength(3);
    expect(applyAction(source, promotion!)).toBe(`<?php

class Account
{

    public function __construct(
        private string $name,
        protected int $balance = 0,
    ) {}
}
`);
  });
});
