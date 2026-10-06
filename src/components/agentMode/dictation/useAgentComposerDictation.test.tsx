// @vitest-environment jsdom

import { act, useRef, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import {
  createAgentViewCommandBridge,
  type AgentViewCommandBridge,
} from "../../../application/agentViewCommandBridge";
import {
  controlledInvoke,
  flushAsync,
  installFakeBrowserAudio,
  restoreDocumentVisibility,
  setDocumentVisibility,
  type FakeBrowserAudio,
} from "../../../test/speechDictationTestSupport";
import { AgentComposerDictationControl } from "./AgentComposerDictationControl";
import { AgentComposerDictationNotice } from "./AgentComposerDictationNotice";
import { AgentDictationProvider } from "./AgentDictationProvider";
import { createDictationTestPorts, dictationUtterance } from "./agentComposerDictationTestSupport";
import {
  useAgentComposerDictation,
  type AgentComposerDictation,
} from "./useAgentComposerDictation";

interface HostProps {
  readonly visible: boolean;
  readonly serverIds: readonly string[];
  readonly suspended: boolean;
  readonly blockedReason: string | null;
  readonly field: boolean;
  readonly initialPrompt: string;
}

const cleanup: (() => void)[] = [];
afterEach(() => {
  cleanup.splice(0).forEach((dispose) => dispose());
  restoreDocumentVisibility();
});

function setup(overrides: Partial<HostProps> = {}) {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const audio: FakeBrowserAudio = installFakeBrowserAudio({ sampleRate: 16000 });
  const ipc = controlledInvoke();
  const ports = createDictationTestPorts(ipc);
  const bridge: AgentViewCommandBridge = createAgentViewCommandBridge();
  bridge.bind({
    surfaceBlocked: () => false,
    newThread: () => undefined,
    previousThread: () => undefined,
    nextThread: () => undefined,
    jumpToThread: () => undefined,
    searchThreads: () => undefined,
    findInThread: () => undefined,
    threadSelected: () => false,
  });
  const host = document.createElement("div");
  document.body.append(host);
  const root: Root = createRoot(host);
  const latest: { dictation: AgentComposerDictation | null; prompt: string } = {
    dictation: null,
    prompt: "",
  };
  function Host(props: HostProps) {
    const [prompt, setPrompt] = useState(props.initialPrompt);
    const textareaRef = useRef<HTMLTextAreaElement>(null);
    const dictation = useAgentComposerDictation({
      ownerKey: "draft-a",
      prompt,
      textareaRef,
      blockedReason: props.blockedReason,
      suspended: props.suspended,
      onPromptChange: setPrompt,
    });
    latest.dictation = dictation;
    latest.prompt = prompt;
    return (
      <>
        {props.field && (
          <textarea
            onChange={(event) => setPrompt(event.target.value)}
            ref={textareaRef}
            value={prompt}
          />
        )}
        <AgentComposerDictationNotice dictation={dictation} />
        <AgentComposerDictationControl dictation={dictation} />
      </>
    );
  }
  let props: HostProps = {
    visible: true,
    serverIds: ["server-a"],
    suspended: false,
    blockedReason: null,
    field: true,
    initialPrompt: "",
    ...overrides,
  };
  const render = (next: Partial<HostProps> = {}): void => {
    props = { ...props, ...next };
    act(() =>
      root.render(
        <AgentDictationProvider
          commands={bridge}
          language="en"
          ports={ports}
          serverIds={props.serverIds}
          visible={props.visible}
        >
          <button data-outside-button="" type="button">
            Outside
          </button>
          <Host {...props} />
        </AgentDictationProvider>,
      ),
    );
  };
  cleanup.push(() => {
    act(() => root.unmount());
    host.remove();
    audio.restore();
  });
  render();
  const toggle = async (): Promise<void> => {
    await act(async () => {
      latest.dictation?.toggle();
      await flushAsync();
    });
  };
  return {
    audio,
    ipc,
    bridge,
    render,
    toggle,
    setHidden: (hidden: boolean) => {
      host.hidden = hidden;
    },
    state: () => latest.dictation?.state.kind ?? null,
    prompt: () => latest.prompt,
    dictation: () => latest.dictation,
    button: () => host.querySelector<HTMLButtonElement>(".agent-dictation__button"),
    notice: () => host.querySelector("[data-dictation-notice] span")?.textContent ?? null,
    noticeKind: () =>
      host.querySelector("[data-dictation-notice]")?.getAttribute("data-dictation-notice") ?? null,
    status: () => host.querySelector('.agent-dictation [role="status"]')?.textContent ?? "",
    description: () => {
      const id = host.querySelector(".agent-dictation__button")?.getAttribute("aria-describedby");
      return id === null || id === undefined ? null : document.getElementById(id)?.textContent;
    },
    dismiss: () =>
      act(() =>
        host
          .querySelector<HTMLButtonElement>('button[aria-label="Dismiss dictation message"]')
          ?.click(),
      ),
    pressEscapeOutside: () => {
      const event = new KeyboardEvent("keydown", {
        bubbles: true,
        cancelable: true,
        key: "Escape",
      });
      act(() => {
        host.querySelector("[data-outside-button]")?.dispatchEvent(event);
      });
      return event;
    },
    setWindowVisibility: (state: DocumentVisibilityState) =>
      act(() => setDocumentVisibility(state)),
    utter: () => act(() => audio.emit(dictationUtterance())),
    resolve: async (call: number, text: string) => {
      await act(async () => {
        ipc.calls[call]?.resolve({ text });
        await flushAsync();
      });
    },
  };
}

describe("useAgentComposerDictation", () => {
  it("stops recording when the composer is suspended and still inserts what was heard", async () => {
    const scene = setup();
    await scene.toggle();
    scene.utter();
    expect(scene.state()).toBe("recording");

    scene.render({ suspended: true });

    expect(scene.state()).toBe("finishing");
    expect(scene.audio.microphoneLive()).toBe(false);
    expect(scene.dictation()?.submitBlockedReason).toBe("Wait for the transcript before sending.");
    await scene.resolve(0, "heard before the question");

    expect(scene.state()).toBe("idle");
    expect(scene.prompt()).toBe("heard before the question");
  });

  it("stops recording when the composer is no longer visible and still inserts what was heard", async () => {
    const scene = setup();
    await scene.toggle();
    scene.utter();
    expect(scene.state()).toBe("recording");

    scene.render({ visible: false });

    expect(scene.state()).toBe("finishing");
    expect(scene.audio.microphoneLive()).toBe(false);
    await scene.resolve(0, "heard before settings opened");

    expect(scene.state()).toBe("idle");
    expect(scene.prompt()).toBe("heard before settings opened");
  });

  it("cancels a starting microphone when the composer is no longer visible", async () => {
    const scene = setup();
    act(() => scene.dictation()?.toggle());
    expect(scene.state()).toBe("starting");

    scene.render({ visible: false });
    await act(() => flushAsync());

    expect(scene.state()).toBe("idle");
    expect(scene.audio.microphoneLive()).toBe(false);
  });

  it("ignores the toggle and the command while the composer is not visible", async () => {
    const scene = setup({ visible: false });

    expect(scene.bridge.dictationAvailable()).toBe(false);
    await scene.toggle();
    scene.bridge.run("agent.toggleDictation");

    expect(scene.state()).toBe("idle");
    expect(scene.audio.getUserMedia).not.toHaveBeenCalled();

    scene.render({ visible: true });
    expect(scene.bridge.dictationAvailable()).toBe(true);
  });

  it("leaves Escape alone while a hidden composer finishes its transcript", async () => {
    const scene = setup();
    await scene.toggle();
    scene.utter();
    scene.render({ visible: false });
    expect(scene.state()).toBe("finishing");

    const event = scene.pressEscapeOutside();

    expect(event.defaultPrevented).toBe(false);
    expect(scene.state()).toBe("finishing");
    await scene.resolve(0, "kept");
    expect(scene.prompt()).toBe("kept");
  });

  it("stops recording when the window is hidden and still inserts what was heard", async () => {
    const scene = setup();
    await scene.toggle();
    scene.utter();

    scene.setWindowVisibility("visible");
    expect(scene.state()).toBe("recording");
    scene.setWindowVisibility("hidden");

    expect(scene.state()).toBe("finishing");
    expect(scene.audio.microphoneLive()).toBe(false);
    await scene.resolve(0, "heard before minimising");

    expect(scene.state()).toBe("idle");
    expect(scene.prompt()).toBe("heard before minimising");
  });

  it("cancels a starting microphone when the window is hidden", async () => {
    const scene = setup();
    act(() => scene.dictation()?.toggle());
    expect(scene.state()).toBe("starting");

    scene.setWindowVisibility("hidden");
    await act(() => flushAsync());

    expect(scene.state()).toBe("idle");
    expect(scene.audio.microphoneLive()).toBe(false);
  });

  it("does not start while the window is hidden", async () => {
    const scene = setup();
    scene.setWindowVisibility("hidden");

    expect(scene.bridge.dictationAvailable()).toBe(false);
    await scene.toggle();
    scene.bridge.run("agent.toggleDictation");

    expect(scene.state()).toBe("idle");
    expect(scene.audio.getUserMedia).not.toHaveBeenCalled();

    scene.setWindowVisibility("visible");
    expect(scene.bridge.dictationAvailable()).toBe(true);
    await scene.toggle();
    expect(scene.state()).toBe("recording");
  });

  it("cancels a starting microphone when the composer is suspended", async () => {
    const scene = setup();
    act(() => scene.dictation()?.toggle());
    expect(scene.state()).toBe("starting");

    scene.render({ suspended: true });
    await act(() => flushAsync());

    expect(scene.state()).toBe("idle");
    expect(scene.audio.microphoneLive()).toBe(false);
  });

  it("ignores the toggle and the command while suspended", async () => {
    const scene = setup({ suspended: true });

    expect(scene.bridge.dictationAvailable()).toBe(false);
    await scene.toggle();
    scene.bridge.run("agent.toggleDictation");

    expect(scene.state()).toBe("idle");
    expect(scene.audio.getUserMedia).not.toHaveBeenCalled();

    scene.render({ suspended: false });
    expect(scene.bridge.dictationAvailable()).toBe(true);
  });

  it("disables the microphone with the composer's own blocked reason", async () => {
    const reason = "Choose a project in the rail to start a thread.";
    const scene = setup({ blockedReason: reason });

    expect(scene.button()?.disabled).toBe(false);
    expect(scene.button()?.getAttribute("aria-disabled")).toBe("true");
    expect(scene.button()?.getAttribute("title")).toBe(reason);
    expect(scene.description()).toBe(reason);
    expect(scene.button()?.getAttribute("aria-label")).toBe("Dictation unavailable");
    expect(scene.bridge.dictationAvailable()).toBe(false);
    await scene.toggle();

    expect(scene.state()).toBe("idle");
    expect(scene.audio.getUserMedia).not.toHaveBeenCalled();
  });

  it("explains an unavailable microphone on activation and lets the message be dismissed", () => {
    const reason = "Dictation needs a connected server with speech transcription.";
    const scene = setup({ serverIds: [] });

    expect(scene.button()?.disabled).toBe(false);
    expect(scene.button()?.getAttribute("aria-disabled")).toBe("true");
    expect(scene.description()).toBe(reason);
    expect(scene.notice()).toBeNull();

    act(() => scene.button()?.focus());
    expect(document.activeElement).toBe(scene.button());
    act(() => scene.button()?.click());

    expect(scene.state()).toBe("unavailable");
    expect(scene.audio.getUserMedia).not.toHaveBeenCalled();
    expect(scene.noticeKind()).toBe("unavailable");
    expect(scene.notice()).toBe(reason);
    expect(scene.status()).toBe(reason);

    scene.dismiss();
    expect(scene.notice()).toBeNull();
    expect(scene.status()).toBe("");
  });

  it("drops the explanation once dictation becomes available and does not bring it back", () => {
    const scene = setup({ serverIds: [] });
    act(() => scene.button()?.click());
    expect(scene.notice()).not.toBeNull();

    scene.render({ serverIds: ["server-a"] });
    expect(scene.notice()).toBeNull();
    expect(scene.button()?.hasAttribute("aria-disabled")).toBe(false);
    expect(scene.button()?.hasAttribute("aria-describedby")).toBe(false);

    scene.render({ serverIds: [] });
    expect(scene.notice()).toBeNull();
  });

  it("dismisses a blocked-reason explanation without cancelling a pending transcript", async () => {
    const scene = setup();
    await scene.toggle();
    scene.utter();
    scene.render({ blockedReason: "Choose a project first." });
    expect(scene.state()).toBe("finishing");

    act(() => scene.button()?.click());
    expect(scene.notice()).toBe("Choose a project first.");
    scene.dismiss();

    expect(scene.notice()).toBeNull();
    expect(scene.state()).toBe("finishing");
    await scene.resolve(0, "still lands");
    expect(scene.prompt()).toBe("still lands");
  });

  it("appends to the draft when the prompt field is gone before the transcript lands", async () => {
    const scene = setup({ initialPrompt: "Existing draft" });
    await scene.toggle();
    scene.utter();
    await scene.toggle();
    expect(scene.state()).toBe("finishing");

    scene.render({ field: false });
    await scene.resolve(0, "plus speech");

    expect(scene.prompt()).toBe("Existing draft plus speech");
  });

  it("does not start without a mounted prompt field", async () => {
    const scene = setup({ field: false });

    expect(scene.bridge.dictationAvailable()).toBe(false);
    await scene.toggle();
    scene.bridge.run("agent.toggleDictation");

    expect(scene.state()).toBe("idle");
    expect(scene.audio.getUserMedia).not.toHaveBeenCalled();
  });

  it("does not start while the composer is hidden but can still stop a live session", async () => {
    const scene = setup();
    scene.setHidden(true);

    expect(scene.bridge.dictationAvailable()).toBe(false);
    await scene.toggle();
    expect(scene.state()).toBe("idle");
    expect(scene.audio.getUserMedia).not.toHaveBeenCalled();

    scene.setHidden(false);
    expect(scene.bridge.dictationAvailable()).toBe(true);
    await scene.toggle();
    scene.utter();
    expect(scene.state()).toBe("recording");

    scene.setHidden(true);
    expect(scene.bridge.dictationAvailable()).toBe(true);
    await act(async () => {
      scene.bridge.run("agent.toggleDictation");
      await flushAsync();
    });

    expect(scene.state()).toBe("finishing");
    expect(scene.audio.microphoneLive()).toBe(false);
  });

  it("keeps the toggle and dismiss identities stable while the state does not change", async () => {
    const scene = setup();
    await scene.toggle();
    const recording = scene.dictation();

    scene.render();
    act(() => scene.audio.emit(dictationUtterance().subarray(0, 4096)));

    expect(scene.dictation()).toBe(recording);
  });
});
