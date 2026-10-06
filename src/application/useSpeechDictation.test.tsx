// @vitest-environment jsdom
import { StrictMode, act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { TauriRemoteRunnerGateway } from "../infrastructure/tauriRemoteRunnerGateway";
import {
  controlledInvoke,
  dictationTestPorts,
  flushAsync,
  installFakeBrowserAudio,
  silence,
  tone,
  type FakeBrowserAudio,
} from "../test/speechDictationTestSupport";
import type { SpeechDictationMeter } from "./speechDictationMeterStore";
import type { SpeechDictationPorts } from "./speechDictationPorts";
import {
  useSpeechDictation,
  useSpeechDictationMeter,
  type SpeechDictationController,
  type UseSpeechDictationOptions,
} from "./useSpeechDictation";

const cleanup: (() => void)[] = [];
afterEach(() => {
  cleanup.splice(0).forEach((dispose) => dispose());
});

function createPorts(
  invoke: ConstructorParameters<typeof TauriRemoteRunnerGateway>[0],
): SpeechDictationPorts {
  return dictationTestPorts(new TauriRemoteRunnerGateway(invoke));
}

function setup(overrides: { audio?: boolean; strict?: boolean } = {}) {
  const audio: FakeBrowserAudio | null =
    overrides.audio === false ? null : installFakeBrowserAudio({ sampleRate: 16000 });
  const ipc = controlledInvoke();
  const transcripts: string[] = [];
  let options: UseSpeechDictationOptions = {
    ownerId: "draft-a",
    serverIds: ["server-a"],
    language: "sk",
    ports: createPorts(ipc.invoke),
    onTranscript: (text) => transcripts.push(text),
  };
  let controller!: SpeechDictationController;
  let meter: SpeechDictationMeter | null = null;
  const renders = { host: 0, meter: 0 };
  const committed: string[] = [];
  function MeterProbe(props: { readonly controller: SpeechDictationController }) {
    renders.meter += 1;
    meter = useSpeechDictationMeter(props.controller.meter);
    return null;
  }
  function Host() {
    renders.host += 1;
    controller = useSpeechDictation(options);
    committed.push(controller.state.kind);
    return createElement(MeterProbe, { controller });
  }
  const root: Root = createRoot(document.createElement("div"));
  const tree = () =>
    overrides.strict ? createElement(StrictMode, null, createElement(Host)) : createElement(Host);
  const render = (next: Partial<UseSpeechDictationOptions> = {}) => {
    options = { ...options, ...next };
    act(() => root.render(tree()));
  };
  let mounted = true;
  const unmount = () => {
    if (!mounted) return;
    mounted = false;
    act(() => root.unmount());
  };
  cleanup.push(() => {
    unmount();
    audio?.restore();
  });
  render();
  const record = async () => {
    await act(async () => {
      controller.start();
      await flushAsync();
    });
  };
  const emit = (samples: Float32Array) => act(() => audio?.emit(samples));
  const utter = () => emit(Float32Array.from([...tone(2, 16000), ...silence(0.7, 16000)]));
  const settle = () => act(() => flushAsync());
  return {
    audio,
    ipc,
    transcripts,
    renders,
    committed,
    render,
    unmount,
    record,
    emit,
    utter,
    settle,
    controller: () => controller,
    meter: () => meter,
    createPorts: () => createPorts(ipc.invoke),
  };
}

describe("useSpeechDictation", () => {
  it("reports why dictation is unavailable", () => {
    const unsupported = setup({ audio: false });
    expect(unsupported.controller().state).toEqual({
      kind: "unavailable",
      reason: "capture-unsupported",
    });
    const offline = setup();
    offline.render({ serverIds: [] });
    expect(offline.controller().state).toEqual({
      kind: "unavailable",
      reason: "no-speech-server",
    });
    offline.render({ serverIds: ["server-a"] });
    expect(offline.controller().state).toEqual({ kind: "idle" });
  });
  it("is idle from the first render when a server is selected", () => {
    const { committed, controller } = setup();
    expect(committed).toEqual(["idle"]);
    expect(controller().state).toEqual({ kind: "idle" });
  });
  it("records and inserts the transcript for the current draft", async () => {
    const { audio, ipc, transcripts, controller, record, utter, settle } = setup();
    expect(controller().state).toEqual({ kind: "idle" });
    await record();
    expect(controller().state).toEqual({ kind: "recording" });
    utter();
    act(() => controller().stop());
    expect(controller().state).toEqual({ kind: "finishing", outcome: "completed" });
    expect(audio?.microphoneLive()).toBe(false);
    await act(async () => {
      ipc.calls[0]?.resolve({ text: " Ahoj " });
      await flushAsync();
    });
    await settle();
    expect(transcripts).toEqual(["Ahoj"]);
    expect(controller().state).toEqual({ kind: "idle" });
  });
  it("works under StrictMode double effects", async () => {
    const { audio, ipc, transcripts, controller, record, utter } = setup({ strict: true });
    await record();
    expect(controller().state).toEqual({ kind: "recording" });
    expect(audio?.getUserMedia).toHaveBeenCalledTimes(1);
    utter();
    await act(async () => {
      ipc.calls[0]?.resolve({ text: "strict" });
      await flushAsync();
    });
    expect(transcripts).toEqual(["strict"]);
  });
  it("drops in-flight work across draft A to B to A", async () => {
    const { audio, ipc, transcripts, controller, render, record, utter } = setup();
    const foreign: string[] = [];
    const original = (text: string) => transcripts.push(text);
    await record();
    utter();
    render({ ownerId: "draft-b", onTranscript: (text) => foreign.push(text) });
    expect(controller().state).toEqual({ kind: "idle" });
    expect(audio?.microphoneLive()).toBe(false);
    render({ ownerId: "draft-a", onTranscript: original });
    await act(async () => {
      ipc.calls[0]?.resolve({ text: "first visit" });
      await flushAsync();
    });
    expect(transcripts).toEqual([]);
    expect(foreign).toEqual([]);
    expect(controller().state).toEqual({ kind: "idle" });
  });
  it("keeps the session on its server when another server becomes preferred", async () => {
    const { audio, ipc, transcripts, controller, render, record, utter } = setup();
    await record();
    utter();
    render({ serverIds: ["server-b", "server-a"] });
    expect(controller().state).toEqual({ kind: "recording" });
    expect(audio?.microphoneLive()).toBe(true);
    await act(async () => {
      ipc.calls[0]?.resolve({ text: "same server" });
      await flushAsync();
    });
    expect(ipc.calls[0]?.request.serverId).toBe("server-a");
    expect(transcripts).toEqual(["same server"]);
  });
  it("does not rebind for an equal server list with a new identity", async () => {
    const { audio, controller, render, renders, record } = setup();
    await record();
    const actions = controller();
    render({ serverIds: ["server-a"] });
    const settled = renders.host;
    render({ serverIds: ["server-a"] });
    expect(renders.host).toBe(settled + 1);
    expect(controller()).toBe(actions);
    expect(audio?.microphoneLive()).toBe(true);
  });
  it("fails the session when its server is no longer available", async () => {
    const { audio, ipc, transcripts, controller, render, record, utter } = setup();
    await record();
    utter();
    render({ serverIds: ["server-b"] });
    expect(controller().state).toEqual({ kind: "failed", reason: "server-disconnected" });
    expect(audio?.microphoneLive()).toBe(false);
    await act(async () => {
      ipc.calls[0]?.resolve({ text: "old server" });
      await flushAsync();
    });
    expect(transcripts).toEqual([]);
    act(() => controller().cancel());
    expect(controller().state).toEqual({ kind: "idle" });
  });
  it("releases the microphone and drops late results on unmount", async () => {
    const { audio, ipc, transcripts, record, utter, unmount } = setup();
    await record();
    utter();
    expect(audio?.microphoneLive()).toBe(true);
    unmount();
    expect(audio?.microphoneLive()).toBe(false);
    ipc.calls[0]?.resolve({ text: "after unmount" });
    await flushAsync();
    expect(transcripts).toEqual([]);
    expect(ipc.calls.length).toBe(1);
  });
  it("releases the microphone when the ports are replaced", async () => {
    const { audio, controller, createPorts, render, record } = setup();
    await record();
    render({ ports: createPorts() });
    expect(audio?.microphoneLive()).toBe(false);
    expect(controller().state).toEqual({ kind: "idle" });
  });
  it("delivers to the latest callback without restarting the session", async () => {
    const { audio, ipc, transcripts, render, record, utter } = setup();
    const latest: string[] = [];
    await record();
    utter();
    render({ onTranscript: (text) => latest.push(text) });
    expect(audio?.microphoneLive()).toBe(true);
    await act(async () => {
      ipc.calls[0]?.resolve({ text: "text" });
      await flushAsync();
    });
    expect(latest).toEqual(["text"]);
    expect(transcripts).toEqual([]);
  });
  it("updates the meter subscriber without rerendering the composer per frame", async () => {
    const { controller, meter, renders, record, emit } = setup();
    await record();
    const hostRenders = renders.host;
    const meterRenders = renders.meter;
    const actions = controller();
    emit(tone(1, 16000));
    expect(meter()?.elapsedMs).toBe(1000);
    expect(meter()?.level).toBeGreaterThan(0.15);
    expect(renders.meter).toBeGreaterThan(meterRenders);
    expect(renders.host).toBe(hostRenders);
    expect(controller()).toBe(actions);
    act(() => controller().cancel());
    expect(meter()).toEqual({ level: 0, elapsedMs: 0 });
  });
});
