import { describe, expect, it } from "vitest";
import {
  initialPhpChangeSignatureRows,
  newPhpChangeSignatureRow,
  validatePhpChangeSignatureRows,
} from "./phpChangeSignatureForm";

describe("phpChangeSignatureForm", () => {
  it("preserves modifiers and builds renamed typed parameters", () => {
    const rows = initialPhpChangeSignatureRows([
      {
        byReference: false,
        defaultValue: "null",
        modifiers: "private readonly",
        name: "user",
        sourceName: "user",
        type: "?User",
        variadic: false,
      },
    ]);
    rows[0] = { ...rows[0], name: "account" };

    expect(validatePhpChangeSignatureRows(rows)).toEqual({
      kind: "valid",
      parameters: [
        {
          callArgument: undefined,
          declaration: "private readonly ?User $account = null",
          sourceName: "user",
        },
      ],
    });
  });

  it("requires a call-site value for a new required parameter", () => {
    const row = { ...newPhpChangeSignatureRow(1), defaultValue: "" };
    expect(validatePhpChangeSignatureRows([row])).toMatchObject({
      kind: "invalid",
      rowId: row.id,
    });
  });

  it("rejects duplicate names and required parameters after optional ones", () => {
    const first = { ...newPhpChangeSignatureRow(1), name: "value" };
    const duplicate = { ...newPhpChangeSignatureRow(2), name: "value" };
    expect(validatePhpChangeSignatureRows([first, duplicate])).toMatchObject({
      kind: "invalid",
      rowId: duplicate.id,
    });

    expect(
      validatePhpChangeSignatureRows([
        first,
        { ...newPhpChangeSignatureRow(2), defaultValue: "", callArgument: "0" },
      ]),
    ).toMatchObject({ kind: "invalid" });
  });
});
