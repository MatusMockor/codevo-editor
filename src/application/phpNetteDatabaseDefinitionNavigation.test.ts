import { describe, expect, it, vi } from "vitest";
import { createPhpNetteDatabaseDefinitionNavigation } from "./phpNetteDatabaseDefinitionNavigation";
import type { PhpNetteDatabaseTypeResolver } from "./phpNetteDatabaseTypeResolver";

function makeResolver(
  resolveTableType: PhpNetteDatabaseTypeResolver["resolveTableType"],
): PhpNetteDatabaseTypeResolver {
  return {
    resolveClassTypes: vi.fn(async () => null),
    resolveTableType,
  };
}

describe("phpNetteDatabaseDefinitionNavigation", () => {
  it("resolves and opens the generated declaration", async () => {
    const resolveTableType = vi.fn(async () =>
      "Generated\\Selection\\OrdersSelection"
    );
    const openPhpClassTarget = vi.fn(async () => true);
    const resolvePhpExpressionType = vi.fn(async () =>
      "Generated\\ActiveRow\\UsersActiveRow"
    );
    const navigation = createPhpNetteDatabaseDefinitionNavigation({
      databaseTypeResolver: makeResolver(resolveTableType),
      isActive: () => true,
      openPhpClassTarget,
      resolvePhpExpressionType,
    });
    const source = "$user->related('orders.user_id')";

    await expect(
      navigation.provideDefinition(source, source.indexOf("orders") + 2),
    ).resolves.toBe(true);
    expect(resolvePhpExpressionType).toHaveBeenCalledWith(
      source,
      expect.any(Object),
      "$user",
    );
    expect(resolveTableType).toHaveBeenCalledWith(
      "Generated\\ActiveRow\\UsersActiveRow",
      "selection",
      "orders",
    );
    expect(openPhpClassTarget).toHaveBeenCalledWith(
      "Generated\\Selection\\OrdersSelection",
      "OrdersSelection",
    );
  });

  it("drops a request that becomes stale during type resolution", async () => {
    let active = true;
    const openPhpClassTarget = vi.fn(async () => true);
    const navigation = createPhpNetteDatabaseDefinitionNavigation({
      databaseTypeResolver: makeResolver(vi.fn(async () => null)),
      isActive: () => true,
      openPhpClassTarget,
      resolvePhpExpressionType: vi.fn(async () => {
        active = false;
        return "Generated\\ActiveRow\\UsersActiveRow";
      }),
    });
    const source = "$user->ref('statuses')";

    await expect(
      navigation.provideDefinition(
        source,
        source.indexOf("statuses") + 2,
        { canNavigate: () => active },
      ),
    ).resolves.toBe(false);
    expect(openPhpClassTarget).not.toHaveBeenCalled();
  });

  it("uses the scoped PHPDoc carrier when a native ActiveRow cannot identify the generated family", async () => {
    const resolveTableType = vi.fn(
      async (carrierType: string, kind: "activeRow" | "selection", tableName: string) =>
        carrierType ===
          "Efabrica\\Crm\\ActiveRowTypes\\ActiveRow\\ScenariosElementsActiveRow" &&
        kind === "selection" &&
        tableName === "scenarios_element_elements"
          ? "Efabrica\\Crm\\ActiveRowTypes\\Selection\\ScenariosElementElementsSelection"
          : null,
    );
    const openPhpClassTarget = vi.fn(async () => true);
    const resolvePhpExpressionType = vi.fn(
      async (_source: string, _position: unknown, expression: string) =>
        expression === "$element"
          ? "Nette\\Database\\Table\\ActiveRow"
          : "Efabrica\\Crm\\ActiveRowTypes\\ActiveRow\\ScenariosElementsActiveRow",
    );
    const navigation = createPhpNetteDatabaseDefinitionNavigation({
      databaseTypeResolver: makeResolver(resolveTableType),
      isActive: () => true,
      openPhpClassTarget,
      resolvePhpExpressionType,
    });
    const source = `<?php
use Efabrica\\Crm\\ActiveRowTypes\\ActiveRow\\ScenariosElementsActiveRow;
/** @param \\Efabrica\\Crm\\ActiveRowTypes\\ActiveRow\\ScenariosElementsActiveRow|null|false $element */
private function getElementDescendants(ActiveRow $element): array
{
    return $element->related('scenarios_element_elements.parent_element_id')->fetchAll();
}`;
    const offset = source.indexOf("parent_element_id") + 4;

    await expect(navigation.provideDefinition(source, offset)).resolves.toBe(true);
    expect(resolvePhpExpressionType).toHaveBeenCalledWith(
      source,
      expect.any(Object),
      "new \\Efabrica\\Crm\\ActiveRowTypes\\ActiveRow\\ScenariosElementsActiveRow()",
    );
    expect(resolveTableType).toHaveBeenNthCalledWith(
      1,
      "Nette\\Database\\Table\\ActiveRow",
      "selection",
      "scenarios_element_elements",
    );
    expect(resolveTableType).toHaveBeenNthCalledWith(
      2,
      "Efabrica\\Crm\\ActiveRowTypes\\ActiveRow\\ScenariosElementsActiveRow",
      "selection",
      "scenarios_element_elements",
    );
    expect(openPhpClassTarget).toHaveBeenCalledWith(
      "Efabrica\\Crm\\ActiveRowTypes\\Selection\\ScenariosElementElementsSelection",
      "ScenariosElementElementsSelection",
    );
  });

  it("drops the PHPDoc carrier fallback when its project becomes inactive", async () => {
    let active = true;
    const resolveTableType = vi.fn(async () => null);
    const openPhpClassTarget = vi.fn(async () => true);
    const navigation = createPhpNetteDatabaseDefinitionNavigation({
      databaseTypeResolver: makeResolver(resolveTableType),
      isActive: () => active,
      openPhpClassTarget,
      resolvePhpExpressionType: vi.fn(
        async (_source: string, _position: unknown, expression: string) => {
          if (expression.startsWith("new ")) {
            active = false;
            return "Efabrica\\Crm\\ActiveRowTypes\\ActiveRow\\ScenariosElementsActiveRow";
          }

          return "Nette\\Database\\Table\\ActiveRow";
        },
      ),
    });
    const source = `<?php
/** @param ScenariosElementsActiveRow $element */
private function descendants(ActiveRow $element): array
{
    return $element->related('scenarios_element_elements.parent_element_id')->fetchAll();
}`;

    await expect(
      navigation.provideDefinition(
        source,
        source.indexOf("parent_element_id") + 3,
      ),
    ).resolves.toBe(false);
    expect(resolveTableType).toHaveBeenCalledTimes(1);
    expect(openPhpClassTarget).not.toHaveBeenCalled();
  });
});
