import { describe, expect, it } from "vitest";
import {
  agentProjectClosable,
  agentProjectCloseLabel,
  agentProjectMenuEntries,
  agentProjectMenuTarget,
  agentProjectRepositoryCountLabel,
  agentProjectUsable,
  agentRailScopeState,
} from "./agentProjectMenuPresentation";
import type { AgentRailScopeEntry } from "./agentSidebarPresentation";

const ROOT = "/workspace/app";

const trusted: AgentRailScopeEntry = {
  value: ROOT,
  label: "app",
  projectRootKey: ROOT,
  repositoryRoot: ROOT,
  trust: "trusted",
  origin: "active-tab",
  rootPath: ROOT,
  repositoryCount: 1,
  serverPresence: { local: true, remoteServerIds: [] },
};
const untrusted: AgentRailScopeEntry = { ...trusted, trust: "untrusted" };
const closed: AgentRailScopeEntry = { ...trusted, origin: "closed-tab-live-tasks" };
const background: AgentRailScopeEntry = { ...trusted, origin: "background-tab" };
const detached: AgentRailScopeEntry = { ...trusted, rootPath: null };

describe("project menu", () => {
  it("offers Trust project… first for an untrusted local project", () => {
    expect(agentProjectMenuEntries(untrusted)[0]).toEqual({
      id: "trust",
      label: "Trust project…",
      command: "trust",
      disabled: false,
    });
    expect(
      agentProjectMenuEntries({ ...untrusted, rootPath: null }).some((e) => e.command === "trust"),
    ).toBe(false);
    expect(agentProjectMenuEntries(trusted).some((e) => e.command === "trust")).toBe(false);
  });

  it("labels an untrusted project Not trusted", () => {
    expect(agentRailScopeState(untrusted)).toEqual({ label: "Not trusted", action: null });
  });

  it("surfaces trust and origin state with the matching action", () => {
    expect(agentRailScopeState(closed)).toEqual({ label: "Tab closed", action: "release" });
    expect(agentRailScopeState(background)).toEqual({ label: "Background", action: null });
    expect(agentRailScopeState({ ...trusted, trust: "unknown" })).toEqual({
      label: "Opening project…",
      action: null,
    });
    expect(agentRailScopeState(trusted)).toBeNull();
    expect(agentRailScopeState(null)).toBeNull();
  });

  it("offers the project actions that match the project state without a filter entry", () => {
    expect(agentProjectMenuEntries(trusted).map((entry) => entry.label)).toEqual([
      "Close project",
      "Terminal sessions…",
      "Reveal in Finder",
      "Copy path",
    ]);
    expect(agentProjectMenuEntries(closed)[0]?.command).toBe("release");
    expect(agentProjectMenuEntries(detached).map((entry) => entry.command)).toEqual([
      "terminalSessions",
    ]);
    for (const entry of [trusted, untrusted, closed, detached]) {
      expect(agentProjectMenuEntries(entry).map((item) => item.label)).not.toContain(
        "Filter to this project",
      );
    }
  });

  it("marks a project closable only while it owns a live root path", () => {
    expect(agentProjectClosable(trusted)).toBe(true);
    expect(agentProjectClosable(closed)).toBe(false);
    expect(agentProjectClosable(detached)).toBe(false);
    const remoteKey = "remote:linux:runner:app";
    expect(
      agentProjectClosable({ ...trusted, projectRootKey: remoteKey, rootPath: remoteKey }),
    ).toBe(false);
    expect(agentProjectCloseLabel(trusted)).toBe("Close project app");
  });

  it("offers terminal sessions only for a trusted project with a live owner", () => {
    const command = (entry: AgentRailScopeEntry) =>
      agentProjectMenuEntries(entry).find((candidate) => candidate.command === "terminalSessions");

    expect(command(trusted)).toEqual({
      id: "terminal-sessions",
      label: "Terminal sessions…",
      command: "terminalSessions",
      disabled: false,
    });
    expect(command(untrusted)?.disabled).toBe(true);
    expect(command(closed)?.disabled).toBe(true);
    expect(agentProjectMenuTarget(trusted)).toEqual({
      projectRootKey: ROOT,
      repositoryRoot: ROOT,
      rootPath: ROOT,
    });
  });

  it("treats only trusted projects with a live owner as usable", () => {
    expect(agentProjectUsable(trusted)).toBe(true);
    expect(agentProjectUsable(untrusted)).toBe(false);
    expect(agentProjectUsable(closed)).toBe(false);
    expect(agentProjectUsable(null)).toBe(false);
  });

  it("reports the repository count only for a multi-repository project", () => {
    expect(agentProjectRepositoryCountLabel(trusted)).toBeNull();
    expect(agentProjectRepositoryCountLabel({ ...trusted, repositoryCount: 3 })).toBe("3 repos");
  });
});
