import { describe, expect, it } from "vitest";
import type { AgentMcpServerActivity } from "../../../application/agentMcpServerManagementStore";
import {
  AGENT_MCP_SERVER_CHANGE_KINDS,
  AGENT_MCP_SERVER_CONFIG_SCOPES,
  AGENT_MCP_SERVER_LAUNCH_KINDS,
  AGENT_MCP_SERVER_MANAGEMENT_ERROR_KINDS,
} from "../../../domain/agentMcpServerManagement";
import {
  mcpActivityErrorMessage,
  mcpActivityStatusText,
  mcpAddScopeLabel,
  mcpAddServerButtonLabel,
  mcpCallbackIssueMessage,
  mcpChangingText,
  mcpLaunchKindLabel,
  mcpMoreActionsLabel,
  mcpNameIssueMessage,
  mcpRemoveDescription,
  mcpRemoveTitle,
  mcpSignInPageLabel,
  mcpSignInToLabel,
  mcpSucceededText,
  mcpTargetIssueMessage,
} from "./mcpServerManagementPresentation";

const ACTIONS = ["signIn", "signInAgain", "signOut", "remove", "add"] as const;
const ERRORS = [...AGENT_MCP_SERVER_MANAGEMENT_ERROR_KINDS, "loginFailed", "loginExpired"] as const;

describe("mcpServerManagementPresentation", () => {
  it("labels the controls with the server or provider they act on", () => {
    expect(mcpSignInToLabel("linear")).toBe("Sign in to linear");
    expect(mcpMoreActionsLabel("linear")).toBe("More actions for linear");
    expect(mcpSignInPageLabel("auth.example.com")).toBe("Sign-in page: auth.example.com");
    expect(mcpAddServerButtonLabel("claudeCode")).toBe("Add Claude Code MCP server");
    expect(mcpAddServerButtonLabel("codex")).toBe("Add Codex MCP server");
    expect(mcpRemoveTitle("linear")).toBe("Remove linear?");
  });

  it("names the scope a server is removed from", () => {
    expect(
      AGENT_MCP_SERVER_CONFIG_SCOPES.map((scope) => mcpRemoveDescription(scope, "codex")),
    ).toEqual([
      "It will be removed from your Codex configuration for all projects.",
      "It will be removed from this project's shared configuration.",
      "It will be removed from your Codex configuration for this project.",
    ]);
  });

  it("labels the server types and the scopes offered when adding", () => {
    expect(AGENT_MCP_SERVER_LAUNCH_KINDS.map(mcpLaunchKindLabel)).toEqual([
      "HTTP",
      "SSE",
      "Command",
    ]);
    expect(mcpAddScopeLabel("local")).toBe("This project");
    expect(mcpAddScopeLabel("user")).toBe("All projects");
  });

  it("describes every activity that is in progress", () => {
    const browser = { mode: "signIn", signInHost: "a.example" } as const;
    const cases: ReadonlyArray<readonly [AgentMcpServerActivity, string | null]> = [
      [{ kind: "idle" }, null],
      [{ kind: "failed", action: "signIn", error: "busy" }, null],
      [{ kind: "starting", mode: "signIn" }, "Opening the sign-in page…"],
      [
        {
          kind: "waitingForBrowser",
          ...browser,
          delivery: "paste",
          page: "opening",
          callbackError: null,
        },
        "Opening the sign-in page…",
      ],
      [
        {
          kind: "waitingForBrowser",
          ...browser,
          delivery: "paste",
          page: "opened",
          callbackError: null,
        },
        "Finish signing in in your browser.",
      ],
      [
        {
          kind: "waitingForBrowser",
          ...browser,
          delivery: "paste",
          page: "blocked",
          callbackError: null,
        },
        null,
      ],
      [
        { kind: "finishInBrowser", ...browser, page: "opened", checking: false },
        "Finish connecting in your browser, then check again.",
      ],
      [{ kind: "finishInBrowser", ...browser, page: "blocked", checking: false }, null],
      [{ kind: "finishInBrowser", ...browser, page: "blocked", checking: true }, "Checking…"],
      [{ kind: "submittingCallback", ...browser }, "Finishing sign-in…"],
      [{ kind: "changing", change: "remove" }, "Removing…"],
      [{ kind: "succeeded", action: "signOut" }, "Signed out. Checking the server…"],
    ];
    for (const [activity, text] of cases) expect(mcpActivityStatusText(activity)).toBe(text);
    expect(AGENT_MCP_SERVER_CHANGE_KINDS.map(mcpChangingText)).toEqual([
      "Adding…",
      "Removing…",
      "Signing out…",
    ]);
    expect(ACTIONS.map(mcpSucceededText)).toEqual([
      "Signed in. Checking the server…",
      "Signed in. Checking the server…",
      "Signed out. Checking the server…",
      "Removed. Checking servers…",
      "Added. Checking servers…",
    ]);
  });

  it("has a short sentence for every error of every action", () => {
    for (const action of ACTIONS)
      for (const error of ERRORS) {
        const message = mcpActivityErrorMessage(action, error, "claudeCode");
        expect(message.length, `${action}/${error}`).toBeGreaterThan(10);
        expect(message.length, `${action}/${error}`).toBeLessThan(120);
        expect(message.endsWith("."), `${action}/${error}`).toBe(true);
      }
    expect(mcpActivityErrorMessage("add", "serverExists", "codex")).toBe(
      "A server with this name is already configured.",
    );
    expect(mcpActivityErrorMessage("remove", "providerDisabled", "codex")).toBe(
      "Codex is turned off in Providers settings.",
    );
    expect(
      ACTIONS.map((action) => mcpActivityErrorMessage(action, "unavailable", "codex")),
    ).toEqual([
      "Sign-in could not be completed.",
      "Sign-in could not be completed.",
      "Could not sign out.",
      "Could not remove the server.",
      "Could not add the server.",
    ]);
  });

  it("stays quiet about empty fields and explains every other problem", () => {
    expect(mcpCallbackIssueMessage("empty")).toBeNull();
    expect(mcpNameIssueMessage(null)).toBeNull();
    expect(mcpNameIssueMessage("empty")).toBeNull();
    expect(mcpTargetIssueMessage(null)).toBeNull();
    expect(mcpTargetIssueMessage({ kind: "url", issue: "empty" })).toBeNull();
    expect(mcpTargetIssueMessage({ kind: "command", issue: "empty" })).toBeNull();
    const messages = [
      ...(["tooLong", "notLoopback", "missingResult", "invalid"] as const).map(
        mcpCallbackIssueMessage,
      ),
      ...(["tooLong", "invalid", "taken"] as const).map(mcpNameIssueMessage),
      ...(["tooLong", "whitespace", "notHttp", "credentials", "invalid"] as const).map((issue) =>
        mcpTargetIssueMessage({ kind: "url", issue }),
      ),
      ...(
        [
          "tooLong",
          "unbalancedQuote",
          "danglingEscape",
          "controlCharacter",
          "commandTooLong",
          "tooManyArguments",
          "argumentTooLong",
        ] as const
      ).map((issue) => mcpTargetIssueMessage({ kind: "command", issue })),
      mcpTargetIssueMessage({ kind: "launch", issue: "unsupported" }),
    ];
    for (const message of messages) expect(message?.endsWith(".")).toBe(true);
    expect(new Set(messages).size).toBeGreaterThan(16);
  });
});
