// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { AgentRailProjectCollapsePreferencePort } from "../../application/agentRailProjectCollapsePreferencePort";
import {
  useAgentRailProjectDisclosure,
  type AgentRailProjectDisclosure,
} from "./useAgentRailProjectDisclosure";

const APP = "/workspace/app";
const API = "/workspace/api";

class MemoryCollapsePreference implements AgentRailProjectCollapsePreferencePort {
  readonly saved: Array<ReadonlyArray<string>> = [];
  constructor(private stored: ReadonlyArray<string> = []) {}

  load(): ReadonlyArray<string> {
    return this.stored;
  }

  save(collapsed: ReadonlyArray<string>): void {
    this.stored = collapsed;
    this.saved.push(collapsed);
  }
}

describe("useAgentRailProjectDisclosure", () => {
  let host: HTMLDivElement;
  let root: Root;
  let latest: AgentRailProjectDisclosure | null;

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

  function Probe({
    preference,
  }: {
    readonly preference: AgentRailProjectCollapsePreferencePort | null;
  }) {
    latest = useAgentRailProjectDisclosure(preference);
    return null;
  }

  function render(preference: AgentRailProjectCollapsePreferencePort | null): void {
    act(() => root.render(<Probe preference={preference} />));
  }

  function disclosure(): AgentRailProjectDisclosure {
    expect(latest).not.toBeNull();
    return latest as AgentRailProjectDisclosure;
  }

  it("loads the stored collapsed projects and saves only real changes", () => {
    const preference = new MemoryCollapsePreference([APP]);
    render(preference);
    expect([...disclosure().state.collapsed]).toEqual([APP]);
    expect(preference.saved).toEqual([]);

    act(() => disclosure().expand(API));
    expect(preference.saved).toEqual([]);

    act(() => disclosure().toggleCollapsed(API));
    expect([...disclosure().state.collapsed]).toEqual([APP, API]);
    act(() => disclosure().toggleCollapsed(APP));
    expect(preference.saved).toEqual([[APP, API], [API]]);
  });

  it("keeps Show more per project for the session only", () => {
    const preference = new MemoryCollapsePreference();
    render(preference);

    act(() => disclosure().toggleShowingAll(APP));
    expect([...disclosure().state.showingAll]).toEqual([APP]);
    act(() => disclosure().toggleShowingAll(APP));
    expect([...disclosure().state.showingAll]).toEqual([]);
    expect(preference.saved).toEqual([]);
  });

  it("expands a collapsed project on request and keeps the stored order of the rest", () => {
    const preference = new MemoryCollapsePreference([APP, API]);
    render(preference);

    act(() => disclosure().expand(APP));

    expect([...disclosure().state.collapsed]).toEqual([API]);
    expect(preference.saved).toEqual([[API]]);
  });

  it("works without a preference", () => {
    render(null);
    act(() => disclosure().toggleCollapsed(APP));
    expect([...disclosure().state.collapsed]).toEqual([APP]);
  });
});
