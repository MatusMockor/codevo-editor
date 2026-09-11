// @vitest-environment jsdom

import { act, useMemo } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentThreadsSurface } from "../../application/agentThreadPorts";
import type {
  AgentComposerAttachmentDraft,
  AgentComposerTurnAttachments,
} from "../../application/useAgentComposerAttachments";
import { defaultAgentLaunchOptions } from "../../domain/agentLaunch";
import type { AgentProjectDescriptor } from "../../domain/agentProject";
import { agentProjectGroups } from "./agentModePresentation";
import { SURFACE_FIXTURE_ROOT } from "./agentSurfaceTestFixtures";
import {
  composerAttachmentsSurfaceFixture,
  projectFixture,
  threadsSurfaceFixture,
} from "./agentThreadsSurfaceTestFixtures";
import { useAgentComposerState, type AgentComposerState } from "./useAgentComposerState";
import { useAgentThreadNavigation } from "./useAgentThreadNavigation";
import { COMPOSER_REPOSITORY_PREFERENCE_KEY } from "./useAgentComposerRepositoryPreference";

const OWNER = {
  projectRootKey: SURFACE_FIXTURE_ROOT,
  ownerId: "agent-root:app",
  generation: 0,
  workspaceId: "workspace-1",
};

const STAGED_INTENT = {
  kind: "staged",
  attachmentId: "c".repeat(32),
  name: "shot.webp",
  bytes: 2_048,
  mime: "image/webp",
  width: 800,
  height: 600,
} as const;

