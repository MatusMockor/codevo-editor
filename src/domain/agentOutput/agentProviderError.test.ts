import { describe, expect, it } from "vitest";
import {
  agentProviderErrorHeadline,
  classifyAgentProviderError,
  sameAgentProviderError,
  MAX_AGENT_PROVIDER_ERROR_MESSAGE_BYTES,
} from "./agentProviderError";

const HOOK_TRUST_NOTICE =
  "`--dangerously-bypass-hook-trust` is enabled. Enabled hooks may run without review for this invocation.";

const CODEX_PAYLOAD = JSON.stringify({
  type: "error",
  status: 400,
  error: {
    type: "invalid_request_error",
    message:
      "The 'gpt-6-astra' model requires a newer version of Codex. Please upgrade to the latest app or CLI and try again.",
  },
});

describe("classifyAgentProviderError", () => {
  it("extracts the message from a JSON error payload", () => {
    const error = classifyAgentProviderError(CODEX_PAYLOAD, "codex");

    expect(error.message).toBe(
      "The 'gpt-6-astra' model requires a newer version of Codex. Please upgrade to the latest app or CLI and try again.",
    );
  });

  it("unwraps a JSON payload nested inside a JSON message", () => {
    const wrapped = JSON.stringify({ type: "error", message: CODEX_PAYLOAD });

    expect(classifyAgentProviderError(wrapped, "codex").detail).toEqual({
      kind: "unsupportedModelForCliVersion",
      provider: "codex",
      model: "gpt-6-astra",
    });
  });

  it("detects a model the installed Codex CLI cannot run", () => {
    expect(classifyAgentProviderError(CODEX_PAYLOAD, "codex").detail).toEqual({
      kind: "unsupportedModelForCliVersion",
      provider: "codex",
      model: "gpt-6-astra",
    });
  });

  it("detects a model the installed Claude CLI cannot run", () => {
    const raw =
      "The `claude-opus-9` model requires a newer version of Claude Code. Please upgrade and try again.";

    expect(classifyAgentProviderError(raw, "claudeCode").detail).toEqual({
      kind: "unsupportedModelForCliVersion",
      provider: "claudeCode",
      model: "claude-opus-9",
    });
  });

  it("marks the Codex hook-trust notice as an advisory", () => {
    const error = classifyAgentProviderError(HOOK_TRUST_NOTICE, "codex");

    expect(error.detail).toEqual({
      kind: "advisory",
      provider: "codex",
      text: HOOK_TRUST_NOTICE,
    });
    expect(agentProviderErrorHeadline(error, "0.153.4")).toBe(HOOK_TRUST_NOTICE);
  });

  it("keeps the Codex advisory an unknown error inside a Claude thread", () => {
    expect(classifyAgentProviderError(HOOK_TRUST_NOTICE, "claudeCode").detail).toEqual({
      kind: "unknown",
    });
  });

  it("keeps a Claude version demand an unknown error inside a Codex thread", () => {
    const raw =
      "The `claude-opus-9` model requires a newer version of Claude Code. Please upgrade and try again.";

    expect(classifyAgentProviderError(raw, "codex").detail).toEqual({ kind: "unknown" });
    expect(classifyAgentProviderError(CODEX_PAYLOAD, "claudeCode").detail).toEqual({
      kind: "unknown",
    });
  });

  it("keeps a notice that only resembles a known advisory as an unknown error", () => {
    const altered = HOOK_TRUST_NOTICE.replace("Enabled hooks", "Every hook");

    expect(classifyAgentProviderError(altered, "codex").detail).toEqual({ kind: "unknown" });
  });

  it("keeps an unknown error as its own full text", () => {
    const error = classifyAgentProviderError("The MCP server refused the token.", "codex");

    expect(error.detail).toEqual({ kind: "unknown" });
    expect(agentProviderErrorHeadline(error, "0.149.1")).toBe("The MCP server refused the token.");
  });

  it("keeps a newer-version message without a quoted model as unknown text", () => {
    const raw = "This request requires a newer version of Codex.";

    expect(classifyAgentProviderError(raw, "codex").detail).toEqual({ kind: "unknown" });
    expect(classifyAgentProviderError(raw, "codex").message).toBe(raw);
  });

  it("keeps unparsable JSON-looking text intact", () => {
    const raw = '{"type":"error","message":';

    expect(classifyAgentProviderError(raw, "codex").message).toBe(raw);
  });

  it("captures a model name without swallowing surrounding words", () => {
    const raw = "The `gpt 6 astra` model requires a newer version of Codex.";

    expect(classifyAgentProviderError(raw, "codex").detail).toEqual({ kind: "unknown" });
  });

  it("stops unwrapping after four nested payloads", () => {
    const first = JSON.stringify({ message: "boom" });
    const second = JSON.stringify({ message: first });
    const third = JSON.stringify({ message: second });
    const fourth = JSON.stringify({ message: third });
    const fifth = JSON.stringify({ message: fourth });

    expect(classifyAgentProviderError(fifth, "codex").message).toBe(first);
  });

  it("keeps JSON that is not an object with a message", () => {
    expect(classifyAgentProviderError('["boom"]', "codex").message).toBe('["boom"]');
    expect(classifyAgentProviderError('{"error":"boom"}', "codex").message).toBe(
      '{"error":"boom"}',
    );
    expect(classifyAgentProviderError('{"message":5}', "codex").message).toBe('{"message":5}');
  });

  it("passes an oversize payload through without parsing it", () => {
    const raw = JSON.stringify({ error: { message: "x".repeat(70 * 1_024) } });
    const message = classifyAgentProviderError(raw, "codex").message;

    expect(message.startsWith('{"error"')).toBe(true);
    expect(new TextEncoder().encode(message).length).toBeLessThanOrEqual(
      MAX_AGENT_PROVIDER_ERROR_MESSAGE_BYTES,
    );
  });

  it("bounds the extracted message", () => {
    const raw = JSON.stringify({ error: { message: "é".repeat(8_000) } });
    const message = classifyAgentProviderError(raw, "codex").message;

    expect(new TextEncoder().encode(message).length).toBeLessThanOrEqual(
      MAX_AGENT_PROVIDER_ERROR_MESSAGE_BYTES,
    );
  });
});

