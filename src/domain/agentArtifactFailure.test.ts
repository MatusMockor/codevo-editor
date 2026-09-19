import { describe, expect, it } from "vitest";
import contract from "../../contracts/agent-artifact-errors.json";
import {
  agentArtifactBackendMessages,
  agentArtifactFailureMessage,
  agentArtifactFailureRetryable,
  AGENT_ARTIFACT_FAILURE_REASONS,
  classifyAgentArtifactFailure,
  type AgentArtifactFailureReason,
} from "./agentArtifactFailure";

describe("agentArtifactFailure", () => {
  it("declares exactly the shared contract's reasons", () => {
    expect([...AGENT_ARTIFACT_FAILURE_REASONS]).toEqual(contract.reasons);
  });

  it("classifies every shared contract message into its reason", () => {
    expect(agentArtifactBackendMessages).toEqual(contract.backendMessages);
    for (const [reason, messages] of Object.entries(contract.backendMessages)) {
      for (const message of messages) {
        expect(classifyAgentArtifactFailure(new Error(message))).toBe(reason);
        expect(classifyAgentArtifactFailure(message)).toBe(reason);
      }
    }
  });

  it("offers a retry exactly where the shared contract says retrying can help", () => {
    expect(AGENT_ARTIFACT_FAILURE_REASONS.filter(agentArtifactFailureRetryable)).toEqual(
      contract.retryable,
    );
    for (const reason of AGENT_ARTIFACT_FAILURE_REASONS) {
      expect(agentArtifactFailureRetryable(reason)).toBe(
        (contract.retryable as readonly string[]).includes(reason),
      );
    }
  });

  it("gives every reason a distinct bounded message", () => {
    const messages = AGENT_ARTIFACT_FAILURE_REASONS.map(agentArtifactFailureMessage);
    expect(new Set(messages).size).toBe(AGENT_ARTIFACT_FAILURE_REASONS.length);
    for (const message of messages) {
      expect(message.length).toBeGreaterThan(0);
      expect(message.length).toBeLessThanOrEqual(120);
    }
    expect(agentArtifactFailureMessage("conversationAdvanced")).toBe(
      "This turn's files are no longer available.",
    );
  });

  it("separates a turn without a recorded end from a file that changed on disk", () => {
    expect(
      classifyAgentArtifactFailure(
        new Error("This turn has no recorded end time, so its files cannot be verified."),
      ),
    ).toBe("unverifiable");
    expect(agentArtifactFailureRetryable("unverifiable")).toBe(false);
    expect(agentArtifactFailureMessage("unverifiable")).not.toBe(
      agentArtifactFailureMessage("changedOnDisk"),
    );
  });

  it("keeps the local size refusal and drops the dead preview-size entry", () => {
    expect(classifyAgentArtifactFailure(new Error("Artifact exceeds preview limit."))).toBe(
      "tooLarge",
    );
    expect(classifyAgentArtifactFailure(new Error("HTML preview is empty or exceeds 2 MiB."))).toBe(
      "readFailed",
    );
  });

  it("falls back without misreading an unrelated ownership failure", () => {
    expect(classifyAgentArtifactFailure(new Error("Artifact owner changed."))).toBe("readFailed");
    expect(classifyAgentArtifactFailure("boom")).toBe("readFailed");
    const fallback: AgentArtifactFailureReason = "previewFailed";
    expect(classifyAgentArtifactFailure(null, fallback)).toBe("previewFailed");
  });

  it("bounds the message it inspects", () => {
    const padded = `${"x".repeat(4096)}This older turn has no saved artifact snapshot.`;
    expect(classifyAgentArtifactFailure(new Error(padded))).toBe("readFailed");
  });
});
