import { describe, expect, it } from "vitest";
import { phpLaravelScopedStringCompletionContextAt } from "./phpLaravelScopedCompletions";

function positionAfter(source: string, needle: string) {
  const offset = source.indexOf(needle);

  if (offset < 0) {
    throw new Error(`Missing test needle: ${needle}`);
  }

  const before = source.slice(0, offset + needle.length);
  const lines = before.split("\n");
  const lastLine = lines[lines.length - 1] ?? "";

  return {
    column: lastLine.length + 1,
    lineNumber: lines.length,
  };
}

describe("phpLaravelScopedStringCompletionContextAt", () => {
  it("treats Gate::allows ability strings as scoped completion contexts", () => {
    const source = `<?php\n\nGate::allows('upd');\n`;

    expect(
      phpLaravelScopedStringCompletionContextAt(
        source,
        positionAfter(source, "upd"),
      ),
    ).toBe(true);
  });

  it("treats @can / $user->can ability strings as scoped completion contexts", () => {
    const source = `<?php\n\n$user->can('upd');\n`;

    expect(
      phpLaravelScopedStringCompletionContextAt(
        source,
        positionAfter(source, "upd"),
      ),
    ).toBe(true);
  });

  it("treats ->middleware alias strings as scoped completion contexts", () => {
    const source = `<?php\n\nRoute::get('/admin')->middleware('ver');\n`;

    expect(
      phpLaravelScopedStringCompletionContextAt(
        source,
        positionAfter(source, "ver"),
      ),
    ).toBe(true);
  });

  it("treats Route::middleware alias strings as scoped completion contexts", () => {
    const source = `<?php\n\nRoute::middleware('ver')->group(fn () => null);\n`;

    expect(
      phpLaravelScopedStringCompletionContextAt(
        source,
        positionAfter(source, "ver"),
      ),
    ).toBe(true);
  });

  it("does not treat unrelated string arguments as scoped completion contexts", () => {
    const source = `<?php\n\n$collection->contains('upd');\n`;

    expect(
      phpLaravelScopedStringCompletionContextAt(
        source,
        positionAfter(source, "upd"),
      ),
    ).toBe(false);
  });
});