describe("composer attachment submission", () => {
  let host: HTMLDivElement;
  let root: Root;
  let captured: AgentComposerState | null;

  beforeEach(() => {
    localStorage.removeItem(COMPOSER_REPOSITORY_PREFERENCE_KEY);
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    captured = null;
  });

  afterEach(() => {
    localStorage.removeItem(COMPOSER_REPOSITORY_PREFERENCE_KEY);
    act(() => root.unmount());
    host.remove();
  });

  it("sends an attachment-only turn with its intents and marks the drafts sent", async () => {
    const startThread = vi.fn<AgentThreadsSurface["startThread"]>(async () => ({
      threadId: "agt-new",
    }));
    const markSent = vi.fn();
    const prepareTurn = vi.fn(async (): Promise<AgentComposerTurnAttachments> => ({
      owner: OWNER,
      draftIds: ["draft-image"],
      intents: [STAGED_INTENT],
    }));
    render(
      threadsSurfaceFixture({
        startThread,
        attachments: composerAttachmentsSurfaceFixture({
          drafts: [readyImageDraft()],
          projectRootKey: SURFACE_FIXTURE_ROOT,
          promptLineBytes: 64,
          markSent,
          prepareTurn,
        }),
      }),
    );

    expect(current().composerProps.submitBlocked).toBe(false);
    expect(current().composerProps.promptBytes).toBe(64);

    const launch = defaultAgentLaunchOptions("claudeCode");
    await act(async () => {
      current().composerProps.onSubmit({ launch, dangerousLaunchConfirmed: false });
    });

    expect(prepareTurn).toHaveBeenCalledWith(SURFACE_FIXTURE_ROOT);
    expect(startThread).toHaveBeenCalledWith({
      attachments: [STAGED_INTENT],
      attachmentOwner: OWNER,
      projectRootKey: SURFACE_FIXTURE_ROOT,
      repositoryRoot: SURFACE_FIXTURE_ROOT,
      prompt: "",
      isolation: "in-place",
      unsafeInPlaceConfirmationKey: null,
      launch,
      dangerousLaunchConfirmed: false,
    });
    expect(markSent).toHaveBeenCalledTimes(1);
    expect(markSent).toHaveBeenCalledWith(["draft-image"]);
  });

  it("hides drafts staged for another project and never sends without them", async () => {
    const startThread = vi.fn<AgentThreadsSurface["startThread"]>(async () => ({
      threadId: "agt-new",
    }));
    const markSent = vi.fn();
    const prepareTurn = vi.fn(async () => null);
    render(
      threadsSurfaceFixture({
        startThread,
        attachments: composerAttachmentsSurfaceFixture({
          drafts: [readyImageDraft()],
          projectRootKey: "/some/other/project",
          promptLineBytes: 64,
          markSent,
          prepareTurn,
        }),
      }),
    );

    const props = current().composerProps;
    expect(props.attachmentTargetKey).toBe(SURFACE_FIXTURE_ROOT);
    expect(props.attachments?.drafts).toEqual([]);
    expect(props.promptBytes).toBe(0);
    expect(props.submitBlocked).toBe(true);

    await act(async () => {
      current().composerProps.onSubmit({
        launch: defaultAgentLaunchOptions("claudeCode"),
        dangerousLaunchConfirmed: false,
      });
    });

    expect(prepareTurn).not.toHaveBeenCalled();
    expect(startThread).not.toHaveBeenCalled();
    expect(markSent).not.toHaveBeenCalled();
  });

  it("keeps the attachment entry points while no draft is staged yet", () => {
    render(
      threadsSurfaceFixture({
        attachments: composerAttachmentsSurfaceFixture({ projectRootKey: null }),
      }),
    );

    expect(current().composerProps.attachments).not.toBeNull();
    expect(current().composerProps.attachmentTargetKey).toBe(SURFACE_FIXTURE_ROOT);
  });

  it("refuses the whole turn when the pending attachments cannot be prepared", async () => {
    const startThread = vi.fn<AgentThreadsSurface["startThread"]>(async () => ({
      threadId: "agt-new",
    }));
    const markSent = vi.fn();
    const prepareTurn = vi.fn(async () => null);
    render(
      threadsSurfaceFixture({
        startThread,
        attachments: composerAttachmentsSurfaceFixture({
          drafts: [readyImageDraft()],
          projectRootKey: SURFACE_FIXTURE_ROOT,
          promptLineBytes: 64,
          markSent,
          prepareTurn,
        }),
      }),
    );

    act(() => current().composerProps.onPromptChange("describe this"));
    await act(async () => {
      current().composerProps.onSubmit({
        launch: defaultAgentLaunchOptions("claudeCode"),
        dangerousLaunchConfirmed: false,
      });
    });

    expect(prepareTurn).toHaveBeenCalledWith(SURFACE_FIXTURE_ROOT);
    expect(startThread).not.toHaveBeenCalled();
    expect(markSent).not.toHaveBeenCalled();
    expect(current().composerProps.prompt).toBe("describe this");
  });

  it("counts the attachment lines and the separator against the prompt cap", () => {
    render(
      threadsSurfaceFixture({
        attachments: composerAttachmentsSurfaceFixture({
          drafts: [readyImageDraft()],
          projectRootKey: SURFACE_FIXTURE_ROOT,
          promptLineBytes: 30,
        }),
      }),
    );

    act(() => current().composerProps.onPromptChange("abc"));

    expect(current().composerProps.promptBytes).toBe(35);
  });

  it("blocks Send while a draft is still staging", () => {
    render(
      threadsSurfaceFixture({
        attachments: composerAttachmentsSurfaceFixture({
          drafts: [stagingDraft()],
          projectRootKey: SURFACE_FIXTURE_ROOT,
          staging: true,
          blocked: true,
        }),
      }),
    );

    act(() => current().composerProps.onPromptChange("ship it"));

    expect(current().composerProps.submitBlocked).toBe(true);
  });

  it("keeps Send available when a reference is missing on disk", () => {
    render(
      threadsSurfaceFixture({
        attachments: composerAttachmentsSurfaceFixture({
          drafts: [missingReferenceDraft()],
          projectRootKey: SURFACE_FIXTURE_ROOT,
          promptLineBytes: 40,
        }),
      }),
    );

    expect(current().composerProps.submitBlocked).toBe(false);
  });

  it("leaves the drafts in place when the start is refused", async () => {
    const markSent = vi.fn();
    render(
      threadsSurfaceFixture({
        startThread: async () => null,
        attachments: composerAttachmentsSurfaceFixture({
          drafts: [readyImageDraft()],
          projectRootKey: SURFACE_FIXTURE_ROOT,
          promptLineBytes: 64,
          markSent,
          prepareTurn: async () => ({
            owner: OWNER,
            draftIds: ["draft-image"],
            intents: [STAGED_INTENT],
          }),
        }),
      }),
    );

    await act(async () => {
      current().composerProps.onSubmit({
        launch: defaultAgentLaunchOptions("claudeCode"),
        dangerousLaunchConfirmed: false,
      });
    });

    expect(markSent).not.toHaveBeenCalled();
  });

  it("never prepares a turn when the composer carries no attachment", async () => {
    const prepareTurn = vi.fn(async () => null);
    const startThread = vi.fn<AgentThreadsSurface["startThread"]>(async () => ({
      threadId: "agt-new",
    }));
    render(
      threadsSurfaceFixture({
        startThread,
        attachments: composerAttachmentsSurfaceFixture({ prepareTurn }),
      }),
    );

    act(() => current().composerProps.onPromptChange("plain turn"));
    await act(async () => {
      current().composerProps.onSubmit({
        launch: defaultAgentLaunchOptions("claudeCode"),
        dangerousLaunchConfirmed: false,
      });
    });

    expect(prepareTurn).not.toHaveBeenCalled();
    expect(startThread).toHaveBeenCalledTimes(1);
    expect(startThread.mock.calls[0]?.[0]).not.toHaveProperty("attachments");
  });

  function render(agents: AgentThreadsSurface): void {
    act(() => root.render(<Harness agents={agents} />));
  }

  function current(): AgentComposerState {
    expect(captured).not.toBeNull();
    return captured as AgentComposerState;
  }

  function Harness({ agents }: { readonly agents: AgentThreadsSurface }) {
    const projects: ReadonlyArray<AgentProjectDescriptor> = useMemo(() => [projectFixture()], []);
    const groups = useMemo(
      () => agentProjectGroups(projects, agents.threads, agents.orphanedWorktrees),
      [agents.orphanedWorktrees, agents.threads, projects],
    );
    const navigation = useAgentThreadNavigation({
      agents,
      groups,
      presentationThreads: agents.threads,
      projects,
    });
    captured = useAgentComposerState({
      agents,
      groups,
      projects,
      providerEnabled: { claudeCode: true, codex: true },
      railScope: navigation.composerScope,
      selectedThread: navigation.selectedThread,
      onClearSelectedThread: navigation.clearSelectedThread,
      onThreadStarted: navigation.selectStartedThread,
    });
    return null;
  }
});

function draft(overrides: Partial<AgentComposerAttachmentDraft>): AgentComposerAttachmentDraft {
  return {
    draftId: "draft-1",
    kind: "file",
    state: "ready",
    name: "notes.txt",
    bytes: 1_024,
    mime: null,
    width: null,
    height: null,
    attachmentId: null,
    path: null,
    previewUrl: null,
    failure: null,
    notice: null,
    missing: false,
    promptLineBytesMax: 30,
    ...overrides,
  };
}

function readyImageDraft(): AgentComposerAttachmentDraft {
  return draft({
    draftId: "draft-image",
    kind: "image",
    name: "shot.webp",
    mime: "image/webp",
    width: 800,
    height: 600,
    attachmentId: "c".repeat(32),
    bytes: 2_048,
    promptLineBytesMax: 64,
  });
}

function stagingDraft(): AgentComposerAttachmentDraft {
  return draft({ draftId: "draft-staging", kind: "image", state: "staging", name: "shot.png" });
}

function missingReferenceDraft(): AgentComposerAttachmentDraft {
  return draft({
    draftId: "draft-missing",
    kind: "reference",
    name: "gone.pdf",
    path: "/workspace/app/gone.pdf",
    missing: true,
    notice: "This file is no longer at that path",
  });
}
