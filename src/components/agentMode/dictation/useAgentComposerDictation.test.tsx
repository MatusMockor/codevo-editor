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
  readonly ownerKey: string;
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
      ownerKey: props.ownerKey,
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
    ownerKey: "draft-a",
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
    control: () => host.querySelector<HTMLElement>(".agent-dictation"),
    field: () => host.querySelector<HTMLTextAreaElement>("textarea"),
    runCommand: async (): Promise<void> => {
      await act(async () => {
        bridge.run("agent.toggleDictation");
        await flushAsync();
      });
    },
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
    reject: async (call: number, message: string) => {
      await act(async () => {
        ipc.calls[call]?.reject(new Error(message));
        await flushAsync();
      });
    },
  };
}

const NO_SERVER_REASON = "Dictation needs a connected server with speech transcription.";
const START_REFUSED_MESSAGE =
  "Dictation did not start because the prompt field was not available. Try again once you can type in it.";
const DISCONNECTED_MESSAGE =
  "The server disconnected during dictation. Audio that was not transcribed yet was discarded.";

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

  it("keeps the microphone visible with the composer's own blocked reason", async () => {
    const reason = "Choose a project in the rail to start a thread.";
    const scene = setup({ blockedReason: reason });

    expect(scene.button()?.disabled).toBe(false);
    expect(scene.button()?.getAttribute("aria-disabled")).toBe("true");
    expect(scene.button()?.getAttribute("title")).toBe(reason);
    expect(scene.description()).toBe(reason);
    expect(scene.button()?.getAttribute("aria-label")).toBe("Dictation unavailable");
    await scene.toggle();

    expect(scene.state()).toBe("idle");
    expect(scene.audio.getUserMedia).not.toHaveBeenCalled();
    expect(scene.notice()).toBe(reason);
  });

  it("explains the composer's blocked reason through the command instead of doing nothing", async () => {
    const reason = "Choose a project in the rail to start a thread.";
    const scene = setup({ blockedReason: reason });

    expect(scene.bridge.dictationAvailable()).toBe(true);
    await scene.runCommand();

    expect(scene.state()).toBe("idle");
    expect(scene.audio.getUserMedia).not.toHaveBeenCalled();
    expect(scene.noticeKind()).toBe("unavailable");
    expect(scene.notice()).toBe(reason);
    expect(scene.button()).not.toBeNull();
  });

  it("renders no microphone while no connected server transcribes speech", () => {
    const scene = setup({ serverIds: [] });

    expect(scene.state()).toBe("unavailable");
    expect(scene.button()).toBeNull();
    expect(scene.control()?.querySelectorAll("button")).toHaveLength(0);
    expect(scene.control()?.classList.contains("agent-dictation--announcer")).toBe(true);
    expect(scene.control()?.children).toHaveLength(1);
    expect(scene.control()?.firstElementChild?.getAttribute("role")).toBe("status");
    expect(scene.status()).toBe("");
    expect(scene.notice()).toBeNull();
  });

  it("renders no microphone with the composer's blocked reason while no server transcribes speech", () => {
    const scene = setup({ serverIds: [], blockedReason: "Choose a project first." });

    expect(scene.button()).toBeNull();
    expect(scene.notice()).toBeNull();
  });

  it("shows the microphone when a speech server connects and removes it on disconnect without touching the prompt", () => {
    const scene = setup({ serverIds: [], initialPrompt: "draft in progress" });
    const field = scene.field();
    const control = scene.control();
    act(() => field?.focus());
    act(() => field?.setSelectionRange(5, 5));

    scene.render({ serverIds: ["server-a"] });

    expect(scene.state()).toBe("idle");
    expect(scene.button()?.getAttribute("aria-label")).toBe("Start dictation");
    expect(scene.button()?.hasAttribute("aria-disabled")).toBe(false);
    expect(scene.control()).toBe(control);
    expect(scene.control()?.classList.contains("agent-dictation--announcer")).toBe(false);
    expect(scene.field()).toBe(field);
    expect(document.activeElement).toBe(field);
    expect(field?.selectionStart).toBe(5);
    expect(scene.prompt()).toBe("draft in progress");
    expect(scene.notice()).toBeNull();
    expect(scene.status()).toBe("");

    scene.render({ serverIds: [] });

    expect(scene.state()).toBe("unavailable");
    expect(scene.button()).toBeNull();
    expect(scene.control()).toBe(control);
    expect(scene.field()).toBe(field);
    expect(document.activeElement).toBe(field);
    expect(scene.prompt()).toBe("draft in progress");
    expect(scene.notice()).toBeNull();
    expect(scene.status()).toBe("");
    expect(scene.audio.getUserMedia).not.toHaveBeenCalled();
  });

  it("starts dictation from a microphone that appeared after the server connected", async () => {
    const scene = setup({ serverIds: [] });
    scene.render({ serverIds: ["server-a"] });

    act(() => scene.button()?.click());
    await act(() => flushAsync());

    expect(scene.state()).toBe("recording");
    expect(scene.button()?.getAttribute("aria-label")).toBe("Stop dictation");
  });

  it("explains through the command why dictation cannot start while the microphone is hidden", async () => {
    const scene = setup({ serverIds: [] });

    expect(scene.bridge.dictationAvailable()).toBe(true);
    await scene.runCommand();

    expect(scene.state()).toBe("unavailable");
    expect(scene.audio.getUserMedia).not.toHaveBeenCalled();
    expect(scene.noticeKind()).toBe("unavailable");
    expect(scene.notice()).toBe(NO_SERVER_REASON);
    expect(scene.status()).toBe(NO_SERVER_REASON);
    expect(scene.button()).toBeNull();

    await scene.runCommand();
    expect(scene.notice()).toBe(NO_SERVER_REASON);

    scene.dismiss();
    expect(scene.notice()).toBeNull();
    expect(scene.status()).toBe("");
    expect(scene.button()).toBeNull();
    expect(scene.bridge.dictationAvailable()).toBe(true);
  });

  it.each([
    ["the composer is not visible", { visible: false }],
    ["the composer is suspended", { suspended: true }],
    ["the prompt field is not mounted", { field: false }],
  ] as const)("keeps the hidden-microphone command quiet while %s", async (_name, overrides) => {
    const scene = setup({ serverIds: [], ...overrides });

    expect(scene.bridge.dictationAvailable()).toBe(false);
    await scene.runCommand();

    expect(scene.notice()).toBeNull();
  });

  it("keeps the hidden-microphone command quiet while the window is hidden", async () => {
    const scene = setup({ serverIds: [] });
    scene.setWindowVisibility("hidden");

    expect(scene.bridge.dictationAvailable()).toBe(false);
    await scene.runCommand();
    expect(scene.notice()).toBeNull();

    scene.setWindowVisibility("visible");
    expect(scene.bridge.dictationAvailable()).toBe(true);
  });

  it("drops the explanation once dictation becomes available and does not bring it back", async () => {
    const scene = setup({ serverIds: [] });
    await scene.runCommand();
    expect(scene.notice()).not.toBeNull();

    scene.render({ serverIds: ["server-a"] });
    expect(scene.notice()).toBeNull();
    expect(scene.button()?.hasAttribute("aria-disabled")).toBe(false);
    expect(scene.button()?.hasAttribute("aria-describedby")).toBe(false);

    scene.render({ serverIds: [] });
    expect(scene.notice()).toBeNull();
    expect(scene.button()).toBeNull();
  });

  it("keeps the control and says the server disconnected when it drops mid-recording", async () => {
    const scene = setup();
    await scene.toggle();
    scene.utter();
    expect(scene.state()).toBe("recording");
    const button = scene.button();
    act(() => button?.focus());

    scene.render({ serverIds: [] });

    expect(scene.state()).toBe("unavailable");
    expect(scene.audio.microphoneLive()).toBe(false);
    expect(scene.button()).toBe(button);
    expect(document.activeElement).toBe(button);
    expect(scene.button()?.getAttribute("aria-label")).toBe("Dictation unavailable");
    expect(scene.button()?.getAttribute("aria-disabled")).toBe("true");
    expect(scene.button()?.getAttribute("aria-pressed")).toBe("false");
    expect(scene.description()).toBe(NO_SERVER_REASON);
    expect(scene.control()?.querySelector("[data-dictation-meter]")).toBeNull();
    expect(scene.noticeKind()).toBe("failed");
    expect(scene.notice()).toBe(DISCONNECTED_MESSAGE);
    expect(scene.status()).toBe(DISCONNECTED_MESSAGE);
    expect(scene.dictation()?.submitBlockedReason).toBeNull();

    await scene.resolve(0, "late words");
    expect(scene.prompt()).toBe("");
    expect(scene.notice()).toBe(DISCONNECTED_MESSAGE);

    scene.render();
    expect(scene.notice()).toBe(DISCONNECTED_MESSAGE);
    expect(scene.button()).toBe(button);

    scene.dismiss();
    expect(scene.notice()).toBeNull();
    expect(scene.status()).toBe("");
    expect(scene.button()).toBeNull();
  });

  it("says the server disconnected when it drops while the microphone is starting", async () => {
    const scene = setup();
    act(() => scene.dictation()?.toggle());
    expect(scene.state()).toBe("starting");

    scene.render({ serverIds: [] });
    await act(() => flushAsync());

    expect(scene.state()).toBe("unavailable");
    expect(scene.audio.microphoneLive()).toBe(false);
    expect(scene.button()?.getAttribute("aria-label")).toBe("Dictation unavailable");
    expect(scene.notice()).toBe(DISCONNECTED_MESSAGE);
  });

  it("says the server disconnected when it drops while a transcript is pending", async () => {
    const scene = setup();
    await scene.toggle();
    scene.utter();
    await scene.toggle();
    expect(scene.state()).toBe("finishing");

    scene.render({ serverIds: [] });

    expect(scene.state()).toBe("unavailable");
    expect(scene.button()?.getAttribute("aria-label")).toBe("Dictation unavailable");
    expect(scene.button()?.disabled).toBe(false);
    expect(scene.notice()).toBe(DISCONNECTED_MESSAGE);
    await scene.resolve(0, "late words");
    expect(scene.prompt()).toBe("");
  });

  it("answers a click on the retained control with the reason and dismisses both messages at once", async () => {
    const scene = setup();
    await scene.toggle();
    scene.utter();
    scene.render({ serverIds: [] });
    expect(scene.notice()).toBe(DISCONNECTED_MESSAGE);

    act(() => scene.button()?.click());
    expect(scene.noticeKind()).toBe("unavailable");
    expect(scene.notice()).toBe(NO_SERVER_REASON);
    expect(scene.audio.getUserMedia).toHaveBeenCalledTimes(1);

    scene.dismiss();
    expect(scene.notice()).toBeNull();
    expect(scene.button()).toBeNull();
  });

  it("keeps the disconnect message after the server reconnects until dictation starts again", async () => {
    const scene = setup();
    await scene.toggle();
    scene.utter();
    scene.render({ serverIds: [] });

    scene.render({ serverIds: ["server-a"] });

    expect(scene.state()).toBe("idle");
    expect(scene.button()?.getAttribute("aria-label")).toBe("Start dictation");
    expect(scene.notice()).toBe(DISCONNECTED_MESSAGE);

    await scene.toggle();

    expect(scene.state()).toBe("recording");
    expect(scene.notice()).toBeNull();

    scene.render({ serverIds: ["server-b"] });
    expect(scene.state()).toBe("failed");
    expect(scene.notice()).toBe(DISCONNECTED_MESSAGE);
    scene.dismiss();
    expect(scene.state()).toBe("idle");
    expect(scene.notice()).toBeNull();
    expect(scene.button()).not.toBeNull();
  });

  it("keeps a failure message visible when the server disconnects before it is dismissed", async () => {
    const failure = "Transcription failed. Audio that was not transcribed yet was discarded.";
    const scene = setup();
    await scene.toggle();
    scene.utter();
    await scene.reject(0, "Runner speech transcription failed: speech_unavailable (HTTP 503).");
    expect(scene.state()).toBe("failed");
    expect(scene.notice()).toBe(failure);

    scene.render({ serverIds: [] });

    expect(scene.state()).toBe("unavailable");
    expect(scene.noticeKind()).toBe("failed");
    expect(scene.notice()).toBe(failure);
    expect(scene.button()?.getAttribute("aria-label")).toBe("Dictation unavailable");

    scene.dismiss();
    expect(scene.notice()).toBeNull();
    expect(scene.button()).toBeNull();
  });

  it("removes the microphone silently when the server disconnects while dictation is idle", async () => {
    const scene = setup();
    await scene.toggle();
    scene.utter();
    await scene.toggle();
    await scene.resolve(0, "all heard");
    expect(scene.state()).toBe("idle");

    scene.render({ serverIds: [] });

    expect(scene.button()).toBeNull();
    expect(scene.notice()).toBeNull();
    expect(scene.prompt()).toBe("all heard");
  });

  it("does not carry a disconnect message into another draft", async () => {
    const scene = setup();
    await scene.toggle();
    scene.utter();
    expect(scene.state()).toBe("recording");

    scene.render({ ownerKey: "draft-b", serverIds: [] });

    expect(scene.state()).toBe("unavailable");
    expect(scene.audio.microphoneLive()).toBe(false);
    expect(scene.notice()).toBeNull();
    expect(scene.button()).toBeNull();
  });

  it("drops a retained disconnect message when the composer moves to another draft", async () => {
    const scene = setup();
    await scene.toggle();
    scene.utter();
    scene.render({ serverIds: [] });
    expect(scene.notice()).toBe(DISCONNECTED_MESSAGE);

    scene.render({ ownerKey: "draft-b" });

    expect(scene.notice()).toBeNull();
    expect(scene.button()).toBeNull();

    scene.render({ ownerKey: "draft-a" });
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

  it("explains a click that cannot start because the prompt field is not available", async () => {
    const scene = setup();
    act(() => scene.field()?.setAttribute("inert", ""));

    act(() => scene.button()?.click());
    await act(() => flushAsync());

    expect(scene.state()).toBe("idle");
    expect(scene.audio.getUserMedia).not.toHaveBeenCalled();
    expect(scene.noticeKind()).toBe("unavailable");
    expect(scene.notice()).toBe(START_REFUSED_MESSAGE);
    expect(scene.status()).toBe(START_REFUSED_MESSAGE);
    expect(scene.button()?.getAttribute("aria-label")).toBe("Start dictation");
    expect(scene.button()?.hasAttribute("aria-disabled")).toBe(false);

    scene.dismiss();
    expect(scene.notice()).toBeNull();
    expect(scene.status()).toBe("");
    expect(scene.state()).toBe("idle");
  });

  it.each([
    ["hidden", (field: HTMLElement) => field.setAttribute("hidden", "")],
    [
      "inside an inert region",
      (field: HTMLElement) => field.parentElement?.setAttribute("inert", ""),
    ],
  ] as const)("explains a click while the prompt field is %s", (_name, disable) => {
    const scene = setup();
    const field = scene.field();
    expect(field).not.toBeNull();
    act(() => disable(field ?? document.createElement("textarea")));

    act(() => scene.button()?.click());

    expect(scene.state()).toBe("idle");
    expect(scene.notice()).toBe(START_REFUSED_MESSAGE);
  });

  it("explains a click when no prompt field is mounted", () => {
    const scene = setup({ field: false });

    act(() => scene.button()?.click());

    expect(scene.state()).toBe("idle");
    expect(scene.audio.getUserMedia).not.toHaveBeenCalled();
    expect(scene.notice()).toBe(START_REFUSED_MESSAGE);
  });

  it("drops the refused-start message when dictation starts from the same button", async () => {
    const scene = setup();
    act(() => scene.field()?.setAttribute("inert", ""));
    act(() => scene.button()?.click());
    expect(scene.notice()).toBe(START_REFUSED_MESSAGE);

    act(() => scene.field()?.removeAttribute("inert"));
    act(() => scene.button()?.click());
    await act(() => flushAsync());

    expect(scene.state()).toBe("recording");
    expect(scene.notice()).toBeNull();

    scene.utter();
    await scene.toggle();
    await scene.resolve(0, "heard");
    expect(scene.state()).toBe("idle");
    expect(scene.notice()).toBeNull();
  });

  it("does not carry a refused-start message into another draft or a blocked composer", () => {
    const scene = setup();
    act(() => scene.field()?.setAttribute("inert", ""));
    act(() => scene.button()?.click());
    expect(scene.notice()).toBe(START_REFUSED_MESSAGE);

    scene.render({ ownerKey: "draft-b" });
    expect(scene.notice()).toBeNull();
    scene.render({ ownerKey: "draft-a" });
    expect(scene.notice()).toBeNull();

    act(() => scene.button()?.click());
    expect(scene.notice()).toBe(START_REFUSED_MESSAGE);
    scene.render({ blockedReason: "Choose a project first." });
    expect(scene.notice()).toBeNull();
    scene.render({ blockedReason: null });
    expect(scene.notice()).toBeNull();
  });

  it("drops a refused-start message when the composer is suspended", () => {
    const scene = setup();
    act(() => scene.field()?.setAttribute("inert", ""));
    act(() => scene.button()?.click());
    expect(scene.notice()).toBe(START_REFUSED_MESSAGE);

    scene.render({ suspended: true });
    expect(scene.notice()).toBeNull();
    scene.render({ suspended: false });
    expect(scene.notice()).toBeNull();
  });

  it("answers a refused retry over a failure message without swallowing the failure", async () => {
    const failure = "Transcription failed. Audio that was not transcribed yet was discarded.";
    const scene = setup();
    await scene.toggle();
    scene.utter();
    await scene.reject(0, "Runner speech transcription failed: speech_unavailable (HTTP 503).");
    expect(scene.notice()).toBe(failure);
    act(() => scene.field()?.setAttribute("inert", ""));

    act(() => scene.button()?.click());
    expect(scene.state()).toBe("failed");
    expect(scene.notice()).toBe(START_REFUSED_MESSAGE);

    scene.dismiss();
    expect(scene.state()).toBe("failed");
    expect(scene.notice()).toBe(failure);

    scene.dismiss();
    expect(scene.state()).toBe("idle");
    expect(scene.notice()).toBeNull();
  });

  it("keeps the command quiet when the prompt field is not available", async () => {
    const scene = setup();
    act(() => scene.field()?.setAttribute("inert", ""));

    expect(scene.bridge.dictationAvailable()).toBe(false);
    await scene.runCommand();

    expect(scene.state()).toBe("idle");
    expect(scene.notice()).toBeNull();
    expect(scene.audio.getUserMedia).not.toHaveBeenCalled();
  });

  it("stays quiet when a start is refused because the window is hidden", async () => {
    const scene = setup();
    scene.setWindowVisibility("hidden");

    await scene.toggle();
    act(() => scene.button()?.click());

    expect(scene.state()).toBe("idle");
    expect(scene.notice()).toBeNull();
    expect(scene.audio.getUserMedia).not.toHaveBeenCalled();

    scene.setWindowVisibility("visible");
    expect(scene.notice()).toBeNull();
  });

  it("still stops a live session from the button while the prompt field is not available", async () => {
    const scene = setup();
    await scene.toggle();
    scene.utter();
    expect(scene.state()).toBe("recording");
    act(() => scene.field()?.setAttribute("inert", ""));

    act(() => scene.button()?.click());

    expect(scene.state()).toBe("finishing");
    expect(scene.notice()).toBeNull();
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
