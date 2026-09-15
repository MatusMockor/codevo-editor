// @vitest-environment jsdom

import { act, useMemo } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { AgentComposer } from "./AgentComposer";
import { useAgentComposerState } from "./useAgentComposerState";
import { agentProjectGroups } from "./agentModePresentation";
import {
  composerAttachmentsSurfaceFixture,
  projectFixture,
  threadsSurfaceFixture,
} from "./agentThreadsSurfaceTestFixtures";

it("switches providers on an unsent draft without changing text or staged attachments", () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  const agents = threadsSurfaceFixture({
    agentCliKind: "codex",
    attachments: composerAttachmentsSurfaceFixture({
      drafts: [
        {
          draftId: "shot",
          kind: "image",
          state: "ready",
          name: "screenshot.png",
          bytes: 1024,
          mime: "image/png",
          width: 100,
          height: 100,
          attachmentId: "shot",
          path: null,
          previewUrl: null,
          failure: null,
          notice: null,
          missing: false,
          promptLineBytesMax: 40,
        },
      ],
    }),
  });
  const projects = [projectFixture()];
  const enabled = { claudeCode: true, codex: true };
  let state: ReturnType<typeof useAgentComposerState> | undefined;
  function Harness() {
    const groups = useMemo(() => agentProjectGroups(projects, [], []), []);
    state = useAgentComposerState({
      agents,
      projects,
      groups,
      selectedThread: null,
      railScope: null,
      providerEnabled: enabled,
      onClearSelectedThread: vi.fn(),
      onThreadStarted: vi.fn(),
    });
    return (
      <AgentComposer
        {...state.composerProps}
        providerEnabled={enabled}
        onOpenProviderSettings={vi.fn()}
      />
    );
  }
  const click = (selector: string) => {
    const button = host.querySelector<HTMLElement>(selector);
    if (button === null) throw new Error(`Missing ${selector}`);
    act(() => button.click());
  };
  try {
    act(() => root.render(<Harness />));
    act(() => state?.composerProps.onPromptChange("Keep my detailed draft\nwith another line"));
    const attachments = state?.composerProps.attachments;
    expect(attachments?.drafts).toHaveLength(1);
    click('[aria-label="Agent model"]');
    click('[data-provider="claudeCode"]');
    click('[role="option"][data-value="claude-sonnet-5"]');
    expect(state?.composerProps.launchProvider).toBe("claudeCode");
    expect(host.querySelector("textarea")?.value).toBe("Keep my detailed draft\nwith another line");
    expect(state?.composerProps.attachments).toBe(attachments);
    click('[aria-label="Agent model"]');
    click('[data-provider="codex"]');
    click('[role="option"][data-value="gpt-5.5"]');
    expect(state?.composerProps.launchProvider).toBe("codex");
    expect(state?.composerProps.prompt).toBe("Keep my detailed draft\nwith another line");
    expect(state?.composerProps.attachments).toBe(attachments);
  } finally {
    act(() => root.unmount());
    host.remove();
  }
});
