import { describe, expect, it, vi } from "vitest";
import { createPhpNetteMethodReturnTypeStrategyAdapter } from "./phpNetteMethodReturnTypeStrategyAdapter";

const TYPES = {
  activeRowType: "Generated\\ActiveRowTypes\\ActiveRow\\UsersActiveRow",
  selectionType: "Generated\\ActiveRowTypes\\Selection\\UsersSelection",
};

function adapter() {
  return createPhpNetteMethodReturnTypeStrategyAdapter({
    resolveClassTypes: vi.fn(async (className) =>
      /(?:Repository|ActiveRow|Selection)$/.test(className) ? TYPES : null,
    ),
    resolveTableType: vi.fn(async (_carrier, kind, tableName) =>
      tableName === "user_statuses"
        ? `Generated\\ActiveRowTypes\\${kind === "activeRow" ? "ActiveRow\\UserStatusesActiveRow" : "Selection\\UserStatusesSelection"}`
        : null,
    ),
  });
}

describe("phpNetteMethodReturnTypeStrategyAdapter", () => {
  it("maps repository terminals to concrete generated types", async () => {
    const strategy = adapter();

    await expect(
      strategy.knownClassMethodReturnType({
        className: "App\\UsersRepository",
        methodName: "find",
      }),
    ).resolves.toBe(`${TYPES.activeRowType}|null`);
    await expect(
      strategy.knownClassMethodReturnType({
        className: "App\\UsersRepository",
        methodName: "getTable",
      }),
    ).resolves.toBe(TYPES.selectionType);
  });

  it("preserves selection chains and maps row terminals", async () => {
    const strategy = adapter();

    await expect(
      strategy.knownClassMethodReturnType({
        className: TYPES.selectionType,
        methodName: "where",
      }),
    ).resolves.toBe(TYPES.selectionType);
    await expect(
      strategy.knownClassMethodReturnType({
        className: TYPES.selectionType,
        methodName: "fetch",
      }),
    ).resolves.toBe(`${TYPES.activeRowType}|null`);
    await expect(
      strategy.knownClassMethodReturnType({
        className: TYPES.selectionType,
        methodName: "fetchAll",
      }),
    ).resolves.toBe(`${TYPES.activeRowType}[]`);
  });

  it("uses literal ref and related targets without guessing dynamic arguments", async () => {
    const strategy = adapter();

    await expect(
      strategy.knownClassMethodReturnType({
        callExpression: "$user->ref('user_statuses')",
        className: TYPES.activeRowType,
        methodName: "ref",
      }),
    ).resolves.toBe("Generated\\ActiveRowTypes\\ActiveRow\\UserStatusesActiveRow");
    await expect(
      strategy.knownClassMethodReturnType({
        callExpression: "$user->related($table)",
        className: TYPES.activeRowType,
        methodName: "related",
      }),
    ).resolves.toBeNull();
    await expect(
      strategy.knownClassMethodReturnType({
        callExpression: "$user->ref('users')->related($table)",
        className: TYPES.activeRowType,
        methodName: "related",
      }),
    ).resolves.toBeNull();
    await expect(
      strategy.knownClassMethodReturnType({
        callExpression: "$user->related('user_statuses.user_id')",
        className: TYPES.activeRowType,
        methodName: "related",
      }),
    ).resolves.toBe(
      "Generated\\ActiveRowTypes\\Selection\\UserStatusesSelection",
    );
    await expect(
      strategy.knownClassMethodReturnType({
        callExpression:
          "$user->related($repository->ref('user_statuses'))",
        className: TYPES.activeRowType,
        methodName: "related",
      }),
    ).resolves.toBeNull();
  });

  it("specializes generic inherited docs without replacing concrete custom docs", async () => {
    const strategy = adapter();

    await expect(
      strategy.declaredReturnTypeOverride({
        lateStaticClassName: TYPES.selectionType,
        methodName: "fetchAll",
        methodReturnExpressions: [],
        returnType: "array",
      }),
    ).resolves.toBe(`${TYPES.activeRowType}[]`);
    await expect(
      strategy.declaredReturnTypeOverride({
        lateStaticClassName: TYPES.selectionType,
        methodName: "fetchAll",
        methodReturnExpressions: [],
        returnType: "Crm\\Custom\\UsersRow[]",
      }),
    ).resolves.toBeNull();
    await expect(
      strategy.declaredReturnTypeOverride({
        lateStaticClassName: "App\\UsersRepository",
        methodName: "find",
        methodReturnExpressions: [],
        returnType: "Crm\\Custom\\UsersRow|null",
      }),
    ).resolves.toBeNull();
  });

  it("resolves ebox-style nullable generated carriers", async () => {
    const eboxTypes = {
      activeRowType:
        "Efabrica\\Crm\\ActiveRowTypes\\ActiveRow\\SubscriptionsActiveRow",
      selectionType:
        "Efabrica\\Crm\\ActiveRowTypes\\Selection\\SubscriptionsSelection",
    };
    const strategy = createPhpNetteMethodReturnTypeStrategyAdapter({
      resolveClassTypes: vi.fn(async () => eboxTypes),
      resolveTableType: vi.fn(async () => null),
    });

    await expect(
      strategy.knownClassMethodReturnType({
        className: `${eboxTypes.selectionType}|false|null`,
        methodName: "FETCHALL",
      }),
    ).resolves.toBe(`${eboxTypes.activeRowType}[]`);
  });

  it("does not enrich unrelated classes", async () => {
    const strategy = adapter();

    await expect(
      strategy.knownClassMethodReturnType({
        className: "App\\BillingService",
        methodName: "find",
      }),
    ).resolves.toBeNull();
  });
});
