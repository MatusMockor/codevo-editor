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
