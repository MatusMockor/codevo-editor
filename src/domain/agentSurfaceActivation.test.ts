import { describe, expect, it } from "vitest";
import {
  LOCAL_AGENT_SURFACE_ACTIVATION,
  agentSurfaceEditorSlot,
  agentSurfaceServes,
  effectiveAgentSurface,
  isAgentRemoteSurfaceKind,
  remoteSurfaceCapabilityOpen,
  servedAgentSurfaces,
  withoutEmptyEditorSurface,
  type AgentSurfaceActivation,
} from "./agentSurfaceActivation";
import { AGENT_SURFACE_KINDS, type AgentSurfaceKind } from "./agentWorkbenchLayout";

const REMOTE_NO_PROJECT: AgentSurfaceActivation = {
  remote: true,
  threadPresent: false,
  remoteCapabilities: null,
  unavailable: false,
  hidden: false,
};

const REMOTE_WITH_PROJECT: AgentSurfaceActivation = {
  ...REMOTE_NO_PROJECT,
  remoteCapabilities: { files: true, history: true, terminal: false },
};

describe("remoteSurfaceCapabilityOpen", () => {
  it("fails closed without capabilities and reports the declared ones", () => {
    expect(remoteSurfaceCapabilityOpen(null, "files")).toBe(false);
    expect(
      remoteSurfaceCapabilityOpen({ files: true, history: false, terminal: true }, "files"),
    ).toBe(true);
    expect(
      remoteSurfaceCapabilityOpen({ files: true, history: false, terminal: true }, "history"),
    ).toBe(false);
  });
});

describe("agentSurfaceServes", () => {
  it("serves every surface locally", () => {
    for (const kind of ["files", "diff", "terminal", "history"] as const)
      expect(agentSurfaceServes(LOCAL_AGENT_SURFACE_ACTIVATION, kind)).toBe(true);
  });

  it("serves a remote diff only with a thread and the rest only with capabilities", () => {
    expect(agentSurfaceServes(REMOTE_NO_PROJECT, "diff")).toBe(false);
    expect(agentSurfaceServes({ ...REMOTE_NO_PROJECT, threadPresent: true }, "diff")).toBe(true);
    expect(agentSurfaceServes(REMOTE_NO_PROJECT, "files")).toBe(false);
    expect(agentSurfaceServes(REMOTE_WITH_PROJECT, "files")).toBe(true);
    expect(agentSurfaceServes(REMOTE_WITH_PROJECT, "terminal")).toBe(false);
  });
});

describe("effectiveAgentSurface", () => {
  it("keeps the local selection and demotes an unserved remote selection", () => {
    expect(effectiveAgentSurface(LOCAL_AGENT_SURFACE_ACTIVATION, "files")).toBe("files");
    expect(effectiveAgentSurface(LOCAL_AGENT_SURFACE_ACTIVATION, null)).toBeNull();
    expect(effectiveAgentSurface(REMOTE_NO_PROJECT, "files")).toBeNull();
    expect(effectiveAgentSurface(REMOTE_NO_PROJECT, "diff")).toBeNull();
    expect(effectiveAgentSurface(REMOTE_WITH_PROJECT, "files")).toBe("files");
    expect(effectiveAgentSurface(REMOTE_WITH_PROJECT, "terminal")).toBeNull();
  });
});

describe("servedAgentSurfaces", () => {
  it("returns the local tabs unchanged and drops unserved remote tabs", () => {
    const tabs = ["files", "diff", "terminal", "history"] as const;
    expect(servedAgentSurfaces(LOCAL_AGENT_SURFACE_ACTIVATION, tabs)).toBe(tabs);
    expect(servedAgentSurfaces(REMOTE_NO_PROJECT, tabs)).toEqual([]);
    expect(servedAgentSurfaces(REMOTE_WITH_PROJECT, tabs)).toEqual(["files", "history"]);
  });
});

