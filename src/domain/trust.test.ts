import { describe, expect, it } from "vitest";
import contract from "../../contracts/workspace-trust-errors.json";
import { WORKSPACE_TRUST_REVOKED_REFUSAL, isWorkspaceTrustRevokedRefusal } from "./trust";

describe("workspace trust error contract", () => {
  it("mirrors the Rust revoked refusal text", () => {
    expect(WORKSPACE_TRUST_REVOKED_REFUSAL).toBe(contract.revokedRefusal);
  });

  it("recognises the pinned refusal as a string or an Error", () => {
    expect(isWorkspaceTrustRevokedRefusal(contract.revokedRefusal)).toBe(true);
    expect(isWorkspaceTrustRevokedRefusal(new Error(contract.revokedRefusal))).toBe(true);
    expect(isWorkspaceTrustRevokedRefusal(`${contract.revokedRefusal}.`)).toBe(false);
  });
});
