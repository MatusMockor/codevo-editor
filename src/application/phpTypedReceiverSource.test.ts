import { describe, expect, it } from "vitest";
import { synthesizePhpTypedReceiverSource } from "./phpTypedReceiverSource";

describe("synthesizePhpTypedReceiverSource", () => {
  it("creates a PHP snippet with a normalized var annotation and cursor position", () => {
    const result = synthesizePhpTypedReceiverSource(
      "invoice",
      "\\App\\Models\\Invoice",
    );

    expect(result.source).toBe(
      "<?php\n/** @var \\App\\Models\\Invoice $invoice */\n$invoice->",
    );
    expect(result.position).toEqual({
      column: "$invoice->".length + 1,
      lineNumber: 3,
    });
  });
});