describe("agentProviderErrorHeadline", () => {
  it("names the installed CLI version when it is known", () => {
    expect(
      agentProviderErrorHeadline(classifyAgentProviderError(CODEX_PAYLOAD, "codex"), "0.149.1"),
    ).toBe("Codex 0.149.1 cannot run gpt-6-astra. Update Codex and try again.");
  });

  it("omits the version when the installed version is unknown", () => {
    expect(
      agentProviderErrorHeadline(classifyAgentProviderError(CODEX_PAYLOAD, "codex"), null),
    ).toBe("Codex cannot run gpt-6-astra. Update Codex and try again.");
  });
});

describe("sameAgentProviderError", () => {
  it("matches a run failure repeating the error it already reported", () => {
    const first = classifyAgentProviderError(CODEX_PAYLOAD, "codex");
    const second = classifyAgentProviderError(`  ${CODEX_PAYLOAD}  `, "codex");

    expect(sameAgentProviderError(first, second)).toBe(true);
  });

  it("matches an unknown message that differs only in whitespace and case", () => {
    const first = classifyAgentProviderError("Run   FAILED after 2 tools", "codex");
    const second = classifyAgentProviderError("run failed after 2 tools", "codex");

    expect(sameAgentProviderError(first, second)).toBe(true);
  });

  it("keeps distinct unknown messages apart", () => {
    const first = classifyAgentProviderError("Network unreachable", "codex");
    const second = classifyAgentProviderError("Disk full", "codex");

    expect(sameAgentProviderError(first, second)).toBe(false);
  });
});

