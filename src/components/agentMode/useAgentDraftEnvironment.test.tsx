// @vitest-environment jsdom

import { act } from "react";
import { afterEach, describe, expect, it } from "vitest";
import type { AgentProjectGroupingSettings } from "../../domain/agentProjectGrouping";
import {
  RUN_ON_LINKED_ROOT,
  RUN_ON_LOCAL_ROOT,
  RUN_ON_OTHER_LOCAL_ROOT,
  RUN_ON_SECOND_ROOT,
  RUN_ON_SECOND_SERVER,
  RUN_ON_SERVER,
  RUN_ON_UNLINKED_ROOT,
  setupRunOnDraft,
  type RunOnDraftHarness,
} from "./agentRunOnDraftTestSupport";
import { fixtureRepository, projectFixture } from "./agentThreadsSurfaceTestFixtures";

const IDENTITY = "github.com/acme/app";
const SEPARATE: AgentProjectGroupingSettings = { mode: "separate", overrides: new Map() };
const PROMPT = "Fix the login flow";

function target(h: RunOnDraftHarness): string | null {
  return h.current().composer.target?.projectRootKey ?? null;
}

function railProjects(h: RunOnDraftHarness): ReadonlyArray<string> {
  return h.current().navigation.scopeEntries.map((entry) => entry.projectRootKey);
}

describe("new-thread draft environment for projects displayed separately", () => {
  let harness: RunOnDraftHarness | null = null;

  afterEach(() => {
    harness?.unmount();
    harness = null;
  });

  async function drafted(
    identified: ReadonlyArray<string>,
    extra: Parameters<typeof setupRunOnDraft>[0] = {},
  ) {
    const h = (harness = await setupRunOnDraft({
      grouping: SEPARATE,
      repositoryIdentities: new Map(identified.map((rootKey) => [rootKey, IDENTITY])),
      ...extra,
    }));
    await h.type(PROMPT);
    expect(target(h)).toBe(RUN_ON_LOCAL_ROOT);
    return h;
  }

  it("moves the draft to the server checkout of its repository and back to the local project", async () => {
    const h = await drafted([RUN_ON_LOCAL_ROOT, RUN_ON_LINKED_ROOT]);
    expect(railProjects(h)).toEqual([RUN_ON_LOCAL_ROOT, RUN_ON_LINKED_ROOT, RUN_ON_UNLINKED_ROOT]);

    await h.runOn(RUN_ON_SERVER.id);

    expect(target(h)).toBe(RUN_ON_LINKED_ROOT);
    expect(h.props().prompt).toBe(PROMPT);
    expect(h.props().submitBlocked).toBe(false);
    expect(h.drafts.snapshot()).toEqual([[`new:${RUN_ON_LINKED_ROOT}`, PROMPT]]);

    await h.runOn(null);

    expect(target(h)).toBe(RUN_ON_LOCAL_ROOT);
    expect(h.props().prompt).toBe(PROMPT);
    expect(h.drafts.snapshot()).toEqual([[`new:${RUN_ON_LOCAL_ROOT}`, PROMPT]]);
  });

  it("leaves the draft without a target on a server that has no checkout of its repository", async () => {
    const h = await drafted([RUN_ON_LOCAL_ROOT]);

    await h.runOn(RUN_ON_SERVER.id);

    expect(target(h)).toBeNull();
    expect(h.props().prompt).toBe(PROMPT);
    expect(h.props().submitBlocked).toBe(true);

    await h.runOn(null);

    expect(target(h)).toBe(RUN_ON_LOCAL_ROOT);
    expect(h.drafts.snapshot()).toEqual([[`new:${RUN_ON_LOCAL_ROOT}`, PROMPT]]);
  });

  it("refuses to choose between two checkouts of the repository on one server", async () => {
    const h = await drafted([RUN_ON_LOCAL_ROOT, RUN_ON_LINKED_ROOT, RUN_ON_UNLINKED_ROOT]);

    await h.runOn(RUN_ON_SERVER.id);

    expect(target(h)).toBeNull();
    expect(h.props().submitBlocked).toBe(true);
  });

  it("leaves a checkout to the local project it is explicitly connected to", async () => {
    const connected = projectFixture({
      rootKey: RUN_ON_OTHER_LOCAL_ROOT,
      rootPath: RUN_ON_OTHER_LOCAL_ROOT,
      ownerId: "agent-root:other",
      label: "other",
      origin: "background-tab",
      repositories: [fixtureRepository(RUN_ON_OTHER_LOCAL_ROOT, "")],
    });
    const h = await drafted([RUN_ON_LOCAL_ROOT, RUN_ON_LINKED_ROOT], {
      localProjects: [projectFixture(), connected],
      links: new Map([[RUN_ON_LINKED_ROOT, RUN_ON_OTHER_LOCAL_ROOT]]),
    });

    await h.runOn(RUN_ON_SERVER.id);

    expect(target(h)).toBeNull();
    expect(h.props().submitBlocked).toBe(true);

    await act(async () => {
      expect(h.current().navigation.setProjectScope(RUN_ON_OTHER_LOCAL_ROOT)).toBe(true);
      h.current().composer.clearDraftTarget();
    });

    expect(target(h)).toBe(RUN_ON_LINKED_ROOT);
  });

  it("uses only the selected server's checkout when two servers are connected", async () => {
    const h = await drafted([RUN_ON_LOCAL_ROOT, RUN_ON_SECOND_ROOT], {
      servers: [RUN_ON_SERVER, RUN_ON_SECOND_SERVER],
      remoteProjects: {
        [RUN_ON_SERVER.id]: ["project", "other"],
        [RUN_ON_SECOND_SERVER.id]: ["project"],
      },
    });

    await h.runOn(RUN_ON_SERVER.id);
    expect(target(h)).toBeNull();

    await h.runOn(RUN_ON_SECOND_SERVER.id);
    expect(target(h)).toBe(RUN_ON_SECOND_ROOT);
    expect(h.drafts.snapshot()).toEqual([[`new:${RUN_ON_SECOND_ROOT}`, PROMPT]]);
  });

  it("moves a draft started in the server project to the local checkout of its repository", async () => {
    const h = await drafted([RUN_ON_LOCAL_ROOT, RUN_ON_LINKED_ROOT]);
    await act(async () => {
      expect(h.current().navigation.setProjectScope(RUN_ON_LINKED_ROOT)).toBe(true);
      h.current().selectServer(RUN_ON_SERVER.id);
      h.current().composer.clearDraftTarget();
    });
    expect(target(h)).toBe(RUN_ON_LINKED_ROOT);

    await h.runOn(null);

    expect(target(h)).toBe(RUN_ON_LOCAL_ROOT);

    await h.runOn(RUN_ON_SERVER.id);

    expect(target(h)).toBe(RUN_ON_LINKED_ROOT);
  });
});
