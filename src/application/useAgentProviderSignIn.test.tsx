// @vitest-environment jsdom

import { act, StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentProviderSignInResult } from "../domain/agentProviderSignIn";
import type {
  AgentProviderAdmissionAuthority,
  ReadyAgentProviderAdmissionAuthority,
} from "./agentProviderAdmissionAuthority";
import {
  nextAgentProviderSignInIntentId,
  useAgentProviderSignIn,
  type AgentProviderSignInDependencies,
  type AgentProviderSignInSurface,
} from "./useAgentProviderSignIn";

const READY: ReadyAgentProviderAdmissionAuthority = {
  provider: "claudeCode",
  revision: 4,
  disposition: { kind: "ready" },
  providerGeneration: 7,
};

describe("useAgentProviderSignIn", () => {
  let root: Root;
  let host: HTMLDivElement;

  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  it("bounds intent ids and rolls over only without live ownership", () => {
    expect(nextAgentProviderSignInIntentId(Number.MAX_SAFE_INTEGER - 1, true)).toBe(
      Number.MAX_SAFE_INTEGER,
    );
    expect(nextAgentProviderSignInIntentId(Number.MAX_SAFE_INTEGER, true)).toBeNull();
    expect(nextAgentProviderSignInIntentId(Number.MAX_SAFE_INTEGER, false)).toBe(1);
    expect(nextAgentProviderSignInIntentId(Number.MAX_SAFE_INTEGER + 1, false)).toBeNull();
  });

  it("publishes one typed terminal intent and starts it through the semantic gateway", async () => {
    const harness = render();

    act(() => expect(harness.surface().request("claudeCode")).toBe(true));
    const intent = harness.surface().terminalIntents.claudeCode;
    expect(intent).toMatchObject({ provider: "claudeCode", providerGeneration: 7, revision: 4 });
    expect(intent).not.toHaveProperty("cliPath");
    expect(harness.dependencies.revealTerminal).toHaveBeenCalledTimes(1);

    await act(async () => {
      await harness.surface().start(intent!, { cols: 80, rows: 24 });
    });

    expect(harness.dependencies.gateway.startAgentProviderSignIn).toHaveBeenCalledWith({
      provider: "claudeCode",
      providerGeneration: 7,
      size: { cols: 80, rows: 24 },
    });
    expect(harness.surface().states.claudeCode).toMatchObject({
      kind: "running",
      sessionId: 11,
    });
  });

  it("reports exact frontend refusal reasons and allows the other provider", () => {
    let liveProvider: "claudeCode" | "codex" | null = "claudeCode";
    const harness = render({
      liveTurnCount: (provider) => (provider === liveProvider ? 1 : 0),
      readAuthority: (provider) =>
        provider === "claudeCode"
          ? READY
          : {
              provider: "codex",
              revision: 2,
              disposition: { kind: "ready" },
              providerGeneration: 3,
            },
    });

    expect(harness.surface().blockedReason("claudeCode")).toBe(
      "Stop running Claude Code turns before signing in.",
    );
    expect(harness.surface().blockedReason("codex")).toBeNull();
    act(() => expect(harness.surface().request("codex")).toBe(true));
    liveProvider = null;
    expect(harness.surface().states.codex.kind).toBe("starting");
  });

  it.each([
    [
      { provider: "claudeCode", revision: 1, disposition: { kind: "disabled" } },
      "Enable Claude Code before signing in.",
    ],
    [
      {
        provider: "claudeCode",
        revision: 1,
        disposition: { kind: "policyUnavailable", reason: "notConfigured" },
      },
      "Install Claude Code or configure a valid manual CLI path before signing in.",
    ],
    [
      {
        provider: "claudeCode",
        revision: 1,
        disposition: { kind: "policyUnavailable", reason: "unregistered" },
      },
      "Register Claude Code provider settings before signing in.",
    ],
    [
      {
        provider: "claudeCode",
        revision: 1,
        disposition: { kind: "policyUnavailable", reason: "registrationFailed" },
      },
      "Retry Claude Code provider registration before signing in.",
    ],
    [
      { ...READY, disposition: { kind: "updating" } },
      "Wait for the Claude Code update to finish before signing in.",
    ],
  ] as const)("blocks unavailable authority with a truthful reason %#", (authority, reason) => {
    const harness = render({ readAuthority: () => authority as AgentProviderAdmissionAuthority });
    expect(harness.surface().blockedReason("claudeCode")).toBe(reason);
    act(() => expect(harness.surface().request("claudeCode")).toBe(false));
    expect(harness.dependencies.revealTerminal).not.toHaveBeenCalled();
  });

  it("reprobes exactly once after exact terminal settlement", async () => {
    const harness = render();
    act(() => harness.surface().request("claudeCode"));
    const intent = harness.surface().terminalIntents.claudeCode!;
    await act(async () => harness.surface().start(intent, { cols: 80, rows: 24 }));

    await act(async () => {
      await Promise.all([
        harness.surface().settle(intent, 11, 0),
        harness.surface().settle(intent, 11, 0),
      ]);
    });

    expect(harness.dependencies.refresh).toHaveBeenCalledExactlyOnceWith("claudeCode", READY);
    expect(harness.surface().states.claudeCode).toMatchObject({
      kind: "settled",
      exitCode: 0,
      healthRefresh: "complete",
    });
  });

  it("publishes refreshing until the exact health reprobe completes", async () => {
    let completeRefresh!: () => void;
    const refresh = vi.fn(
      () =>
        new Promise<{ readonly kind: "complete"; readonly authority: typeof READY }>((resolve) => {
          completeRefresh = () => resolve({ kind: "complete", authority: READY });
        }),
    );
    const harness = render({ refresh });
    act(() => harness.surface().request("claudeCode"));
    const intent = harness.surface().terminalIntents.claudeCode!;
    await act(async () => harness.surface().start(intent, { cols: 80, rows: 24 }));

    let settlement!: Promise<void>;
    act(() => {
      settlement = harness.surface().settle(intent, 11, 0);
    });
    expect(harness.surface().states.claudeCode).toMatchObject({
      kind: "settled",
      healthRefresh: "refreshing",
    });

    await act(async () => completeRefresh());
    await settlement;
    expect(harness.surface().states.claudeCode).toMatchObject({
      kind: "settled",
      healthRefresh: "complete",
    });
  });

  it("clears old refreshing presentation when authority changes during the reprobe", async () => {
    let authority: AgentProviderAdmissionAuthority = READY;
    let completeRefresh!: () => void;
    const refresh = vi.fn(
      () =>
        new Promise<{ readonly kind: "complete"; readonly authority: typeof READY }>((resolve) => {
          completeRefresh = () => resolve({ kind: "complete", authority: READY });
        }),
    );
    const harness = render({ readAuthority: () => authority, refresh });
    act(() => harness.surface().request("claudeCode"));
    const intent = harness.surface().terminalIntents.claudeCode!;
    await act(async () => harness.surface().start(intent, { cols: 80, rows: 24 }));
    let settlement!: Promise<void>;
    act(() => {
      settlement = harness.surface().settle(intent, 11, 0);
    });
    authority = { ...READY, revision: 5 };

    await act(async () => completeRefresh());
    await settlement;

    expect(harness.surface().states.claudeCode).toEqual({ kind: "idle" });
  });

  it("reports a failed health reprobe without claiming refreshed status", async () => {
    const harness = render({ refresh: vi.fn(async () => Promise.reject("probe failed")) });
    act(() => harness.surface().request("claudeCode"));
    const intent = harness.surface().terminalIntents.claudeCode!;
    await act(async () => harness.surface().start(intent, { cols: 80, rows: 24 }));

    await act(async () => harness.surface().settle(intent, 11, 0));

    expect(harness.surface().states.claudeCode).toMatchObject({
      kind: "settled",
      healthRefresh: "failed",
    });
  });

  it.each([
    ["generation", { ...READY, providerGeneration: 8 }],
    ["revision", { ...READY, revision: 8 }],
    [
      "policy",
      {
        provider: "claudeCode" as const,
        revision: 7,
        disposition: { kind: "disabled" as const },
      },
    ],
  ])(
    "does not reprobe a replacement authority after %s changes during the PTY",
    async (_case, next) => {
      let authority: AgentProviderAdmissionAuthority = READY;
      const harness = render({ readAuthority: () => authority });
      act(() => harness.surface().request("claudeCode"));
      const intent = harness.surface().terminalIntents.claudeCode!;
      await act(async () => harness.surface().start(intent, { cols: 80, rows: 24 }));
      authority = next;

      await act(async () => harness.surface().settle(intent, 11, 0));

      expect(harness.dependencies.refresh).not.toHaveBeenCalled();
      expect(harness.surface().states.claudeCode).toEqual({ kind: "idle" });
    },
  );

  it("consumes each terminal intent at most once", async () => {
    const harness = render();
    act(() => harness.surface().request("claudeCode"));
    const intent = harness.surface().terminalIntents.claudeCode!;

    await act(async () => {
      await Promise.all([
        harness.surface().start(intent, { cols: 80, rows: 24 }),
        harness.surface().start(intent, { cols: 80, rows: 24 }),
      ]);
    });

    expect(harness.dependencies.gateway.startAgentProviderSignIn).toHaveBeenCalledTimes(1);
  });

  it("releases exact sign-in exclusion when terminal subscription startup is cancelled", () => {
    const harness = render();
    act(() => expect(harness.surface().request("claudeCode")).toBe(true));
    const intent = harness.surface().terminalIntents.claudeCode!;

    act(() => harness.surface().cancelStart(intent));

    expect(harness.surface().states.claudeCode).toMatchObject({
      kind: "failed",
      reason: "spawnFailed",
    });
    expect(harness.surface().terminalIntents.claudeCode).toBeNull();
    expect(harness.surface().isActive("claudeCode")).toBe(false);
    act(() => expect(harness.surface().request("claudeCode")).toBe(true));
  });

  it("rejects a forged intent that reuses the current id with changed authority", async () => {
    const harness = render();
    act(() => harness.surface().request("claudeCode"));
    const intent = harness.surface().terminalIntents.claudeCode!;

    for (const forged of [
      { ...intent, provider: "codex" as const },
      { ...intent, revision: 99 },
      { ...intent, providerGeneration: 99 },
    ]) {
      await act(async () => harness.surface().start(forged, { cols: 80, rows: 24 }));
    }

    expect(harness.dependencies.gateway.startAgentProviderSignIn).not.toHaveBeenCalled();
  });

  it("revalidates live turns immediately before gateway start", async () => {
    let live = 0;
    const harness = render({ liveTurnCount: () => live });
    act(() => harness.surface().request("claudeCode"));
    const intent = harness.surface().terminalIntents.claudeCode!;
    live = 1;

    await act(async () => harness.surface().start(intent, { cols: 80, rows: 24 }));

    expect(harness.dependencies.gateway.startAgentProviderSignIn).not.toHaveBeenCalled();
    expect(harness.surface().terminalIntents.claudeCode).toBeNull();
  });

  it("privately revalidates the captured revision without exposing executable details", async () => {
    let authority = READY;
    const harness = render({ readAuthority: () => authority });
    act(() => harness.surface().request("claudeCode"));
    const intent = harness.surface().terminalIntents.claudeCode!;
    expect(Reflect.ownKeys(intent)).toEqual([
      "intentId",
      "provider",
      "providerGeneration",
      "revision",
    ]);
    authority = { ...READY, revision: 5 };

    await act(async () => harness.surface().start(intent, { cols: 80, rows: 24 }));

    expect(harness.dependencies.gateway.startAgentProviderSignIn).not.toHaveBeenCalled();
    expect(harness.surface().terminalIntents.claudeCode).toBeNull();
  });

  it("revalidates terminal and update availability immediately before gateway start", async () => {
    const harness = render();
    act(() => harness.surface().request("claudeCode"));
    const terminalIntent = harness.surface().terminalIntents.claudeCode!;
    harness.replace({ terminalUnavailableReason: () => "Open a trusted workspace first." });
    await act(async () => harness.surface().start(terminalIntent, { cols: 80, rows: 24 }));
    expect(harness.dependencies.gateway.startAgentProviderSignIn).not.toHaveBeenCalled();

    harness.replace({ terminalUnavailableReason: () => null });
    act(() => harness.surface().request("claudeCode"));
    const updateIntent = harness.surface().terminalIntents.claudeCode!;
    harness.replace({
      readAuthority: () => ({ ...READY, disposition: { kind: "updating" } }),
    });
    await act(async () => harness.surface().start(updateIntent, { cols: 80, rows: 24 }));
    expect(harness.dependencies.gateway.startAgentProviderSignIn).not.toHaveBeenCalled();
  });

  it("releases one-shot ownership after a gateway failure so a retry can start", async () => {
    const gateway = {
      startAgentProviderSignIn: vi
        .fn()
        .mockRejectedValueOnce("spawn failed")
        .mockResolvedValueOnce({
          kind: "started",
          provider: "claudeCode",
          providerGeneration: 7,
          sessionId: 19,
        }),
    };
    const harness = render({ gateway });
    act(() => harness.surface().request("claudeCode"));
    const first = harness.surface().terminalIntents.claudeCode!;
    await act(async () => harness.surface().start(first, { cols: 80, rows: 24 }));
    expect(harness.surface().states.claudeCode).toMatchObject({
      kind: "failed",
      reason: "uncertain",
    });

    act(() => harness.surface().request("claudeCode"));
    const retry = harness.surface().terminalIntents.claudeCode!;
    await act(async () => harness.surface().start(retry, { cols: 80, rows: 24 }));
    expect(gateway.startAgentProviderSignIn).toHaveBeenCalledTimes(2);
    expect(harness.surface().states.claudeCode.kind).toBe("running");
  });

  it("ignores A-B-A stale start completion and compensates the spawned session", async () => {
    let current = READY;
    let resolve!: (value: AgentProviderSignInResult) => void;
    const pending = new Promise<AgentProviderSignInResult>((settle) => {
      resolve = settle;
    });
    const harness = render({
      readAuthority: () => current,
      gateway: { startAgentProviderSignIn: vi.fn(() => pending) },
    });
    act(() => harness.surface().request("claudeCode"));
    const intent = harness.surface().terminalIntents.claudeCode!;
    let start!: Promise<AgentProviderSignInResult | null>;
    act(() => {
      start = harness.surface().start(intent, { cols: 80, rows: 24 });
    });
    current = { ...READY, revision: 5, providerGeneration: 8 };
    current = { ...READY, revision: 6, providerGeneration: 9 };
    await act(async () =>
      resolve({
        kind: "started",
        provider: "claudeCode",
        providerGeneration: 7,
        sessionId: 44,
      }),
    );

    await expect(start).resolves.toBeNull();
    expect(harness.dependencies.stopSession).toHaveBeenCalledWith(44);
    expect(harness.dependencies.refresh).not.toHaveBeenCalled();
    expect(harness.surface().states.claudeCode.kind).toBe("idle");
  });

  it("fails uncertain and clears ownership when stale-session compensation rejects", async () => {
    let resolve!: (value: AgentProviderSignInResult) => void;
    const pending = new Promise<AgentProviderSignInResult>((settle) => {
      resolve = settle;
    });
    const harness = render({
      gateway: { startAgentProviderSignIn: vi.fn(() => pending) },
      stopSession: vi.fn(async () => Promise.reject("stop failed")),
    });
    act(() => harness.surface().request("claudeCode"));
    const intent = harness.surface().terminalIntents.claudeCode!;
    let start!: Promise<AgentProviderSignInResult | null>;
    act(() => {
      start = harness.surface().start(intent, { cols: 80, rows: 24 });
    });
    harness.replace({ readAuthority: () => ({ ...READY, revision: 6, providerGeneration: 9 }) });
    await act(async () =>
      resolve({
        kind: "started",
        provider: "claudeCode",
        providerGeneration: 7,
        sessionId: 45,
      }),
    );

    await expect(start).resolves.toBeNull();
    expect(harness.surface().terminalIntents.claudeCode).toBeNull();
    expect(harness.surface().states.claudeCode).toMatchObject({
      kind: "failed",
      reason: "uncertain",
    });
  });

  it("compensates a started result from a replaced gateway", async () => {
    let resolve!: (value: AgentProviderSignInResult) => void;
    const pending = new Promise<AgentProviderSignInResult>((settle) => {
      resolve = settle;
    });
    const harness = render({
      gateway: { startAgentProviderSignIn: vi.fn(() => pending) },
    });
    act(() => harness.surface().request("claudeCode"));
    const intent = harness.surface().terminalIntents.claudeCode!;
    let start!: Promise<AgentProviderSignInResult | null>;
    act(() => {
      start = harness.surface().start(intent, { cols: 80, rows: 24 });
    });
    harness.replace({
      gateway: { startAgentProviderSignIn: vi.fn(() => Promise.reject("must not run")) },
    });
    await act(async () =>
      resolve({
        kind: "started",
        provider: "claudeCode",
        providerGeneration: 7,
        sessionId: 51,
      }),
    );

    await expect(start).resolves.toBeNull();
    expect(harness.dependencies.stopSession).toHaveBeenCalledWith(51);
    expect(harness.surface().terminalIntents.claudeCode).toBeNull();
  });

  it("keeps exclusion active until gateway-replacement cleanup settles", async () => {
    let releaseStop!: () => void;
    const stop = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          releaseStop = resolve;
        }),
    );
    const harness = render({ stopSession: stop });
    act(() => harness.surface().request("claudeCode"));
    const intent = harness.surface().terminalIntents.claudeCode!;
    await act(async () => harness.surface().start(intent, { cols: 80, rows: 24 }));

    harness.replace({
      gateway: { startAgentProviderSignIn: vi.fn(() => Promise.reject("unused")) },
      stopSession: vi.fn(async () => undefined),
    });
    expect(stop).toHaveBeenCalledExactlyOnceWith(11);
    expect(harness.surface().isActive("claudeCode")).toBe(true);
    await act(async () => releaseStop());
    expect(harness.surface().isActive("claudeCode")).toBe(false);
    expect(harness.surface().states.claudeCode.kind).toBe("idle");
  });

  it("marks gateway-replacement cleanup rejection uncertain", async () => {
    const capturedStop = vi.fn(async () => Promise.reject("stop failed"));
    const harness = render({ stopSession: capturedStop });
    act(() => harness.surface().request("claudeCode"));
    const intent = harness.surface().terminalIntents.claudeCode!;
    await act(async () => harness.surface().start(intent, { cols: 80, rows: 24 }));

    harness.replace({
      gateway: { startAgentProviderSignIn: vi.fn(() => Promise.reject("unused")) },
      stopSession: vi.fn(async () => undefined),
    });
    await act(async () => undefined);

    expect(capturedStop).toHaveBeenCalledExactlyOnceWith(11);
    expect(harness.surface().states.claudeCode).toMatchObject({
      kind: "failed",
      reason: "uncertain",
    });
  });

  it("uses the running session's captured compensator on unmount", async () => {
    const capturedStop = vi.fn(async () => undefined);
    const replacementStop = vi.fn(async () => undefined);
    const harness = render({ stopSession: capturedStop });
    act(() => harness.surface().request("claudeCode"));
    const intent = harness.surface().terminalIntents.claudeCode!;
    await act(async () => harness.surface().start(intent, { cols: 80, rows: 24 }));
    harness.replace({ stopSession: replacementStop });

    act(() => root.unmount());
    root = createRoot(host);

    expect(capturedStop).toHaveBeenCalledExactlyOnceWith(11);
    expect(replacementStop).not.toHaveBeenCalled();
  });

  it("catches rejection from the running session's captured compensator on unmount", async () => {
    const capturedStop = vi.fn(async () => Promise.reject("stop failed"));
    const harness = render({ stopSession: capturedStop });
    act(() => harness.surface().request("claudeCode"));
    const intent = harness.surface().terminalIntents.claudeCode!;
    await act(async () => harness.surface().start(intent, { cols: 80, rows: 24 }));

    act(() => root.unmount());
    root = createRoot(host);
    await act(async () => undefined);

    expect(capturedStop).toHaveBeenCalledExactlyOnceWith(11);
  });

  it("remains live through the StrictMode setup-cleanup-setup cycle", async () => {
    const harness = render({}, true);
    act(() => expect(harness.surface().request("claudeCode")).toBe(true));
    const intent = harness.surface().terminalIntents.claudeCode!;
    await act(async () => harness.surface().start(intent, { cols: 80, rows: 24 }));

    expect(harness.surface().states.claudeCode.kind).toBe("running");
  });

  function render(
    overrides: Partial<AgentProviderSignInDependencies> = {},
    strict = false,
  ): {
    readonly dependencies: AgentProviderSignInDependencies;
    replace(replacement: Partial<AgentProviderSignInDependencies>): void;
    surface(): AgentProviderSignInSurface;
  } {
    let current!: AgentProviderSignInSurface;
    let dependencies: AgentProviderSignInDependencies = {
      gateway: {
        startAgentProviderSignIn: vi.fn(async (request): Promise<AgentProviderSignInResult> => {
          return {
            kind: "started",
            provider: request.provider,
            providerGeneration: request.providerGeneration,
            sessionId: 11,
          };
        }),
      },
      liveTurnCount: () => 0,
      readAuthority: () => READY,
      refresh: vi.fn(async () => ({ kind: "complete" as const, authority: READY })),
      revealTerminal: vi.fn(),
      stopSession: vi.fn(async () => undefined),
      terminalUnavailableReason: () => null,
      ...overrides,
    };
    function Harness() {
      current = useAgentProviderSignIn(dependencies);
      return null;
    }
    const renderHarness = () =>
      root.render(
        strict ? (
          <StrictMode>
            <Harness />
          </StrictMode>
        ) : (
          <Harness />
        ),
      );
    act(renderHarness);
    return {
      get dependencies() {
        return dependencies;
      },
      replace: (replacement) => {
        dependencies = { ...dependencies, ...replacement };
        act(renderHarness);
      },
      surface: () => current,
    };
  }
});
