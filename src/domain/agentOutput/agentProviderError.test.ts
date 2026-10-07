import { describe, expect, it } from "vitest";
import {
  agentProviderErrorHeadline,
  classifyAgentProviderError,
  isGenericProviderFailure,
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

describe("conversation images too large", () => {
  const removedNotice =
    "API Error: an image in the conversation could not be processed and was removed. Re-read the file with a different approach if you still need it.";
  const dimensionMessage =
    "messages.154.content.1.image.source.base64.data: At least one of the image dimensions exceed max allowed size for many-image requests: 2000 pixels";
  const payload = JSON.stringify({
    type: "error",
    error: { type: "invalid_request_error", message: dimensionMessage },
    request_id: "req_011CabcDEF",
  });
  const tooLarge = { kind: "conversationImagesTooLarge", provider: "claudeCode" };

  it("recognizes the Claude notice that an image was removed from the conversation", () => {
    const error = classifyAgentProviderError(removedNotice, "claudeCode");

    expect(error.detail).toEqual(tooLarge);
    expect(error.signature).toBe("conversationImagesTooLarge:claudeCode");
    expect(agentProviderErrorHeadline(error, null)).toBe(
      "This conversation contains images larger than the API allows.",
    );
  });

  it("recognizes the many-image dimension limit as plain text", () => {
    expect(classifyAgentProviderError(dimensionMessage, "claudeCode").detail).toEqual(tooLarge);
  });

  it("recognizes the many-image dimension limit inside a JSON payload", () => {
    const error = classifyAgentProviderError(payload, "claudeCode");

    expect(error.detail).toEqual(tooLarge);
    expect(error.message).toBe(dimensionMessage);
  });

  it("unwraps a JSON payload behind an API Error status prefix", () => {
    for (const raw of [`API Error: 400 ${payload}`, `400 ${payload}`, `API Error: ${payload}`]) {
      const error = classifyAgentProviderError(raw, "claudeCode");

      expect(error.detail).toEqual(tooLarge);
      expect(error.message).toBe(dimensionMessage);
    }
  });

  it("treats every variant as one repeated error", () => {
    const notice = classifyAgentProviderError(removedNotice, "claudeCode");
    const wrapped = classifyAgentProviderError(`API Error: 400 ${payload}`, "claudeCode");

    expect(sameAgentProviderError(notice, wrapped)).toBe(true);
  });

  it("keeps an unrelated image error unknown", () => {
    for (const raw of [
      "API Error: 400 messages.3.content.0.image.source.base64: image exceeds 5 MB maximum",
      "Could not process image",
      "The assistant said an image in the conversation could not be processed and was removed.",
      "The docs say image dimensions exceed max allowed size for many-image requests above 20 images.",
    ]) {
      expect(classifyAgentProviderError(raw, "claudeCode").detail).toEqual({ kind: "unknown" });
    }
  });

  it("does not attribute the Claude image limits to a Codex thread", () => {
    expect(classifyAgentProviderError(removedNotice, "codex").detail).toEqual({
      kind: "unknown",
    });
    expect(classifyAgentProviderError(`API Error: 400 ${payload}`, "codex").detail).toEqual({
      kind: "unknown",
    });
  });

  it("does not strip a status prefix that is not followed by a JSON payload", () => {
    const raw = "API Error: 400 Bad Request {not json";

    expect(classifyAgentProviderError(raw, "claudeCode").message).toBe(raw);
  });
});

describe("runner terminal codes", () => {
  const RUNNER_FAILURES = [
    {
      code: "process_cleanup_failed",
      reason: "processCleanupFailed",
      headline: "The server could not keep track of this run's processes.",
    },
    {
      code: "execution_timeout",
      reason: "timedOut",
      headline: "The server stopped this run because it reached the runner's time limit.",
    },
    {
      code: "provider_unavailable",
      reason: "providerUnavailable",
      headline: "The server could not start Claude Code.",
    },
    {
      code: "provider_result_missing",
      reason: "providerResultMissing",
      headline: "Claude Code ended without reporting a result.",
    },
    {
      code: "output_persistence_failed",
      reason: "outputNotSaved",
      headline: "The server stopped this run because it could not save the run's output.",
    },
    {
      code: "output_limit_exceeded",
      reason: "outputLimitExceeded",
      headline:
        "The server stopped this run because it produced more output than the runner allows.",
    },
    {
      code: "instruction_sync_failed",
      reason: "instructionSyncFailed",
      headline: "The server could not apply your instruction files for this run.",
    },
    {
      code: "execution_failed",
      reason: "executionFailed",
      headline: "The server ran into a problem and could not complete this run.",
    },
  ] as const;

  it.each(RUNNER_FAILURES)("explains $code in a plain sentence", ({ code, reason, headline }) => {
    const error = classifyAgentProviderError(code, "claudeCode");

    expect(error.detail).toEqual({ kind: "runnerFailure", provider: "claudeCode", reason });
    expect(agentProviderErrorHeadline(error, null)).toBe(headline);
    expect(agentProviderErrorHeadline(error, null)).not.toContain(code);
    expect(agentProviderErrorHeadline(error, null)).not.toMatch(/[–—]/u);
    expect(error.raw).toBe(code);
    expect(error.signature).toBe(`runnerFailure:claudeCode:${reason}`);
  });

  it("explains provider_reported_failure and keeps the signature it had as unclassified text", () => {
    const error = classifyAgentProviderError("provider_reported_failure", "claudeCode");

    expect(error.detail).toEqual({
      kind: "runnerFailure",
      provider: "claudeCode",
      reason: "providerReportedFailure",
    });
    expect(agentProviderErrorHeadline(error, null)).toBe(
      "Claude Code did not complete this run successfully.",
    );
    expect(agentProviderErrorHeadline(error, null)).not.toMatch(/[–—]/u);
    expect(error.raw).toBe("provider_reported_failure");
    expect(error.signature).toBe("unknown:provider_reported_failure");
  });

  it("names the provider of the thread that failed", () => {
    expect(
      agentProviderErrorHeadline(classifyAgentProviderError("provider_unavailable", "codex"), null),
    ).toBe("The server could not start Codex.");
    expect(
      agentProviderErrorHeadline(
        classifyAgentProviderError("provider_result_missing", "codex"),
        null,
      ),
    ).toBe("Codex ended without reporting a result.");
    expect(
      agentProviderErrorHeadline(
        classifyAgentProviderError("provider_reported_failure", "codex"),
        null,
      ),
    ).toBe("Codex did not complete this run successfully.");
  });

  it("treats a broken provider input pipe as a protocol failure", () => {
    const error = classifyAgentProviderError("provider_input_failed", "codex");

    expect(error.detail).toEqual({ kind: "protocolFailure", provider: "codex" });
    expect(agentProviderErrorHeadline(error, null)).toBe("Codex could not complete this run.");
    expect(error.raw).toBe("provider_input_failed");
  });

  it("recognizes a code surrounded only by whitespace or wrapped in an error payload", () => {
    const expected = {
      kind: "runnerFailure",
      provider: "claudeCode",
      reason: "processCleanupFailed",
    };

    expect(classifyAgentProviderError("  process_cleanup_failed\n", "claudeCode").detail).toEqual(
      expected,
    );
    expect(
      classifyAgentProviderError(
        JSON.stringify({ error: { message: "process_cleanup_failed" } }),
        "claudeCode",
      ).detail,
    ).toEqual(expected);
  });

  it.each([
    "The tool printed process_cleanup_failed while cleaning up.",
    "process_cleanup_failed: could not signal pid 4242",
    "process_cleanup_failed\nexecution_timeout",
    "Error: execution_timeout",
    "PROCESS_CLEANUP_FAILED",
    "process cleanup failed",
    "execution_failed.",
    "provider_reported_failure: turn failed",
    "Error: provider_reported_failure",
    "PROVIDER_REPORTED_FAILURE",
    "provider reported failure",
  ])("keeps %j as the provider's own text", (raw) => {
    const error = classifyAgentProviderError(raw, "claudeCode");

    expect(error.detail).toEqual({ kind: "unknown" });
    expect(error.message).toBe(raw);
    expect(agentProviderErrorHeadline(error, null)).toBe(raw);
  });

  it.each([
    "cancelled",
    "workspace_identity_invalid",
    "unsupported_platform",
    "git_branch_not_found",
    "brand_new_runner_code",
    "constructor",
    "__proto__",
  ])("passes the unmapped code %s through unchanged", (code) => {
    const error = classifyAgentProviderError(code, "codex");

    expect(error.detail).toEqual({ kind: "unknown" });
    expect(agentProviderErrorHeadline(error, null)).toBe(code);
    expect(error.signature).toBe(`unknown:${code}`);
  });

  it("matches a repeated runner failure and keeps different failures apart", () => {
    const cleanup = classifyAgentProviderError("process_cleanup_failed", "claudeCode");

    expect(
      sameAgentProviderError(
        cleanup,
        classifyAgentProviderError(" process_cleanup_failed ", "claudeCode"),
      ),
    ).toBe(true);
    expect(
      sameAgentProviderError(
        cleanup,
        classifyAgentProviderError("execution_timeout", "claudeCode"),
      ),
    ).toBe(false);
    expect(
      sameAgentProviderError(
        cleanup,
        classifyAgentProviderError("process_cleanup_failed", "codex"),
      ),
    ).toBe(false);
  });

  it("marks only the bare provider-reported code as the generic provider failure", () => {
    for (const provider of ["claudeCode", "codex"] as const) {
      expect(
        isGenericProviderFailure(classifyAgentProviderError("provider_reported_failure", provider)),
      ).toBe(true);
      expect(
        isGenericProviderFailure(
          classifyAgentProviderError(" provider_reported_failure\n", provider),
        ),
      ).toBe(true);
    }
    for (const raw of [
      "provider_result_missing",
      "execution_failed",
      "provider_protocol_failed",
      "authentication_failed",
      "provider_reported_failure: turn failed",
      "PROVIDER_REPORTED_FAILURE",
      "Local provider detail",
      "",
    ]) {
      expect(isGenericProviderFailure(classifyAgentProviderError(raw, "codex"))).toBe(false);
    }
  });

  it("treats a wrapped payload that carries only the provider-reported code as generic", () => {
    const wrapped = classifyAgentProviderError(
      JSON.stringify({ error: { message: "provider_reported_failure" } }),
      "codex",
    );

    expect(isGenericProviderFailure(wrapped)).toBe(true);
    expect(wrapped.message).toBe("provider_reported_failure");
    expect(wrapped.signature).toBe("unknown:provider_reported_failure");
    expect(agentProviderErrorHeadline(wrapped, null)).toBe(
      "Codex did not complete this run successfully.",
    );
  });

  it("matches the generic provider failure with every spelling it matched as unclassified text", () => {
    const generic = classifyAgentProviderError("provider_reported_failure", "codex");

    for (const raw of [
      "provider_reported_failure",
      " provider_reported_failure\n",
      "PROVIDER_REPORTED_FAILURE",
      "  Provider_Reported_Failure\n",
      JSON.stringify({ error: { message: "provider_reported_failure" } }),
    ]) {
      const repeated = classifyAgentProviderError(raw, "codex");

      expect(repeated.signature).toBe(generic.signature);
      expect(sameAgentProviderError(generic, repeated)).toBe(true);
    }
    expect(
      sameAgentProviderError(
        generic,
        classifyAgentProviderError("provider_reported_failure", "claudeCode"),
      ),
    ).toBe(true);
  });

  it("keeps the generic provider failure apart from every other failure", () => {
    const generic = classifyAgentProviderError("provider_reported_failure", "codex");

    for (const raw of [
      "provider_result_missing",
      "execution_failed",
      "provider_reported_failure: turn failed",
      "provider reported failure",
      "Local provider detail",
    ]) {
      expect(sameAgentProviderError(generic, classifyAgentProviderError(raw, "codex"))).toBe(false);
    }
  });
});
