import { describe, expect, it } from "vitest";
import {
  LOCAL_AGENT_SURFACE_ACTIVATION,
  agentSurfaceEditorSlot,
  agentSurfaceServes,
  effectiveAgentSurface,
  remoteSurfaceCapabilityOpen,
  servedAgentSurfaces,
  type AgentSurfaceActivation,
} from "./agentSurfaceActivation";

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
  it("opens the slot only for a visible, available, local Files surface", () => {
    expect(agentSurfaceEditorSlot(LOCAL_AGENT_SURFACE_ACTIVATION, "files")).toBe("open");
    expect(agentSurfaceEditorSlot(LOCAL_AGENT_SURFACE_ACTIVATION, "diff")).toBe("none");
    expect(agentSurfaceEditorSlot(LOCAL_AGENT_SURFACE_ACTIVATION, null)).toBe("none");
    expect(
      agentSurfaceEditorSlot({ ...LOCAL_AGENT_SURFACE_ACTIVATION, hidden: true }, "files"),
    ).toBe("none");
    expect(
      agentSurfaceEditorSlot({ ...LOCAL_AGENT_SURFACE_ACTIVATION, unavailable: true }, "files"),
    ).toBe("none");
  });

  it("never opens the slot for a remote pane, with or without a server project", () => {
    expect(agentSurfaceEditorSlot(REMOTE_NO_PROJECT, "files")).toBe("none");
    expect(agentSurfaceEditorSlot(REMOTE_WITH_PROJECT, "files")).toBe("none");
  });
});
