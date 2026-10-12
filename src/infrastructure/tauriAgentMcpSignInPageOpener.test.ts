import { describe, expect, it, vi } from "vitest";
import {
  AGENT_MCP_SIGN_IN_PAGE_OPEN_FAILED,
  TauriAgentMcpSignInPageOpener,
} from "./tauriAgentMcpSignInPageOpener";

const AUTHORIZE = "https://auth.example.com/authorize?state=secret-state";

describe("TauriAgentMcpSignInPageOpener", () => {
  it.each([AUTHORIZE, "http://localhost:53682/start", "http://127.0.0.1:1455/auth"])(
    "opens the sign-in page %j",
    async (url) => {
      const openUrl = vi.fn(async () => undefined);
      await new TauriAgentMcpSignInPageOpener(openUrl).openExternal(url);
      expect(openUrl).toHaveBeenCalledExactlyOnceWith(url);
    },
  );

  it.each([
    "",
    "http://auth.example.com/authorize",
    "http://localhost.evil.example/",
    "file:///etc/passwd",
    "javascript:alert(1)",
    "codevo://open",
    "mailto:someone@example.com",
    "https://auth.example.com/a b",
    "/Applications/Calculator.app",
    `https://auth.example.com/${"a".repeat(4096)}`,
  ])("refuses to open %j", async (url) => {
    const openUrl = vi.fn(async () => undefined);
    await expect(new TauriAgentMcpSignInPageOpener(openUrl).openExternal(url)).rejects.toThrow(
      AGENT_MCP_SIGN_IN_PAGE_OPEN_FAILED,
    );
    expect(openUrl).not.toHaveBeenCalled();
  });

  it("reports a failed open without repeating the address", async () => {
    const openUrl = vi.fn(async () => Promise.reject(new Error(`no handler for ${AUTHORIZE}`)));
    const failure = await new TauriAgentMcpSignInPageOpener(openUrl).openExternal(AUTHORIZE).then(
      () => null,
      (error: unknown) => error,
    );
    expect(failure).toBeInstanceOf(Error);
    expect(String(failure)).toBe(`Error: ${AGENT_MCP_SIGN_IN_PAGE_OPEN_FAILED}`);
    expect(String(failure)).not.toContain("secret-state");
  });
});
