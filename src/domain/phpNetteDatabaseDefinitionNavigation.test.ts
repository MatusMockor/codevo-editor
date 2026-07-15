import { describe, expect, it } from "vitest";
import { phpNetteDatabaseDefinitionContextAt } from "./phpNetteDatabaseDefinitionNavigation";

function contextAt(source: string, needle: string) {
  return phpNetteDatabaseDefinitionContextAt(
    source,
    source.indexOf(needle) + Math.floor(needle.length / 2),
  );
}

describe("phpNetteDatabaseDefinitionNavigation", () => {
  it("detects static ref and dotted related first arguments", () => {
    expect(contextAt("$row->ref('user_statuses')", "user_statuses")).toMatchObject({
      key: "user_statuses",
      kind: "activeRow",
      receiverExpression: "$row",
      tableName: "user_statuses",
    });
    expect(
      contextAt(
        "$row->ref('users')->related('orders.user_id')",
        "orders.user_id",
      ),
    ).toMatchObject({
      key: "orders.user_id",
      kind: "selection",
      receiverExpression: "$row->ref('users')",
      tableName: "orders",
    });
    expect(contextAt("$row->REF('users')", "users")).toMatchObject({
      kind: "activeRow",
      tableName: "users",
    });
    expect(
      contextAt("$row->ReLaTeD('orders.user_id')", "orders"),
    ).toMatchObject({
      kind: "selection",
      tableName: "orders",
    });
  });

  it("rejects dynamic, nested, non-first, and unsafe receiver calls", () => {
    const rejected = [
      "$row->ref($table)",
      "$row->ref(resolveTable('users'))",
      "$row->ref('users' . $suffix)",
      "$row->ref(name: 'users')",
      "$row->ref($fallback, 'users')",
      "$rows[$index]->related('orders')",
      "$factory->make(build())->related('orders')",
      "// $row->ref('users')",
    ];

    for (const source of rejected) {
      const offset = source.indexOf("users") >= 0
        ? source.indexOf("users") + 1
        : source.indexOf("orders") + 1;
      expect(phpNetteDatabaseDefinitionContextAt(source, offset)).toBeNull();
    }
  });

  it("does not allow dotted ref keys", () => {
    expect(contextAt("$row->ref('users.id')", "users.id")).toBeNull();
    expect(
      contextAt(
        "$row->related('users.account.owner_id')",
        "users.account.owner_id",
      ),
    ).toBeNull();
  });

  it("keeps Monaco cursor and full-selection endpoints inside the dotted key", () => {
    const source = `<?php
use Efabrica\\Crm\\ActiveRowTypes\\ActiveRow\\ScenariosElementsActiveRow;

/**
 * @param ScenariosElementsActiveRow $element
 */
private function getElementDescendants(ActiveRow $element): array
{
    return $element->related('scenarios_element_elements.parent_element_id')->where('kind', 'descendant')->fetchAll();
}`;
    const key = "scenarios_element_elements.parent_element_id";
    const keyStart = source.indexOf(key);
    const cursorInsideSuffix = source.indexOf("parent_element_id") + 6;
    const forwardSelectionActiveEnd = keyStart + key.length;

    for (const offset of [
      cursorInsideSuffix,
      forwardSelectionActiveEnd,
      keyStart,
    ]) {
      expect(phpNetteDatabaseDefinitionContextAt(source, offset)).toMatchObject({
        key,
        kind: "selection",
        receiverExpression: "$element",
        receiverPhpDocType: "ScenariosElementsActiveRow",
        tableName: "scenarios_element_elements",
      });
    }

    expect(
      phpNetteDatabaseDefinitionContextAt(source, cursorInsideSuffix)?.position,
    ).toEqual({ column: 64, lineNumber: 9 });
  });

  it("binds a PHPDoc parameter only to its containing function body", () => {
    const source = `<?php
/** @param FirstActiveRow $element */
private function first(ActiveRow $element): void
{
    $element->related('first_children.parent_id');
}

private function second(ActiveRow $element): void
{
    $element->related('second_children.parent_id');
}`;

    expect(contextAt(source, "first_children.parent_id")).toMatchObject({
      receiverPhpDocType: "FirstActiveRow",
    });
    expect(contextAt(source, "second_children.parent_id")).toMatchObject({
      receiverPhpDocType: null,
    });
  });

  it("keeps one absolute object type after sentinels and abstains from ambiguous unions", () => {
    const sourceForType = (type: string) => `<?php
/** @param ${type} $element */
private function descendants(ActiveRow $element): void
{
    $element->related('scenario_children.parent_id');
}`;

    expect(
      contextAt(
        sourceForType("\\Efabrica\\Generated\\ScenariosElementsActiveRow|null|false"),
        "scenario_children.parent_id",
      ),
    ).toMatchObject({
      receiverPhpDocType:
        "\\Efabrica\\Generated\\ScenariosElementsActiveRow",
    });
    expect(
      contextAt(
        sourceForType("FirstActiveRow|SecondActiveRow|null"),
        "scenario_children.parent_id",
      ),
    ).toMatchObject({ receiverPhpDocType: null });
  });
});
