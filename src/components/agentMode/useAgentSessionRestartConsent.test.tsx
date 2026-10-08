// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import type { AgentLaunchOptions, ClaudeLaunchOptions } from "../../domain/agentLaunch";
import {
  BUNDLED_CLAUDE_MODEL_MANIFEST,
  type ClaudeModelManifest,
} from "../../domain/claudeModelCatalog";
import { ClaudeModelCatalogContext } from "./useAgentClaudeModelCatalog";
import {
  useAgentSessionRestartGate,
  type AgentSessionRestartGate,
} from "./useAgentSessionRestartConsent";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const THREAD_ID = "agt-1";
const FIXED_WINDOW = "claude-opus-4-7";
const OFFERS_A_CHOICE = "claude-opus-4-6";
const REFUSING = { followUpNeedsSessionRestart: () => true };

const disposers: (() => void)[] = [];
afterEach(() => {
  disposers.splice(0).forEach((dispose) => dispose());
});

function claude(
  model: ClaudeLaunchOptions["model"],
  context?: ClaudeLaunchOptions["context"],
): ClaudeLaunchOptions {
  const launch: ClaudeLaunchOptions = {
    provider: "claudeCode",
    model,
    mode: "bypassPermissions",
    effort: "high",
  };
  if (context === undefined) return launch;
  return { ...launch, context };
}

function renderGate(initial: AgentLaunchOptions, catalog = BUNDLED_CLAUDE_MODEL_MANIFEST) {
  const root = createRoot(document.createElement("div"));
  const result: { current: AgentSessionRestartGate | null } = { current: null };
  function Harness({ launch }: { readonly launch: AgentLaunchOptions }) {
    result.current = useAgentSessionRestartGate(REFUSING, THREAD_ID, launch);
    return null;
  }
  const render = (launch: AgentLaunchOptions, value: ClaudeModelManifest = catalog): void =>
    act(() =>
      root.render(
        <ClaudeModelCatalogContext.Provider value={value}>
          <Harness launch={launch} />
        </ClaudeModelCatalogContext.Provider>,
      ),
    );
  render(initial);
  disposers.push(() => act(() => root.unmount()));
  const refuse = (launch: AgentLaunchOptions): void =>
    act(() =>
      result.current?.settleFollowUp(
        {
          threadId: THREAD_ID,
          submission: { launch, dangerousLaunchConfirmed: true },
          source: "draft",
        },
        false,
        () => true,
      ),
    );
  return { render, refuse, pending: () => result.current?.confirmation !== null };
}

describe("useAgentSessionRestartGate", () => {
  it("keeps the restart question when only the context of a fixed-window model differs", () => {
    const held = claude(FIXED_WINDOW, "1m");
    const gate = renderGate(held);
    gate.refuse(held);
    expect(gate.pending()).toBe(true);

    gate.render(claude(FIXED_WINDOW));
    expect(gate.pending()).toBe(true);
    gate.render(claude(FIXED_WINDOW, "200k"));
    expect(gate.pending()).toBe(true);
  });

  it("keeps the restart question when the context difference launches the same model", () => {
    const held = claude(OFFERS_A_CHOICE);
    const gate = renderGate(held);
    gate.refuse(held);

    gate.render(claude(OFFERS_A_CHOICE, "1m"));
    expect(gate.pending()).toBe(true);
  });

  it("drops the restart question when the context of a model that offers the choice changes", () => {
    const held = claude(OFFERS_A_CHOICE, "1m");
    const gate = renderGate(held);
    gate.refuse(held);
    expect(gate.pending()).toBe(true);

    gate.render(claude(OFFERS_A_CHOICE, "200k"));
    expect(gate.pending()).toBe(false);
  });

  it("follows the live catalog once it fixes a window the bundle still offers", () => {
    const fixedNow: ClaudeModelManifest = {
      ...BUNDLED_CLAUDE_MODEL_MANIFEST,
      claudeCode: BUNDLED_CLAUDE_MODEL_MANIFEST.claudeCode.map((entry) =>
        entry.choice === OFFERS_A_CHOICE
          ? { ...entry, contextWindows: [], defaultContext: null }
          : entry,
      ),
    };
    const held = claude(OFFERS_A_CHOICE, "1m");
    const gate = renderGate(held, fixedNow);
    gate.refuse(held);

    gate.render(claude(OFFERS_A_CHOICE, "200k"));
    expect(gate.pending()).toBe(true);
    gate.render(claude(OFFERS_A_CHOICE, "200k"), BUNDLED_CLAUDE_MODEL_MANIFEST);
    expect(gate.pending()).toBe(false);
  });

  it("drops the restart question when the mode of a fixed-window model changes", () => {
    const held = claude(FIXED_WINDOW, "1m");
    const gate = renderGate(held);
    gate.refuse(held);

    gate.render({ ...claude(FIXED_WINDOW), mode: "plan" });
    expect(gate.pending()).toBe(false);
  });

  it("drops the restart question when the effort of a live-catalog model changes", () => {
    const liveOnly = "claude-future-9";
    const withLiveModel: ClaudeModelManifest = {
      ...BUNDLED_CLAUDE_MODEL_MANIFEST,
      claudeCode: [
        ...BUNDLED_CLAUDE_MODEL_MANIFEST.claudeCode,
        {
          choice: liveOnly,
          label: "Claude Future 9",
          runtimeIds: [liveOnly],
          status: "current",
          efforts: ["low", "high"],
          defaultEffort: "low",
          contextWindows: [],
          defaultContext: null,
          fastMode: false,
          thinkingMode: false,
        },
      ],
    };
    const held: ClaudeLaunchOptions = { ...claude(liveOnly), effort: "default" };
    const gate = renderGate(held, withLiveModel);
    gate.refuse(held);
    expect(gate.pending()).toBe(true);

    const withContext: ClaudeLaunchOptions = { ...held, context: "1m" };
    gate.render(withContext);
    expect(gate.pending()).toBe(true);
    gate.render({ ...held, effort: "high" });
    expect(gate.pending()).toBe(false);
  });

  it("drops the restart question when a retired mode is replaced by an explicit one", () => {
    const held: ClaudeLaunchOptions = { ...claude(FIXED_WINDOW), mode: "default" };
    const gate = renderGate(held);
    gate.refuse(held);
    expect(gate.pending()).toBe(true);

    gate.render({ ...held, mode: "bypassPermissions" });
    expect(gate.pending()).toBe(false);
  });

  it("compares Codex launches exactly as written", () => {
    const held: AgentLaunchOptions = { provider: "codex", model: "default", mode: "default" };
    const gate = renderGate(held);
    gate.refuse(held);
    expect(gate.pending()).toBe(true);

    gate.render({ ...held, effort: "default" });
    expect(gate.pending()).toBe(true);
    gate.render({ ...held, mode: "dangerFullAccess" });
    expect(gate.pending()).toBe(false);

    gate.render(held);
    gate.refuse(held);
    expect(gate.pending()).toBe(true);
    gate.render({ ...held, effort: "high" });
    expect(gate.pending()).toBe(false);
  });
});
