// @vitest-environment jsdom

import { act } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { createAgentComposerDraftStore } from "../../application/agentComposerDrafts";
import { AGENT_ATTACHMENTS_DISCARDED_NOTICE } from "../../application/agentTurnAttachments";
import { AGENT_ATTACHMENT_PATH_REFUSAL } from "../../domain/agentAttachmentIntake";
import {
  pastedImage,
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
import { surfaceThreadView } from "./agentSurfaceTestFixtures";
import {
  FIXTURE_NESTED_ROOT,
  fixtureRepository,
  projectFixture,
} from "./agentThreadsSurfaceTestFixtures";

const LINKED = new Map([[RUN_ON_LINKED_ROOT, RUN_ON_LOCAL_ROOT]]);
const LOCAL_KEY = `new:${RUN_ON_LOCAL_ROOT}`;
const LINKED_KEY = `new:${RUN_ON_LINKED_ROOT}`;
const UNLINKED_KEY = `new:${RUN_ON_UNLINKED_ROOT}`;

function otherLocalProject() {
  return projectFixture({
    rootKey: RUN_ON_OTHER_LOCAL_ROOT,
    rootPath: RUN_ON_OTHER_LOCAL_ROOT,
    ownerId: "agent-root:other",
    label: "other",
    origin: "background-tab",
    repositories: [fixtureRepository(RUN_ON_OTHER_LOCAL_ROOT, "")],
  });
}

function chooseProject(h: RunOnDraftHarness, projectRootKey: string): Promise<void> {
  return act(async () => {
    h.current().navigation.setRailScope({ projectRootKey, repositoryRoot: projectRootKey });
    h.current().composer.startNewThread(projectRootKey, projectRootKey);
  });
}

function switchProject(
  h: RunOnDraftHarness,
  projectRootKey: string,
  serverId: string | null,
): Promise<void> {
  return act(async () => {
    expect(h.current().navigation.setProjectScope(projectRootKey)).toBe(true);
    h.current().selectServer(serverId);
    h.current().composer.clearDraftTarget();
  });
}

function target(h: RunOnDraftHarness): string | null {
  return h.current().composer.target?.projectRootKey ?? null;
}

function chips(h: RunOnDraftHarness): ReadonlyArray<string> {
  return h.attachmentDrafts().map((draft) => `${draft.name}:${draft.state}`);
}

describe("new-thread draft across a Run on change", () => {
  let harness: RunOnDraftHarness | null = null;

  afterEach(() => {
    harness?.unmount();
    harness = null;
  });

  async function draftedLocally(options: Parameters<typeof setupRunOnDraft>[0] = {}) {
    const h = (harness = await setupRunOnDraft(options));
    await h.type("Fix the login flow");
    await h.attach([pastedImage()]);
    expect(target(h)).toBe(RUN_ON_LOCAL_ROOT);
    expect(chips(h)).toEqual(["shot.png:ready"]);
    return h;
  }

  it("keeps the prompt and the image when Run on moves a linked project to its server", async () => {
    const h = await draftedLocally({ links: LINKED });

    await h.runOn(RUN_ON_SERVER.id);
    await h.settle(() => expect(chips(h)).toEqual(["shot.png:ready"]));

    expect(target(h)).toBe(RUN_ON_LINKED_ROOT);
    expect(h.props().prompt).toBe("Fix the login flow");
    expect(h.props().attachmentTargetKey).toBe(RUN_ON_LINKED_ROOT);
    expect(h.attachmentDrafts()[0]?.previewUrl).not.toBeNull();
    expect(h.props().submitBlocked).toBe(false);
    expect(h.drafts.snapshot()).toEqual([[LINKED_KEY, "Fix the login flow"]]);
    expect(h.local.released).toEqual(h.local.staged);
  });

  it("sends the carried draft from the server it was moved to", async () => {
    const h = await draftedLocally({ links: LINKED });
    await h.runOn(RUN_ON_SERVER.id);
    await h.settle(() => expect(chips(h)).toEqual(["shot.png:ready"]));

    await act(async () => {
      h.props().onSubmit({ launch: h.props().launch, dangerousLaunchConfirmed: false });
    });
    await h.settle(() => expect(h.remote.gateway.startTask).toHaveBeenCalledOnce());

    expect(h.remote.uploaded).toEqual([{ serverId: RUN_ON_SERVER.id, name: "shot.png" }]);
    const uploadedId = h.remote.gateway.uploadAttachment.mock.calls[0]?.[0].attachmentId;
    expect(h.remote.gateway.createTask).toHaveBeenCalledWith(
      expect.objectContaining({
        serverId: RUN_ON_SERVER.id,
        parts: [
          { type: "text", text: "Fix the login flow" },
          { type: "attachment", attachmentId: uploadedId },
        ],
      }),
    );
    expect(h.startLocalThread).not.toHaveBeenCalled();
    expect(h.drafts.snapshot()).toEqual([]);
  });

  it("keeps the draft visible while the server has no matching project and lands it on the chosen one", async () => {
    const h = await draftedLocally();

    await h.runOn(RUN_ON_SERVER.id);

    expect(target(h)).toBeNull();
    expect(h.props().prompt).toBe("Fix the login flow");
    expect(chips(h)).toEqual(["shot.png:ready"]);
    expect(h.props().attachmentTargetKey).toBeNull();
    expect(h.props().submitBlocked).toBe(true);
    expect(h.drafts.snapshot()).toEqual([[LOCAL_KEY, "Fix the login flow"]]);

    await chooseProject(h, RUN_ON_UNLINKED_ROOT);
    await h.settle(() => expect(chips(h)).toEqual(["shot.png:ready"]));

    expect(target(h)).toBe(RUN_ON_UNLINKED_ROOT);
    expect(h.props().prompt).toBe("Fix the login flow");
    expect(h.props().attachmentTargetKey).toBe(RUN_ON_UNLINKED_ROOT);
    expect(h.drafts.snapshot()).toEqual([[UNLINKED_KEY, "Fix the login flow"]]);
    expect(h.local.released).toEqual(h.local.staged);
  });

  it("gives the draft back untouched when the user returns before choosing a server project", async () => {
    const h = await draftedLocally();
    const original = h.attachmentDrafts()[0];

    await h.runOn(RUN_ON_SERVER.id);
    await h.runOn(null);

    expect(target(h)).toBe(RUN_ON_LOCAL_ROOT);
    expect(h.props().prompt).toBe("Fix the login flow");
    expect(h.attachmentDrafts()).toEqual([original]);
    expect(h.local.released).toEqual([]);
    expect(h.drafts.snapshot()).toEqual([[LOCAL_KEY, "Fix the login flow"]]);
  });

  it("returns the same draft when Run on moves back to this computer", async () => {
    const h = await draftedLocally({ links: LINKED });
    await h.runOn(RUN_ON_SERVER.id);
    await h.settle(() => expect(chips(h)).toEqual(["shot.png:ready"]));
    await h.type("Fix the login flow on the server");

    await h.runOn(null);
    await h.settle(() => expect(chips(h)).toEqual(["shot.png:ready"]));

    expect(target(h)).toBe(RUN_ON_LOCAL_ROOT);
    expect(h.props().prompt).toBe("Fix the login flow on the server");
    expect(h.attachmentDrafts()[0]?.previewUrl).not.toBeNull();
    expect(h.drafts.snapshot()).toEqual([[LOCAL_KEY, "Fix the login flow on the server"]]);
  });

  it("neither duplicates nor loses the draft when Run on is switched back and forth", async () => {
    const h = await draftedLocally({ links: LINKED });

    for (const serverId of [RUN_ON_SERVER.id, null, RUN_ON_SERVER.id, null]) {
      await h.runOn(serverId);
      await h.settle(() => expect(chips(h)).toEqual(["shot.png:ready"]));
      expect(h.props().prompt).toBe("Fix the login flow");
      expect(h.drafts.snapshot()).toHaveLength(1);
    }

    await h.runOn(RUN_ON_SERVER.id);
    await h.runOn(null);
    await h.runOn(RUN_ON_SERVER.id);
    await h.settle(() => expect(chips(h)).toEqual(["shot.png:ready"]));
    expect(h.props().prompt).toBe("Fix the login flow");
    expect(h.drafts.snapshot()).toEqual([[LINKED_KEY, "Fix the login flow"]]);
  });

  it("keeps both drafts when the destination already holds a different stored draft", async () => {
    const drafts = createAgentComposerDraftStore();
    drafts.writeDraft(LINKED_KEY, "Older server draft");
    const h = await draftedLocally({ links: LINKED, drafts });

    await h.runOn(RUN_ON_SERVER.id);
    await h.settle(() => expect(chips(h)).toEqual(["shot.png:ready"]));

    expect(h.props().prompt).toBe("Fix the login flow\n\nOlder server draft");
    expect(h.drafts.snapshot()).toEqual([[LINKED_KEY, "Fix the login flow\n\nOlder server draft"]]);
  });

  it("shows the destination's stored draft when the visible draft is empty", async () => {
    const drafts = createAgentComposerDraftStore();
    drafts.writeDraft(LINKED_KEY, "Older server draft");
    const h = (harness = await setupRunOnDraft({ links: LINKED, drafts }));

    await h.runOn(RUN_ON_SERVER.id);

    expect(h.props().prompt).toBe("Older server draft");
    expect(chips(h)).toEqual([]);
  });

  it("carries an attachment that was still being taken in when Run on changed", async () => {
    const h = (harness = await setupRunOnDraft({ links: LINKED }));
    await h.type("Fix the login flow");
    const staging = h.local.holdStaging();
    let intake: Promise<void> = Promise.resolve();
    await act(async () => {
      intake = h.props().attachments?.add(RUN_ON_LOCAL_ROOT, [pastedImage()]) ?? intake;
    });
    await h.settle(() => expect(chips(h)).toEqual(["shot.png:staging"]));

    await h.runOn(RUN_ON_SERVER.id);
    await h.settle(() => expect(chips(h)).toEqual(["shot.png:ready"]));
    await act(async () => {
      staging.release();
      await intake;
    });

    expect(target(h)).toBe(RUN_ON_LINKED_ROOT);
    expect(chips(h)).toEqual(["shot.png:ready"]);
    expect(h.local.released).toEqual(h.local.staged);
    await h.runOn(null);
    await h.settle(() => expect(chips(h)).toEqual(["shot.png:ready"]));
  });

  it("keeps an attachment being taken in while the server still has no target", async () => {
    const h = (harness = await setupRunOnDraft());
    const staging = h.local.holdStaging();
    let intake: Promise<void> = Promise.resolve();
    await act(async () => {
      intake = h.props().attachments?.add(RUN_ON_LOCAL_ROOT, [pastedImage()]) ?? intake;
    });
    await h.settle(() => expect(chips(h)).toEqual(["shot.png:staging"]));

    await h.runOn(RUN_ON_SERVER.id);
    await act(async () => {
      staging.release();
      await intake;
    });
    await h.settle(() => expect(chips(h)).toEqual(["shot.png:ready"]));

    await chooseProject(h, RUN_ON_UNLINKED_ROOT);
    await h.settle(() => expect(chips(h)).toEqual(["shot.png:ready"]));
    expect(target(h)).toBe(RUN_ON_UNLINKED_ROOT);
  });

  it("keeps an attachment the server cannot take visible with its reason and restores it locally", async () => {
    const h = (harness = await setupRunOnDraft({ links: LINKED }));
    await h.attach([{ kind: "path", path: "/Users/dev/spec.pdf" }]);
    expect(h.attachmentDrafts()).toMatchObject([{ kind: "reference", state: "ready" }]);

    await h.runOn(RUN_ON_SERVER.id);
    await h.settle(() => expect(chips(h)).toEqual(["spec.pdf:failed"]));

    expect(h.attachmentDrafts()[0]?.failure).toBe(AGENT_ATTACHMENT_PATH_REFUSAL);
    expect(h.props().submitBlocked).toBe(true);

    await h.runOn(null);
    await h.settle(() => expect(chips(h)).toEqual(["spec.pdf:ready"]));
    expect(h.attachmentDrafts()[0]).toMatchObject({
      kind: "reference",
      path: "/Users/dev/spec.pdf",
    });
  });

  it("holds a server draft when this computer has no matching project and lands it on the chosen one", async () => {
    const h = await draftedLocally();
    await h.runOn(RUN_ON_SERVER.id);
    await chooseProject(h, RUN_ON_UNLINKED_ROOT);
    await h.settle(() => expect(chips(h)).toEqual(["shot.png:ready"]));

    await h.runOn(null);

    expect(target(h)).toBeNull();
    expect(h.props().prompt).toBe("Fix the login flow");
    expect(chips(h)).toEqual(["shot.png:ready"]);
    expect(h.props().attachmentTargetKey).toBeNull();

    await switchProject(h, RUN_ON_LOCAL_ROOT, null);
    await h.settle(() => expect(chips(h)).toEqual(["shot.png:ready"]));

    expect(target(h)).toBe(RUN_ON_LOCAL_ROOT);
    expect(h.props().prompt).toBe("Fix the login flow");
    expect(h.drafts.snapshot()).toEqual([[LOCAL_KEY, "Fix the login flow"]]);
    expect(h.attachmentDrafts()[0]?.previewUrl).not.toBeNull();
  });

  it("still lands the held draft on the chosen project after New thread was pressed", async () => {
    const h = await draftedLocally();
    await h.runOn(RUN_ON_SERVER.id);

    await act(async () => h.current().composer.clearSelection());
    expect(target(h)).toBeNull();
    expect(h.props().prompt).toBe("Fix the login flow");

    await chooseProject(h, RUN_ON_UNLINKED_ROOT);
    await h.settle(() => expect(chips(h)).toEqual(["shot.png:ready"]));
    expect(h.props().prompt).toBe("Fix the login flow");
    expect(h.drafts.snapshot()).toEqual([[UNLINKED_KEY, "Fix the login flow"]]);
  });

  it("does not follow the user to another project that had no target while the draft was held", async () => {
    const h = await draftedLocally({
      localProjects: [projectFixture(), otherLocalProject()],
      links: new Map([[RUN_ON_SECOND_ROOT, RUN_ON_OTHER_LOCAL_ROOT]]),
      servers: [RUN_ON_SERVER, RUN_ON_SECOND_SERVER],
      remoteProjects: { [RUN_ON_SERVER.id]: ["other"], [RUN_ON_SECOND_SERVER.id]: ["project"] },
    });
    await h.runOn(RUN_ON_SERVER.id);
    expect(target(h)).toBeNull();
    expect(h.props().prompt).toBe("Fix the login flow");

    await act(async () => {
      expect(h.current().navigation.setProjectScope(RUN_ON_OTHER_LOCAL_ROOT)).toBe(true);
      h.current().composer.clearDraftTarget();
    });
    expect(h.current().selectedServerId).toBe(RUN_ON_SERVER.id);
    expect(target(h)).toBeNull();

    await h.runOn(RUN_ON_SECOND_SERVER.id);
    expect(target(h)).toBe(RUN_ON_SECOND_ROOT);
    expect(h.props().prompt).toBe("");
    expect(chips(h)).toEqual([]);
    expect(h.local.released).toEqual([]);
    expect(h.drafts.snapshot()).toEqual([[LOCAL_KEY, "Fix the login flow"]]);

    await switchProject(h, RUN_ON_LOCAL_ROOT, null);
    expect(target(h)).toBe(RUN_ON_LOCAL_ROOT);
    expect(h.props().prompt).toBe("Fix the login flow");
    expect(chips(h)).toEqual(["shot.png:ready"]);
    expect(h.attachmentDrafts()[0]?.previewUrl).not.toBeNull();
    expect(h.local.released).toEqual([]);
    expect(h.drafts.snapshot()).toEqual([[LOCAL_KEY, "Fix the login flow"]]);
  });

  it("moves the draft exactly once when effects are replayed in StrictMode", async () => {
    const h = await draftedLocally({ strict: true });

    await h.runOn(RUN_ON_SERVER.id);
    expect(h.props().prompt).toBe("Fix the login flow");
    expect(chips(h)).toEqual(["shot.png:ready"]);
    await chooseProject(h, RUN_ON_UNLINKED_ROOT);
    await h.settle(() => expect(chips(h)).toEqual(["shot.png:ready"]));

    expect(h.props().prompt).toBe("Fix the login flow");
    expect(h.drafts.snapshot()).toEqual([[UNLINKED_KEY, "Fix the login flow"]]);
    expect(h.local.released).toEqual(h.local.staged);
    expect(h.local.staged).toHaveLength(1);
  });

  it("carries the draft between two servers", async () => {
    const h = await draftedLocally({
      links: new Map([
        [RUN_ON_LINKED_ROOT, RUN_ON_LOCAL_ROOT],
        [RUN_ON_SECOND_ROOT, RUN_ON_LOCAL_ROOT],
      ]),
      servers: [RUN_ON_SERVER, RUN_ON_SECOND_SERVER],
      remoteProjects: { [RUN_ON_SERVER.id]: ["project"], [RUN_ON_SECOND_SERVER.id]: ["project"] },
    });
    await h.runOn(RUN_ON_SERVER.id);
    await h.settle(() => expect(chips(h)).toEqual(["shot.png:ready"]));

    await h.runOn(RUN_ON_SECOND_SERVER.id);
    await h.settle(() => expect(chips(h)).toEqual(["shot.png:ready"]));

    expect(target(h)).toBe(RUN_ON_SECOND_ROOT);
    expect(h.props().prompt).toBe("Fix the login flow");
    expect(h.drafts.snapshot()).toEqual([[`new:${RUN_ON_SECOND_ROOT}`, "Fix the login flow"]]);

    await h.runOn(RUN_ON_SERVER.id);
    await h.settle(() => expect(chips(h)).toEqual(["shot.png:ready"]));
    expect(target(h)).toBe(RUN_ON_LINKED_ROOT);
    await h.runOn(RUN_ON_SECOND_SERVER.id);
    expect(target(h)).toBe(RUN_ON_SECOND_ROOT);
    await h.settle(() => expect(chips(h)).toEqual(["shot.png:ready"]));
  });
});

describe("draft isolation around a Run on change", () => {
  let harness: RunOnDraftHarness | null = null;

  afterEach(() => {
    harness?.unmount();
    harness = null;
  });

  it("keeps a thread draft out of the carried new-thread draft and back", async () => {
    const h = (harness = await setupRunOnDraft({ links: LINKED, threads: [surfaceThreadView()] }));
    await h.type("New thread draft");
    await h.attach([pastedImage("new.png")]);

    await act(async () => h.current().navigation.selectThread("agt-1"));
    expect(h.props().prompt).toBe("");
    expect(chips(h)).toEqual([]);
    await h.type("Follow-up draft");
    await h.attach([pastedImage("follow-up.png")]);

    await act(async () => h.current().composer.clearSelection());
    expect(h.props().prompt).toBe("New thread draft");
    expect(chips(h)).toEqual(["new.png:ready"]);

    await h.runOn(RUN_ON_SERVER.id);
    await h.settle(() => expect(chips(h)).toEqual(["new.png:ready"]));
    expect(h.props().prompt).toBe("New thread draft");
    expect(h.drafts.readDraft("agt-1")).toBe("Follow-up draft");

    await act(async () => h.current().navigation.selectThread("agt-1"));
    expect(h.props().prompt).toBe("Follow-up draft");
    expect(chips(h)).toEqual(["follow-up.png:ready"]);
  });

  it("never shows a thread draft in a new-thread composer that has no target", async () => {
    const h = (harness = await setupRunOnDraft({
      localProjects: [projectFixture({ trust: "untrusted" })],
      remoteProjects: {},
      threads: [surfaceThreadView()],
    }));
    await act(async () => h.current().navigation.selectThread("agt-1"));
    await h.type("Follow-up draft");

    await act(async () => h.current().composer.clearSelection());
    expect(target(h)).toBeNull();
    expect(h.props().prompt).toBe("");

    await h.replaceLocalProjects([projectFixture()]);
    expect(target(h)).toBe(RUN_ON_LOCAL_ROOT);
    expect(h.props().prompt).toBe("");
    expect(h.drafts.snapshot()).toEqual([["agt-1", "Follow-up draft"]]);
  });

  it("keeps the draft when only the repository, branch or isolation changes", async () => {
    const h = (harness = await setupRunOnDraft());
    await h.type("Draft for app");
    await h.attach([pastedImage()]);
    const original = h.attachmentDrafts()[0];

    await act(async () => h.props().onSelectRepository(FIXTURE_NESTED_ROOT));
    expect(h.current().composer.target?.repositoryRoot).toBe(FIXTURE_NESTED_ROOT);
    await act(async () => h.props().onIsolationChange("worktree"));
    await act(async () =>
      h.props().onWorktreeBaseChange?.({ kind: "ref", ref: "refs/heads/feature" }),
    );

    expect(h.props().isolation).toBe("worktree");
    expect(h.props().prompt).toBe("Draft for app");
    expect(h.attachmentDrafts()).toEqual([original]);
    expect(h.local.released).toEqual([]);
    expect(h.drafts.snapshot()).toEqual([[LOCAL_KEY, "Draft for app"]]);
  });

  it("keeps a draft per project when the project changes on the same machine", async () => {
    const h = (harness = await setupRunOnDraft({
      localProjects: [projectFixture(), otherLocalProject()],
    }));
    await h.type("Draft for app");
    await h.attach([pastedImage()]);

    await switchProject(h, RUN_ON_OTHER_LOCAL_ROOT, null);
    expect(target(h)).toBe(RUN_ON_OTHER_LOCAL_ROOT);
    expect(h.props().prompt).toBe("");
    expect(chips(h)).toEqual([]);

    await switchProject(h, RUN_ON_LOCAL_ROOT, null);
    expect(h.props().prompt).toBe("Draft for app");
    expect(chips(h)).toEqual(["shot.png:ready"]);
    expect(h.local.released).toEqual([]);
  });

  it("keeps a draft with its project when the user navigates to another machine's project", async () => {
    const h = (harness = await setupRunOnDraft());
    await h.type("Draft for app");
    await h.attach([pastedImage()]);

    await switchProject(h, RUN_ON_UNLINKED_ROOT, RUN_ON_SERVER.id);
    expect(target(h)).toBe(RUN_ON_UNLINKED_ROOT);
    expect(h.props().prompt).toBe("");
    expect(chips(h)).toEqual([]);

    await switchProject(h, RUN_ON_LOCAL_ROOT, null);
    expect(h.props().prompt).toBe("Draft for app");
    expect(chips(h)).toEqual(["shot.png:ready"]);
    expect(h.drafts.snapshot()).toEqual([[LOCAL_KEY, "Draft for app"]]);
  });

  it("does not resurrect a carried draft at the project it left across A to B to A", async () => {
    const h = (harness = await setupRunOnDraft({
      links: LINKED,
      localProjects: [projectFixture(), otherLocalProject()],
    }));
    await h.type("Fix the login flow");
    await h.attach([pastedImage()]);
    await h.runOn(RUN_ON_SERVER.id);
    await h.settle(() => expect(chips(h)).toEqual(["shot.png:ready"]));

    await switchProject(h, RUN_ON_OTHER_LOCAL_ROOT, null);
    expect(h.props().prompt).toBe("");
    expect(chips(h)).toEqual([]);
    await switchProject(h, RUN_ON_LOCAL_ROOT, null);
    expect(target(h)).toBe(RUN_ON_LOCAL_ROOT);
    expect(h.props().prompt).toBe("");
    expect(chips(h)).toEqual([]);

    await h.runOn(RUN_ON_SERVER.id);
    await h.settle(() => expect(chips(h)).toEqual(["shot.png:ready"]));
    expect(h.props().prompt).toBe("Fix the login flow");
  });

  it("discards attachments, not text, when the project owner generation is replaced A to B to A", async () => {
    const h = (harness = await setupRunOnDraft({
      localProjects: [projectFixture(), otherLocalProject()],
    }));
    await h.type("Draft for app");
    await h.attach([pastedImage()]);

    await switchProject(h, RUN_ON_OTHER_LOCAL_ROOT, null);
    await h.replaceLocalProjects([projectFixture({ generation: 1 }), otherLocalProject()]);
    expect(target(h)).toBe(RUN_ON_OTHER_LOCAL_ROOT);
    expect(h.props().prompt).toBe("");
    expect(chips(h)).toEqual([]);

    await switchProject(h, RUN_ON_LOCAL_ROOT, null);
    expect(target(h)).toBe(RUN_ON_LOCAL_ROOT);
    expect(h.props().prompt).toBe("Draft for app");
    expect(chips(h)).toEqual([]);
    expect(h.props().attachments?.refusal).toBe(AGENT_ATTACHMENTS_DISCARDED_NOTICE);
    expect(h.local.released).toEqual(h.local.staged);
  });

  it("discards carried attachments when the server connection authority is replaced", async () => {
    const h = (harness = await setupRunOnDraft({ links: LINKED }));
    await h.attach([pastedImage()]);

    await h.runOn(RUN_ON_SERVER.id);
    await h.settle(() => expect(chips(h)).toEqual(["shot.png:ready"]));
    await h.replaceServers([{ ...RUN_ON_SERVER, host: "replacement" }]);

    expect(chips(h)).toEqual([]);
    expect(h.props().attachments?.refusal).toBe(AGENT_ATTACHMENTS_DISCARDED_NOTICE);
    await h.runOn(null);
    expect(chips(h)).toEqual([]);
  });
});
