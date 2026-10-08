import { describe, expect, it } from "vitest";
import type { AgentLaunchOptions } from "./agentLaunch";
import { remoteRunnerEchoesLaunch, remoteRunnerLaunchIdentity } from "./remoteRunnerLaunchEcho";

const fixedWindow = {
  provider: "claudeCode",
  model: "claude-opus-5-5",
  mode: "bypassPermissions",
  effort: "high",
} as const satisfies AgentLaunchOptions;
const storedByEarlierRunner = {
  ...fixedWindow,
  context: "200k",
  fastMode: false,
  thinkingMode: false,
} as const satisfies AgentLaunchOptions;
const selectable = {
  ...fixedWindow,
  model: "claude-opus-4-6",
  context: "1m",
} as const satisfies AgentLaunchOptions;
const selectableAt200k = {
  ...selectable,
  context: "200k",
} as const satisfies AgentLaunchOptions;
const codex = {
  provider: "codex",
  model: "default",
  mode: "workspaceWrite",
} as const satisfies AgentLaunchOptions;

describe("remote runner launch echo", () => {
  it("accepts an omitted context echoed as omitted", () => {
    expect(remoteRunnerEchoesLaunch(fixedWindow, fixedWindow)).toBe(true);
    expect(
      remoteRunnerEchoesLaunch(fixedWindow, {
        ...fixedWindow,
        fastMode: false,
        thinkingMode: false,
      }),
    ).toBe(true);
  });

  it("accepts the 200k an earlier runner invents for an omitted context", () => {
    expect(remoteRunnerEchoesLaunch(fixedWindow, storedByEarlierRunner)).toBe(true);
  });

  it("accepts an explicit 200k echoed as omitted, which a retry of a request stored without a context returns", () => {
    expect(
      remoteRunnerEchoesLaunch(selectableAt200k, { ...fixedWindow, model: selectable.model }),
    ).toBe(true);
  });

  it("rejects a context the editor never sent or chose differently", () => {
    expect(remoteRunnerEchoesLaunch(fixedWindow, { ...fixedWindow, context: "1m" })).toBe(false);
    expect(remoteRunnerEchoesLaunch(selectable, selectableAt200k)).toBe(false);
    expect(remoteRunnerEchoesLaunch(selectableAt200k, selectable)).toBe(false);
    expect(remoteRunnerEchoesLaunch(selectable, fixedWindow)).toBe(false);
    expect(remoteRunnerEchoesLaunch(selectable, { ...fixedWindow, model: selectable.model })).toBe(
      false,
    );
  });

  it("accepts an explicit context echoed unchanged", () => {
    expect(remoteRunnerEchoesLaunch(selectable, selectable)).toBe(true);
    expect(remoteRunnerEchoesLaunch(selectableAt200k, selectableAt200k)).toBe(true);
  });

  it("rejects a missing echo and any other changed Claude choice", () => {
    expect(remoteRunnerEchoesLaunch(fixedWindow, undefined)).toBe(false);
    for (const echoed of [
      { ...fixedWindow, model: "claude-sonnet-5-5" },
      { ...fixedWindow, mode: "plan" },
      { ...fixedWindow, effort: "low" },
      { ...fixedWindow, fastMode: true },
      { ...fixedWindow, thinkingMode: true },
      codex,
    ] as const satisfies readonly AgentLaunchOptions[])
      expect(remoteRunnerEchoesLaunch(fixedWindow, echoed)).toBe(false);
  });

  it("treats an omitted Codex effort as the default effort", () => {
    expect(remoteRunnerEchoesLaunch(codex, codex)).toBe(true);
    expect(remoteRunnerEchoesLaunch(codex, { ...codex, effort: "default" })).toBe(true);
    expect(remoteRunnerEchoesLaunch({ ...codex, effort: "high" }, codex)).toBe(false);
    expect(remoteRunnerEchoesLaunch(codex, { ...codex, mode: "readOnly" })).toBe(false);
    expect(remoteRunnerEchoesLaunch(codex, fixedWindow)).toBe(false);
  });
});

describe("remote runner launch identity", () => {
  it("is the same for every representation the runner stores as one request", () => {
    const stored = remoteRunnerLaunchIdentity(storedByEarlierRunner);
    expect(remoteRunnerLaunchIdentity(fixedWindow)).toEqual(stored);
    expect(remoteRunnerLaunchIdentity({ ...fixedWindow, fastMode: false })).toEqual(stored);
    expect(remoteRunnerLaunchIdentity({ ...fixedWindow, chrome: false })).toEqual(stored);
    expect(remoteRunnerLaunchIdentity({ ...codex, effort: "default" })).toEqual(
      remoteRunnerLaunchIdentity(codex),
    );
  });

  it("differs for every choice that changes the remote launch", () => {
    const base = JSON.stringify(remoteRunnerLaunchIdentity(fixedWindow));
    for (const changed of [
      { ...fixedWindow, context: "1m" },
      { ...fixedWindow, fastMode: true },
      { ...fixedWindow, thinkingMode: true },
      { ...fixedWindow, effort: "low" },
      { ...fixedWindow, mode: "plan" },
      { ...fixedWindow, model: "claude-sonnet-5-5" },
    ] as const satisfies readonly AgentLaunchOptions[])
      expect(JSON.stringify(remoteRunnerLaunchIdentity(changed))).not.toBe(base);
    expect(remoteRunnerLaunchIdentity({ ...codex, effort: "high" })).not.toEqual(
      remoteRunnerLaunchIdentity(codex),
    );
  });

  it("fails closed on a provider outside the closed launch union", () => {
    const foreign = JSON.parse('{"provider":"other","model":"default","mode":"default"}') as never;
    expect(() => remoteRunnerLaunchIdentity(foreign)).toThrow(TypeError);
    expect(() => remoteRunnerEchoesLaunch(fixedWindow, foreign)).toThrow(TypeError);
  });
});
