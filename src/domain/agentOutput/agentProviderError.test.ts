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