describe("agentSurfaceEditorSlot", () => {
  it("opens the slot only for a visible, available, local Editor surface", () => {
    expect(agentSurfaceEditorSlot(LOCAL_AGENT_SURFACE_ACTIVATION, "editor")).toBe("open");
    expect(agentSurfaceEditorSlot(LOCAL_AGENT_SURFACE_ACTIVATION, "diff")).toBe("none");
    expect(agentSurfaceEditorSlot(LOCAL_AGENT_SURFACE_ACTIVATION, null)).toBe("none");
    expect(
      agentSurfaceEditorSlot({ ...LOCAL_AGENT_SURFACE_ACTIVATION, hidden: true }, "editor"),
    ).toBe("none");
    expect(
      agentSurfaceEditorSlot({ ...LOCAL_AGENT_SURFACE_ACTIVATION, unavailable: true }, "editor"),
    ).toBe("none");
  });

  it("never opens the slot for a remote pane, with or without a server project", () => {
    expect(agentSurfaceEditorSlot(REMOTE_NO_PROJECT, "editor")).toBe("none");
    expect(agentSurfaceEditorSlot(REMOTE_WITH_PROJECT, "editor")).toBe("none");
  });
});

describe("redesigned surfaces on remote threads", () => {
  const remote: AgentSurfaceActivation = {
    remote: true,
    threadPresent: true,
    remoteCapabilities: { files: true, history: true, terminal: true },
    unavailable: false,
    hidden: false,
  };

  it("serves the agents surface for a remote thread and never without one", () => {
    expect(agentSurfaceServes(remote, "agents")).toBe(true);
    expect(agentSurfaceServes({ ...remote, threadPresent: false }, "agents")).toBe(false);
  });

  it("serves only the remote-capable kinds, diff and agents", () => {
    expect(AGENT_SURFACE_KINDS.filter((kind) => agentSurfaceServes(remote, kind))).toEqual([
      "files",
      "diff",
      "terminal",
      "history",
      "agents",
    ]);
  });

  it("serves every kind locally", () => {
    expect(
      AGENT_SURFACE_KINDS.every((kind) => agentSurfaceServes(LOCAL_AGENT_SURFACE_ACTIVATION, kind)),
    ).toBe(true);
  });

  it("narrows remote kinds", () => {
    expect(isAgentRemoteSurfaceKind("history")).toBe(true);
    expect(isAgentRemoteSurfaceKind("git")).toBe(false);
    expect(isAgentRemoteSurfaceKind(null)).toBe(false);
  });
});

describe("editor surface activation", () => {
  const remoteWithEverything: AgentSurfaceActivation = {
    remote: true,
    threadPresent: true,
    remoteCapabilities: { files: true, history: true, terminal: true },
    unavailable: false,
    hidden: false,
  };

  it("serves the editor only for local threads", () => {
    expect(agentSurfaceServes(LOCAL_AGENT_SURFACE_ACTIVATION, "editor")).toBe(true);
    expect(agentSurfaceServes(remoteWithEverything, "editor")).toBe(false);
  });

  it("opens the editor slot only for the editor kind", () => {
    expect(agentSurfaceEditorSlot(LOCAL_AGENT_SURFACE_ACTIVATION, "editor")).toBe("open");
    expect(agentSurfaceEditorSlot(LOCAL_AGENT_SURFACE_ACTIVATION, "files")).toBe("none");
    expect(agentSurfaceEditorSlot(LOCAL_AGENT_SURFACE_ACTIVATION, null)).toBe("none");
    expect(agentSurfaceEditorSlot(remoteWithEverything, "editor")).toBe("none");
  });
});

describe("withoutEmptyEditorSurface", () => {
  it("keeps the surfaces untouched while the editor has documents or is not open", () => {
    const open: ReadonlyArray<AgentSurfaceKind> = ["files", "editor", "diff"];
    const kept = withoutEmptyEditorSurface(open, "editor", true);
    const noEditor = withoutEmptyEditorSurface(["files"], "files", false);

    expect(kept.openSurfaces).toBe(open);
    expect(kept.activeSurface).toBe("editor");
    expect(noEditor).toEqual({ openSurfaces: ["files"], activeSurface: "files" });
  });

  it("drops an empty editor and falls back to the next surface, then the previous one", () => {
    expect(withoutEmptyEditorSurface(["files", "editor", "diff"], "editor", false)).toEqual({
      openSurfaces: ["files", "diff"],
      activeSurface: "diff",
    });
    expect(withoutEmptyEditorSurface(["files", "editor"], "editor", false)).toEqual({
      openSurfaces: ["files"],
      activeSurface: "files",
    });
    expect(withoutEmptyEditorSurface(["editor"], "editor", false)).toEqual({
      openSurfaces: [],
      activeSurface: null,
    });
    expect(withoutEmptyEditorSurface(["editor", "git"], "git", false)).toEqual({
      openSurfaces: ["git"],
      activeSurface: "git",
    });
  });
});
