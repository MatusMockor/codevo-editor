import { describe, expect, it } from "vitest";
import {
  AGENT_PROVIDER_DISABLED_NOTICE,
  AGENT_PROVIDER_INITIALIZING_NOTICE,
  AGENT_PROVIDER_NOT_CONFIGURED_NOTICE,
  AGENT_PROVIDER_REGISTRATION_FAILED_NOTICE,
  AGENT_PROVIDER_UNREGISTERED_NOTICE,
  AGENT_PROVIDER_UPDATING_NOTICE,
  decideAgentProviderAdmission,
  isCurrentAgentProviderAdmissionAuthority,
  type AgentProviderAdmissionAuthority,
  type ReadyAgentProviderAdmissionAuthority,
} from "./agentProviderAdmissionAuthority";

const READY: ReadyAgentProviderAdmissionAuthority = {
  provider: "claudeCode",
  revision: 4,
  providerGeneration: 7,
  disposition: { kind: "ready" },
};

describe("agent provider admission authority", () => {
  it("admits only a ready exact authority", () => {
    const rejected: ReadonlyArray<readonly [AgentProviderAdmissionAuthority, string, string]> = [
      [
        { provider: "claudeCode", revision: 4, disposition: { kind: "disabled" } },
        "disabled",
        AGENT_PROVIDER_DISABLED_NOTICE,
      ],
      [
        { provider: "claudeCode", revision: 4, disposition: { kind: "initializing" } },
        "initializing",
        AGENT_PROVIDER_INITIALIZING_NOTICE,
      ],
      [{ ...READY, disposition: { kind: "updating" } }, "updating", AGENT_PROVIDER_UPDATING_NOTICE],
      [
        {
          provider: "claudeCode",
          revision: 4,
          disposition: { kind: "policyUnavailable", reason: "notConfigured" },
        },
        "notConfigured",
        AGENT_PROVIDER_NOT_CONFIGURED_NOTICE,
      ],
      [
        {
          provider: "claudeCode",
          revision: 4,
          disposition: { kind: "policyUnavailable", reason: "unregistered" },
        },
        "unregistered",
        AGENT_PROVIDER_UNREGISTERED_NOTICE,
      ],
      [
        {
          provider: "claudeCode",
          revision: 4,
          disposition: { kind: "policyUnavailable", reason: "registrationFailed" },
        },
        "registrationFailed",
        AGENT_PROVIDER_REGISTRATION_FAILED_NOTICE,
      ],
    ];

    expect(decideAgentProviderAdmission(READY)).toEqual({ kind: "admitted", authority: READY });
    for (const [authority, reason, message] of rejected) {
      expect(decideAgentProviderAdmission(authority)).toEqual({
        kind: "rejected",
        reason,
        message,
      });
    }
  });

  it("rejects provider, revision, generation, and disposition replacement", () => {
    expect(isCurrentAgentProviderAdmissionAuthority(() => READY, READY)).toBe(true);
    expect(
      isCurrentAgentProviderAdmissionAuthority(() => ({ ...READY, provider: "codex" }), READY),
    ).toBe(false);
    expect(isCurrentAgentProviderAdmissionAuthority(() => ({ ...READY, revision: 5 }), READY)).toBe(
      false,
    );
    expect(
      isCurrentAgentProviderAdmissionAuthority(() => ({ ...READY, providerGeneration: 8 }), READY),
    ).toBe(false);
    expect(
      isCurrentAgentProviderAdmissionAuthority(
        () => ({ ...READY, disposition: { kind: "updating" } }),
        READY,
      ),
    ).toBe(false);
  });

  it("rejects an A to B to A path replacement by revision", () => {
    let current = READY;
    const read = () => current;
    current = { ...READY, revision: 5, providerGeneration: 8 };
    current = { ...READY, revision: 6, providerGeneration: 9 };

    expect(isCurrentAgentProviderAdmissionAuthority(read, READY)).toBe(false);
  });
});
