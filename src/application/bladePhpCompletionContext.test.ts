import { describe, expect, it } from "vitest";
import {
  bladeMemberCompletionItem,
  bladeOffsetAtEditorPosition,
  bladePhpLikeCompletionAt,
  bladePhpMemberAccessCompletionAt,
  bladeShortTypeName,
  editorPositionAtOffset,
} from "./bladePhpCompletionContext";

describe("blade PHP completion context", () => {
  it("detects variable, helper, and member completion contexts outside strings", () => {
    expect(bladePhpLikeCompletionAt("{{ $in", 6)).toMatchObject({
      kind: "variable",
      prefix: "in",
    });
    expect(bladePhpLikeCompletionAt("{{ rou", 6)).toMatchObject({
      kind: "helper",
      prefix: "rou",
    });
    expect(
      bladePhpMemberAccessCompletionAt("{{ $invoice->tot", 16),
    ).toMatchObject({
      prefix: "tot",
      receiverExpression: "$invoice",
      variableName: "invoice",
    });
  });

  it("does not offer helper or member contexts inside Blade string literals", () => {
    expect(bladePhpLikeCompletionAt("{{ 'rou", 7)).toBeNull();
    expect(bladePhpMemberAccessCompletionAt("{{ '$invoice->", 14)).toBeNull();
  });

  it("formats member completion items by category", () => {
    expect(
      bladeMemberCompletionItem(
        {
          declaringClassName: "App\\Models\\Invoice",
          kind: "property",
          name: "total",
          parameters: "",
          returnType: "int",
        },
        { replaceEnd: 10, replaceStart: 5 },
      ),
    ).toMatchObject({
      detail: "App\\Models\\Invoice::$total: int",
      insertText: "total",
      kind: "member",
      label: "total",
    });
  });

  it("normalizes short type names and converts between offsets and positions", () => {
    expect(bladeShortTypeName("\\App\\Models\\Invoice")).toBe("Invoice");
    expect(bladeShortTypeName("Collection<int, App\\Models\\Invoice>")).toBe(
      "Collection",
    );

    const source = "one\ntwo";
    expect(
      bladeOffsetAtEditorPosition(source, { column: 2, lineNumber: 2 }),
    ).toBe(5);
    expect(editorPositionAtOffset(source, 5)).toEqual({
      column: 2,
      lineNumber: 2,
    });
  });
});
