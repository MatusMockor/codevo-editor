import { describe, expect, it } from "vitest";
import { updateOfferToast, withoutSatisfiedUpdateOffer } from "./agentProviderUpdateOffer";
import type { AgentProviderManagementToast } from "./useAgentProviderManagement";

const OFFER: AgentProviderManagementToast = {
  kind: "updateAvailable",
  provider: "claudeCode",
  version: "2.1.284",
};

describe("provider update offer policy", () => {
  it("offers available and manual updates unless the exact version was dismissed", () => {
    const available = {
      kind: "available",
      installedVersion: "2.1.283",
      availableVersion: "2.1.284",
      installer: { kind: "selfUpdate", command: "claudeUpdate" },
    } as const;
    expect(updateOfferToast("claudeCode", available, null)).toEqual(OFFER);
    expect(updateOfferToast("claudeCode", available, undefined)).toEqual(OFFER);
    expect(updateOfferToast("claudeCode", available, "2.1.284")).toBeNull();
    expect(
      updateOfferToast(
        "claudeCode",
        { kind: "manualUpdateAvailable", installedVersion: "2.1.283", availableVersion: "2.1.284" },
        "2.1.200",
      ),
    ).toEqual({ ...OFFER, manual: true });
    expect(
      updateOfferToast("claudeCode", { kind: "current", installedVersion: "2.1.284" }, null),
    ).toBeNull();
  });

  it("withdraws only this provider's offer once the installed version reaches it", () => {
    const none = () => null;
    expect(withoutSatisfiedUpdateOffer(OFFER, "claudeCode", "2.1.284", none)).toBeNull();
    expect(withoutSatisfiedUpdateOffer(OFFER, "claudeCode", "2.1.285", none)).toBeNull();
    expect(withoutSatisfiedUpdateOffer(OFFER, "claudeCode", "2.1.283", none)).toBe(OFFER);
    expect(withoutSatisfiedUpdateOffer(OFFER, "claudeCode", null, none)).toBe(OFFER);
    expect(withoutSatisfiedUpdateOffer(OFFER, "claudeCode", "not-a-version", none)).toBe(OFFER);
    expect(withoutSatisfiedUpdateOffer(OFFER, "codex", "9.9.9", none)).toBe(OFFER);
    const failed: AgentProviderManagementToast = { kind: "updateFailed", provider: "claudeCode" };
    expect(withoutSatisfiedUpdateOffer(failed, "claudeCode", "9.9.9", none)).toBe(failed);
    expect(withoutSatisfiedUpdateOffer(null, "claudeCode", "9.9.9", none)).toBeNull();
  });

  it("hands a satisfied offer over to another provider's pending offer", () => {
    const codexOffer: AgentProviderManagementToast = {
      kind: "updateAvailable",
      provider: "codex",
      version: "0.159.0",
    };
    const pending = (provider: string) => (provider === "codex" ? codexOffer : null);
    expect(withoutSatisfiedUpdateOffer(OFFER, "claudeCode", "2.1.284", pending)).toBe(codexOffer);
    expect(withoutSatisfiedUpdateOffer(OFFER, "claudeCode", "2.1.283", pending)).toBe(OFFER);
  });
});
