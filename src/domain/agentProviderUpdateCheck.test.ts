import { describe, expect, it } from "vitest";
import { parseAgentProviderUpdateCheckResult } from "./agentProviderHealth";

describe("provider update check wire boundary", () => {
  const current = {
    update: { kind: "current", installedVersion: "1.2.3" },
    checkedAtEpochMs: 123,
  };

  it("accepts update metadata without representing a fresh auth or executable observation", () => {
    expect(parseAgentProviderUpdateCheckResult("codex", current)).toEqual(current);
  });

  it.each([
    { ...current, auth: { kind: "signedIn", label: null } },
    { ...current, checkedAtEpochMs: -1 },
    { ...current, checkedAtEpochMs: Number.MAX_SAFE_INTEGER + 1 },
    { update: current.update },
    { ...current, update: { kind: "checking" } },
    { ...current, update: { kind: "current", installedVersion: "invalid" } },
    { ...current, update: { ...current.update, extra: true } },
    {
      ...current,
      update: {
        kind: "available",
        installedVersion: "1.2.3",
        availableVersion: "1.2.4",
        installer: { kind: "selfUpdate", command: "claudeUpdate" },
      },
    },
  ])("rejects invalid or foreign metadata: %j", (value) => {
    expect(() => parseAgentProviderUpdateCheckResult("codex", value)).toThrow(TypeError);
  });
});
