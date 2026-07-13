import { describe, expect, it, vi } from "vitest";
import type { PhpFrameworkProvider } from "./phpFrameworkProviders";
import { bladeFrameworkHelperCompletionContextAt } from "./bladeFrameworkHelperCompletions";

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

describe("bladeFrameworkHelperCompletionContextAt", () => {
  it("uses provider route scanners inside scoped Blade echoes", () => {
    const provider: PhpFrameworkProvider = {
      id: "custom",
      routes: {
        referenceAt: vi.fn(({ position, source }) => ({
          call: "route",
          name: "reports.ind",
          position,
          prefix: source.includes("reports.ind") ? "reports.ind" : "",
        })),
      },
    };
    const source = `<a href="{{ route('reports.ind') }}">Reports</a>`;

    expect(
      bladeFrameworkHelperCompletionContextAt(
        source,
        positionAfter(source, "reports.ind"),
        [provider],
      ),
    ).toMatchObject({
      kind: "route",
      position: {
        column: expect.any(Number),
        lineNumber: 1,
      },
      prefix: "reports.ind",
      providerId: "custom",
      source: " route('reports.ind') ",
    });
  });

  it("returns null without a provider-owned helper reference", () => {
    const source = `{{ route('reports.ind') }}`;

    expect(
      bladeFrameworkHelperCompletionContextAt(
        source,
        positionAfter(source, "reports.ind"),
        [],
      ),
    ).toBeNull();
  });
});