describe("launch failure guidance", () => {
  it("recognizes the expired server login without claiming a model update fixes it", () => {
    const error = classifyAgentProviderError(
      "Failed to authenticate: OAuth session expired and could not be refreshed",
      "claudeCode",
    );
    expect(error.detail).toEqual({
      kind: "authenticationRequired",
      provider: "claudeCode",
      cause: "sessionExpired",
    });
    expect(agentProviderErrorHeadline(error, null)).toBe("Claude Code needs you to sign in again.");
  });
  it("does not claim an expired sign-in for a bare authentication failure code", () => {
    const error = classifyAgentProviderError("authentication_failed", "claudeCode");
    expect(error.detail).toEqual({
      kind: "authenticationRequired",
      provider: "claudeCode",
      cause: "rejected",
    });
    expect(agentProviderErrorHeadline(error, null)).toBe(
      "Claude Code could not authenticate this run.",
    );
  });
  it("does not mistake an arbitrary tool authentication message for provider login", () => {
    expect(
      classifyAgentProviderError("MCP failed to authenticate: OAuth session expired", "claudeCode")
        .detail.kind,
    ).toBe("unknown");
  });
  it("makes the protocol failure readable while retaining its technical detail", () => {
    const error = classifyAgentProviderError("provider_protocol_failed", "codex");
    expect(agentProviderErrorHeadline(error, null)).toBe("Codex could not complete this run.");
    expect(error.raw).toBe("provider_protocol_failed");
  });
});

describe("usage limits", () => {
  it("reports the Claude weekly limit with its reset time instead of a sign-in", () => {
    const error = classifyAgentProviderError(
      "You've hit your weekly limit · resets Sep 29 at 8am (Europe/Bratislava)",
      "claudeCode",
    );
    expect(error.detail).toEqual({
      kind: "usageLimited",
      provider: "claudeCode",
      resetsAt: "Sep 29 at 8am (Europe/Bratislava)",
    });
    expect(agentProviderErrorHeadline(error, null)).toBe(
      "Claude Code usage limit reached. Resets Sep 29 at 8am (Europe/Bratislava).",
    );
  });

  it("reads the Claude session limit reset clock", () => {
    const error = classifyAgentProviderError(
      "You've hit your session limit · resets 4:20pm (Europe/Bratislava)",
      "claudeCode",
    );
    expect(error.detail).toEqual({
      kind: "usageLimited",
      provider: "claudeCode",
      resetsAt: "4:20pm (Europe/Bratislava)",
    });
  });

  it("recognizes Claude credit exhaustion without inventing a reset time", () => {
    const error = classifyAgentProviderError(
      "You're out of usage credits. Switch to another model to continue.",
      "claudeCode",
    );
    expect(error.detail).toEqual({ kind: "usageLimited", provider: "claudeCode", resetsAt: null });
    expect(agentProviderErrorHeadline(error, null)).toBe("Claude Code usage limit reached.");
  });

  it("reports the Codex usage limit with its curly apostrophe and reset date", () => {
    const error = classifyAgentProviderError(
      "You’ve hit your usage limit. Visit https://chatgpt.com/codex/settings/usage to purchase more credits or try again at Sep 28th, 2026 11:48 PM.",
      "codex",
    );
    expect(error.detail).toEqual({
      kind: "usageLimited",
      provider: "codex",
      resetsAt: "Sep 28th, 2026 11:48 PM",
    });
    expect(agentProviderErrorHeadline(error, null)).toBe(
      "Codex usage limit reached. Resets Sep 28th, 2026 11:48 PM.",
    );
  });

  it("keeps a relative Codex reset readable", () => {
    const error = classifyAgentProviderError(
      "You've hit your usage limit. Upgrade to Pro (https://chatgpt.com/explore/pro) or try again in 2 days 3 hours 5 minutes.",
      "codex",
    );
    expect(error.detail).toEqual({
      kind: "usageLimited",
      provider: "codex",
      resetsAt: "in 2 days 3 hours 5 minutes",
    });
  });

  it("never doubles the closing punctuation of a reset", () => {
    const claude = classifyAgentProviderError(
      "You've hit your session limit · resets 3pm (Europe/Prague).",
      "claudeCode",
    );
    expect(claude.detail).toEqual({
      kind: "usageLimited",
      provider: "claudeCode",
      resetsAt: "3pm (Europe/Prague)",
    });
    expect(agentProviderErrorHeadline(claude, null)).toBe(
      "Claude Code usage limit reached. Resets 3pm (Europe/Prague).",
    );
    const codex = classifyAgentProviderError(
      "You've hit your usage limit. Try again in 5m!.",
      "codex",
    );
    expect(codex.detail).toEqual({ kind: "usageLimited", provider: "codex", resetsAt: "in 5m" });
    expect(agentProviderErrorHeadline(codex, null)).toBe(
      "Codex usage limit reached. Resets in 5m.",
    );
  });

  it("drops an oversized reset text instead of echoing it", () => {
    const error = classifyAgentProviderError(
      `You've hit your weekly limit · resets ${"x".repeat(200)}`,
      "claudeCode",
    );
    expect(error.detail).toEqual({ kind: "usageLimited", provider: "claudeCode", resetsAt: null });
  });

  it("does not treat a limit quoted mid-sentence or from another provider as a usage limit", () => {
    expect(
      classifyAgentProviderError("The tool said You've hit your weekly limit", "claudeCode").detail,
    ).toEqual({ kind: "unknown" });
    expect(
      classifyAgentProviderError(
        "You've hit your weekly limit · resets Sep 29 at 8am (Europe/Bratislava)",
        "codex",
      ).detail,
    ).toEqual({ kind: "unknown" });
  });

  it("treats the same limit and reset as one repeated error", () => {
    const raw = "You've hit your weekly limit · resets Sep 29 at 8am (Europe/Bratislava)";
    expect(
      sameAgentProviderError(
        classifyAgentProviderError(raw, "claudeCode"),
        classifyAgentProviderError(`  ${raw}\n`, "claudeCode"),
      ),
    ).toBe(true);
  });
});

