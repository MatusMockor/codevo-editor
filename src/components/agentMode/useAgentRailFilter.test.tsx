// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { AgentRailFilterPreferencePort } from "../../application/agentRailFilterPreferencePort";
import { remoteAgentProjectKey } from "../../application/remoteAgentProjection";
import type { AgentRailFilter } from "../../domain/agentRailFilter";
import type { AgentRailScopeEntry } from "./agentSidebarPresentation";
import { useAgentRailFilter, type AgentRailFilterState } from "./useAgentRailFilter";

const STORED_REMOTE = remoteAgentProjectKey("linux", "runner", "orders");
const OTHER_ON_LINUX = remoteAgentProjectKey("linux", "runner", "billing");
const OTHER_SERVER = remoteAgentProjectKey("mac", "runner", "orders");

class MemoryPreference implements AgentRailFilterPreferencePort {
  readonly saved: AgentRailFilter[] = [];
  constructor(private stored: AgentRailFilter) {}

  load(): AgentRailFilter {
    return this.stored;
  }

  save(filter: AgentRailFilter): void {
    this.stored = filter;
    this.saved.push(filter);
  }
}

function entry(projectRootKey: string): AgentRailScopeEntry {
  return {
    value: projectRootKey,
    label: projectRootKey,
    projectRootKey,
    repositoryRoot: projectRootKey,
    trust: "trusted",
    origin: "active-tab",
    rootPath: projectRootKey,
    repositoryCount: 1,
  };
}

describe("useAgentRailFilter with a persisted server project", () => {
  let host: HTMLDivElement;
  let root: Root;
  let latest: AgentRailFilterState | null = null;

  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    latest = null;
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  function Probe(props: {
    readonly preference: AgentRailFilterPreferencePort;
    readonly authoritative: ReadonlyArray<string>;
  }) {
    latest = useAgentRailFilter({
      preference: props.preference,
      entries: [entry("/workspace/app")],
      projectsLoaded: true,
      authoritativeRemoteProjectKeys: new Set(props.authoritative),
    });
    return null;
  }

  function render(preference: AgentRailFilterPreferencePort, authoritative: string[]): void {
    act(() => root.render(<Probe authoritative={authoritative} preference={preference} />));
  }

  it("keeps a server project until that server's project list is authoritative", () => {
    const preference = new MemoryPreference({ kind: "project", projectRootKey: STORED_REMOTE });

    render(preference, []);
    render(preference, [OTHER_SERVER]);

    expect(latest?.filter).toEqual({ kind: "all" });
    expect(preference.saved).toEqual([]);

    render(preference, [OTHER_ON_LINUX]);

    expect(preference.saved).toEqual([{ kind: "all" }]);
  });

  it("drops a malformed server key once local projects have loaded", () => {
    const preference = new MemoryPreference({ kind: "project", projectRootKey: "remote:linux" });
    render(preference, [OTHER_ON_LINUX]);
    expect(preference.saved).toEqual([{ kind: "all" }]);
  });
});
