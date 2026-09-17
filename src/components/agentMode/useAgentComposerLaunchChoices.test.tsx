// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { useAgentComposerLaunchChoices } from "./useAgentComposerLaunchChoices";
import { resolveComposerLaunch, type LaunchScope } from "./agentComposerLaunch";
import type { AgentLaunchOptions } from "../../domain/agentLaunch";

const codex: AgentLaunchOptions = {
  provider: "codex",
  model: "gpt-5.6-sol",
  mode: "dangerFullAccess",
};
const claude: AgentLaunchOptions = {
  provider: "claudeCode",
  model: "opus",
  mode: "bypassPermissions",
  effort: "high",
};

describe("composer model choices across execution environments", () => {
  let root: Root;
  let host: HTMLDivElement;
  let current: ReturnType<typeof useAgentComposerLaunchChoices>;
  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    host = document.createElement("div");
    root = createRoot(host);
  });
  afterEach(() => act(() => root.unmount()));
  function Harness({
    scope,
    displayedDefault = null,
  }: {
    scope: LaunchScope;
    displayedDefault?: AgentLaunchOptions | null;
  }) {
    current = useAgentComposerLaunchChoices(scope, displayedDefault);
    return null;
  }
  function render(rootKey: string, thread = false) {
    const scope = { rootKey, key: `${thread ? "thread" : "root"}:${rootKey}`, seed: null };
    act(() => root.render(<Harness scope={scope} />));
    return scope;
  }
  it("carries the displayed persisted/default Claude launch to a server without requiring a new model click", () => {
    const localScope = { rootKey: "/local", key: "root:/local", seed: null };
    act(() => root.render(<Harness scope={localScope} displayedDefault={claude} />));
    expect(current.choice).toBeNull();
    act(() =>
      root.render(<Harness scope={localScope} displayedDefault={{ ...claude, model: "sonnet" }} />),
    );
    expect(current.choice).toBeNull();
    const serverScope = {
      rootKey: "remote:a:runner:project",
      key: "root:remote:a:runner:project",
      seed: null,
    };
    act(() => root.render(<Harness scope={serverScope} displayedDefault={codex} />));
    expect(current.choice?.launch).toEqual({ ...claude, model: "sonnet" });
  });
  it("carries the draft model onto an unvisited server and restores explicit A/B choices", () => {
    render("/local");
    act(() => current.change(codex));
    render("remote:a:runner:project");
    expect(current.choice?.launch).toEqual(codex);
    act(() => current.change(claude));
    render("remote:b:runner:project");
    expect(current.choice?.launch).toEqual(claude);
    act(() => current.change(codex));
    render("remote:a:runner:project");
    expect(current.choice?.launch).toEqual(claude);
    render("remote:b:runner:project");
    expect(current.choice?.launch).toEqual(codex);
    render("/local");
    expect(current.choice?.launch).toEqual(codex);
  });
  it("retains a visited inherited selection when another server changes its model", () => {
    render("/local");
    act(() => current.change(codex));
    render("remote:a:runner:project");
    expect(current.choice?.launch).toEqual(codex);
    render("remote:b:runner:project");
    act(() => current.change(claude));
    render("remote:a:runner:project");
    expect(current.choice?.launch).toEqual(codex);
    render("remote:b:runner:project");
    expect(current.choice?.launch).toEqual(claude);
  });
  it("does not inherit choices across projects on the same environment or across threads", () => {
    render("/local");
    act(() => current.change(codex));
    render("/other");
    expect(current.choice).toBeNull();
    render("conversation-a", true);
    expect(current.choice).toBeNull();
    act(() => current.change(claude));
    render("conversation-b", true);
    expect(current.choice).toBeNull();
    render("remote:a:runner:project");
    expect(current.choice?.launch).toEqual(codex);
    render("conversation-a", true);
    expect(current.choice?.launch).toEqual(claude);
  });
  it("keeps explicit model choice while a disabled provider uses its safe fallback", () => {
    render("/local");
    act(() => current.change(codex));
    const scope = render("remote:a:runner:project");
    expect(resolveComposerLaunch(current.choice, scope, "claudeCode", () => null).provider).toBe(
      "claudeCode",
    );
    expect(resolveComposerLaunch(current.choice, scope, "codex", () => null)).toEqual(codex);
  });
  it("bounds retained choices and evicts oldest scope without transferring thread models", () => {
    for (let index = 0; index < 65; index += 1) {
      render(`conversation-${index}`, true);
      act(() => current.change(codex));
    }
    render("conversation-0", true);
    expect(current.choice).toBeNull();
    render("conversation-1", true);
    expect(current.choice?.launch).toEqual(codex);
  });
});