describe("temporary capacity problems", () => {
  const overCapacity = (
    provider: "claudeCode" | "codex",
    scope: "service" | "model" = "service",
  ) => ({
    kind: "temporarilyOverCapacity",
    provider,
    scope,
  });

  it("recognizes the transient Claude 429 as a capacity problem, not a usage limit", () => {
    const error = classifyAgentProviderError(
      "API Error: Request rejected (429) · this may be a temporary capacity issue. If it persists, check https://status.claude.com",
      "claudeCode",
    );
    expect(error.detail).toEqual(overCapacity("claudeCode"));
    expect(agentProviderErrorHeadline(error, null)).toBe(
      "Claude Code is temporarily over capacity.",
    );
  });

  it("recognizes server-side request limiting that is explicitly not a usage limit", () => {
    expect(
      classifyAgentProviderError(
        "API Error: Server is temporarily limiting requests (not your usage limit) · this may be a temporary capacity issue.",
        "claudeCode",
      ).detail,
    ).toEqual(overCapacity("claudeCode"));
  });

  it("recognizes Claude overloaded responses in their raw and summarized forms", () => {
    const payload = JSON.stringify({
      type: "error",
      error: { type: "overloaded_error", message: "Overloaded" },
    });
    for (const raw of [
      payload,
      `API Error: 529 ${payload}`,
      "API Error: Repeated 529 Overloaded errors",
    ]) {
      expect(classifyAgentProviderError(raw, "claudeCode").detail).toEqual(
        overCapacity("claudeCode"),
      );
    }
  });

  it("marks a single overloaded Claude model as a model-scoped capacity problem", () => {
    expect(
      classifyAgentProviderError(
        "Opus is experiencing high load, please use /model to switch to Sonnet",
        "claudeCode",
      ).detail,
    ).toEqual(overCapacity("claudeCode", "model"));
  });

  it("recognizes the Codex at-capacity error", () => {
    const error = classifyAgentProviderError(
      "Selected model is at capacity. Please try a different model.",
      "codex",
    );
    expect(error.detail).toEqual(overCapacity("codex", "model"));
    expect(agentProviderErrorHeadline(error, null)).toBe("Codex is temporarily over capacity.");
  });

  it("lets a usage-limit message win over capacity wording", () => {
    expect(
      classifyAgentProviderError(
        "You've hit your weekly limit · resets Sep 29 at 8am (Europe/Bratislava) · this may be a temporary capacity issue",
        "claudeCode",
      ).detail.kind,
    ).toBe("usageLimited");
  });

  it("keeps capacity wording from another provider or mid-sentence unknown", () => {
    expect(
      classifyAgentProviderError(
        "Selected model is at capacity. Please try a different model.",
        "claudeCode",
      ).detail,
    ).toEqual({ kind: "unknown" });
    expect(
      classifyAgentProviderError("The build said Overloaded errors happen", "claudeCode").detail,
    ).toEqual({ kind: "unknown" });
  });
});
