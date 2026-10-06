import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { expect, vi } from "vitest";
import type { AgentViewCommandBridge } from "../../../application/agentViewCommandBridge";
import { agentComposerDraftStore } from "../../../application/agentComposerDrafts";
import type { SpeechDictationPorts } from "../../../application/speechDictationPorts";
import { TauriRemoteRunnerGateway } from "../../../infrastructure/tauriRemoteRunnerGateway";
import {
  controlledInvoke,
  dictationTestPorts,
  flushAsync,
  installFakeBrowserAudio,
  silence,
  tone,
  type ControlledInvoke,
  type FakeBrowserAudio,
  type FakeBrowserAudioOptions,
} from "../../../test/speechDictationTestSupport";
import type { AgentComposerControllerProps } from "../AgentComposerController";
import {
  DictationComposerTestScene,
  type DictationComposerScene,
} from "./AgentComposerDictationTestScene";

export type { DictationComposerScene } from "./AgentComposerDictationTestScene";

const SAMPLE_RATE = 16000;

export interface DictationComposerOptions extends Partial<DictationComposerScene> {
  readonly audio?: FakeBrowserAudioOptions | false;
  readonly commands?: AgentViewCommandBridge | null;
}

export interface DictationComposerHarness {
  readonly host: HTMLDivElement;
  readonly audio: FakeBrowserAudio | null;
  readonly ipc: ControlledInvoke;
  readonly submit: ReturnType<typeof vi.fn<AgentComposerControllerProps["submit"]>>;
  readonly onStop: ReturnType<typeof vi.fn<() => void>>;
  composerRenders(): number;
  render(next?: Partial<DictationComposerScene>): void;
  prompt(): HTMLTextAreaElement;
  microphone(): HTMLButtonElement | null;
  button(label: string): HTMLButtonElement | null;
  outsideButton(): HTMLButtonElement;
  outsideInput(): HTMLInputElement;
  state(): string | null;
  status(): string;
  notice(): string | null;
  noticeKind(): string | null;
  microphoneDescription(): string | null;
  meterText(): string | null;
  type(text: string): void;
  setCaret(start: number, end?: number): void;
  clickMicrophone(): void;
  record(): Promise<void>;
  emit(samples: Float32Array): void;
  utter(): void;
  settle(): Promise<void>;
  resolve(call: number, text: string): Promise<void>;
  reject(call: number, message: string): Promise<void>;
  press(target: EventTarget, key: string, init?: KeyboardEventInit): KeyboardEvent;
}

const disposers: (() => void)[] = [];

export function createDictationTestPorts(ipc: ControlledInvoke): SpeechDictationPorts {
  return dictationTestPorts(new TauriRemoteRunnerGateway(ipc.invoke));
}

export function dictationUtterance(): Float32Array {
  return Float32Array.from([...tone(2, SAMPLE_RATE), ...silence(0.7, SAMPLE_RATE)]);
}

export function disposeDictationComposers(): void {
  disposers.splice(0).forEach((dispose) => dispose());
  agentComposerDraftStore.reset();
}

export function mountDictationComposer(
  options: DictationComposerOptions = {},
): DictationComposerHarness {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  agentComposerDraftStore.reset();
  const audio =
    options.audio === false
      ? null
      : installFakeBrowserAudio({ sampleRate: SAMPLE_RATE, ...options.audio });
  const ipc = controlledInvoke();
  const ports = createDictationTestPorts(ipc);
  const submit = vi.fn<AgentComposerControllerProps["submit"]>(async () => true);
  const onStop = vi.fn<() => void>();
  const renders = { composer: 0 };
  const renderDrawerEnd = (): ReactNode => {
    renders.composer += 1;
    return null;
  };
  const host = document.createElement("div");
  document.body.append(host);
  const root: Root = createRoot(host);
  let scene: DictationComposerScene = {
    draftKey: options.draftKey ?? "thread-a",
    serverIds: options.serverIds ?? ["server-a"],
    visible: options.visible ?? true,
    language: "language" in options ? options.language : "sk",
    locale: options.locale ?? "en-US",
    mode: options.mode ?? { kind: "followUp", blockedReason: null },
    running: options.running ?? false,
    provided: options.provided ?? true,
  };
  const render = (next: Partial<DictationComposerScene> = {}): void => {
    scene = { ...scene, ...next };
    act(() =>
      root.render(
        <DictationComposerTestScene
          commands={options.commands ?? null}
          onStop={onStop}
          ports={ports}
          renderDrawerEnd={renderDrawerEnd}
          scene={scene}
          submit={submit}
        />,
      ),
    );
  };
  disposers.push(() => {
    act(() => root.unmount());
    host.remove();
    audio?.restore();
  });
  render();

  const query = <T extends Element>(selector: string): T | null => host.querySelector<T>(selector);
  const prompt = (): HTMLTextAreaElement => {
    const field = query<HTMLTextAreaElement>("#agent-prompt");
    expect(field).not.toBeNull();
    return field ?? document.createElement("textarea");
  };
  const microphone = (): HTMLButtonElement | null =>
    query<HTMLButtonElement>(".agent-dictation__button");
  const settle = (): Promise<void> => act(() => flushAsync());
  const clickMicrophone = (): void => {
    const button = microphone();
    expect(button).not.toBeNull();
    if (button === null) return;
    const pointer = { bubbles: true, cancelable: true, button: 0 };
    const mouseDown = new MouseEvent("mousedown", pointer);
    act(() => {
      button.dispatchEvent(mouseDown);
    });
    if (!mouseDown.defaultPrevented) act(() => button.focus());
    act(() => {
      button.dispatchEvent(new MouseEvent("mouseup", pointer));
      button.dispatchEvent(new MouseEvent("click", pointer));
    });
  };
  const emit = (samples: Float32Array): void => act(() => audio?.emit(samples));
  return {
    host,
    audio,
    ipc,
    submit,
    onStop,
    composerRenders: () => renders.composer,
    render,
    prompt,
    microphone,
    button: (label) => query<HTMLButtonElement>(`button[aria-label="${label}"]`),
    outsideButton: () => query<HTMLButtonElement>("[data-outside-button]") ?? orphanButton(),
    outsideInput: () => query<HTMLInputElement>("[data-outside-input]") ?? orphanInput(),
    state: () => query(".agent-dictation")?.getAttribute("data-dictation-state") ?? null,
    status: () => query('.agent-dictation [role="status"]')?.textContent ?? "",
    notice: () => query("[data-dictation-notice] span")?.textContent ?? null,
    noticeKind: () =>
      query("[data-dictation-notice]")?.getAttribute("data-dictation-notice") ?? null,
    microphoneDescription: () => {
      const id = microphone()?.getAttribute("aria-describedby") ?? "";
      return document.getElementById(id)?.textContent ?? null;
    },
    meterText: () => query(".agent-dictation__elapsed")?.textContent ?? null,
    type: (text) => typeInto(prompt(), text),
    setCaret: (start, end = start) => act(() => prompt().setSelectionRange(start, end)),
    clickMicrophone,
    record: async () => {
      clickMicrophone();
      await settle();
    },
    emit,
    utter: () => emit(dictationUtterance()),
    settle,
    resolve: async (call, text) => {
      expect(ipc.calls[call]).toBeDefined();
      await act(async () => {
        ipc.calls[call]?.resolve({ text });
        await flushAsync();
      });
    },
    reject: async (call, message) => {
      expect(ipc.calls[call]).toBeDefined();
      await act(async () => {
        ipc.calls[call]?.reject(new Error(message));
        await flushAsync();
      });
    },
    press: (target, key, init = {}) => {
      const event = new KeyboardEvent("keydown", {
        bubbles: true,
        cancelable: true,
        key,
        ...init,
      });
      act(() => {
        target.dispatchEvent(event);
      });
      return event;
    },
  };
}

function orphanButton(): HTMLButtonElement {
  return document.createElement("button");
}

function orphanInput(): HTMLInputElement {
  return document.createElement("input");
}

function typeInto(field: HTMLTextAreaElement, text: string): void {
  const setValue = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
  expect(setValue).toBeDefined();
  act(() => {
    setValue?.call(field, text);
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
