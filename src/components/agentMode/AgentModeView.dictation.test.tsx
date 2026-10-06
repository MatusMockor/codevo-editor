// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { agentComposerDraftStore } from "../../application/agentComposerDrafts";
import { unconfiguredAgentProviderManagement } from "../../test/agentProviderManagementFixture";
import { waitForReact } from "../../test/reactTestLifecycle";
import {
  controlledInvoke,
  dictationTestPorts,
  flushAsync,
  installFakeBrowserAudio,
  type ControlledInvoke,
  type FakeBrowserAudio,
} from "../../test/speechDictationTestSupport";
import { RemoteRunnerProvider } from "../remoteRunner/RemoteRunnerProvider";
import { AgentModeView } from "./AgentModeView";
import { SURFACE_FIXTURE_ROOT } from "./agentSurfaceTestFixtures";
import { projectFixture, threadsSurfaceFixture } from "./agentThreadsSurfaceTestFixtures";
import { chromeFixture } from "./agentWorkbenchChromeTestFixtures";
import { dictationUtterance } from "./dictation/agentComposerDictationTestSupport";
import {
  dictationRemoteGateway,
  type DictationServerFixture,
} from "./dictation/dictationRemoteGatewayTestSupport";

const PROVIDERS_ENABLED = { claudeCode: true, codex: true } as const;
const NO_OVERFLOW_ROOTS: readonly string[] = [];

function noop(): void {
  return undefined;
}

describe("agent workbench dictation wiring", () => {
  let host: HTMLDivElement;
  let root: Root;
  let audio: FakeBrowserAudio;
  let showComposer: (visible: boolean) => void = noop;

  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    audio = installFakeBrowserAudio({ sampleRate: 16000 });
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    audio.restore();
    agentComposerDraftStore.reset();
  });

  async function mount(
    servers: readonly DictationServerFixture[],
    options: Readonly<{ ports?: boolean; language?: "sk" | "en" | "cs" }> = {},
  ): Promise<ControlledInvoke> {
    const speech = controlledInvoke();
    const gateway = dictationRemoteGateway(servers, speech);
    const ports = dictationTestPorts(gateway);
    const agents = {
      ...threadsSurfaceFixture(),
      providerManagement: unconfiguredAgentProviderManagement(),
    };
    const chrome = chromeFixture();
    const projects = [projectFixture()];
    const view = (composerVisible: boolean | undefined) => (
      <RemoteRunnerProvider
        gateway={gateway}
        speechDictation={options.ports === false ? null : ports}
      >
        <AgentModeView
          agents={agents}
          chrome={chrome}
          composerVisible={composerVisible}
          dictationLanguage={options.language}
          onReleaseProject={noop}
          onTrustProject={noop}
          overflowRootPaths={NO_OVERFLOW_ROOTS}
          projects={projects}
          providerEnabled={PROVIDERS_ENABLED}
          workspaceRoot={SURFACE_FIXTURE_ROOT}
        />
      </RemoteRunnerProvider>
    );
    showComposer = (visible) => act(() => root.render(view(visible)));
    await act(async () => root.render(view(undefined)));
    return speech;
  }

  const microphone = (): HTMLButtonElement | null =>
    host.querySelector<HTMLButtonElement>(".agent-dictation__button");
  const prompt = (): HTMLTextAreaElement | null =>
    host.querySelector<HTMLTextAreaElement>("#agent-prompt");

  it("enables dictation through the first connected server that advertises speech transcription", async () => {
    const speech = await mount(
      [
        { id: "plain", connected: true, speechTranscription: undefined },
        { id: "offline", connected: false, speechTranscription: true },
        { id: "speech", connected: true, speechTranscription: true },
      ],
      { language: "cs" },
    );

    await waitForReact(() =>
      expect(microphone()?.getAttribute("aria-label")).toBe("Start dictation"),
    );
    expect(microphone()?.hasAttribute("aria-disabled")).toBe(false);

    act(() => microphone()?.click());
    await act(() => flushAsync());
    act(() => audio.emit(dictationUtterance()));
    act(() => microphone()?.click());

    expect(speech.calls).toHaveLength(1);
    expect(speech.calls[0]?.command).toBe("remote_runner_transcribe_speech");
    expect(speech.calls[0]?.request.serverId).toBe("speech");
    expect(speech.calls[0]?.request.language).toBe("cs");

    await act(async () => {
      speech.calls[0]?.resolve({ text: "Diktovaný text" });
      await flushAsync();
    });
    expect(prompt()?.value).toBe("Diktovaný text");
  });

  it.each([
    ["no server is configured", []],
    [
      "the runner does not advertise speech",
      [{ id: "a", connected: true, speechTranscription: undefined }],
    ],
    ["the runner declines speech", [{ id: "a", connected: true, speechTranscription: false }]],
    [
      "the speech server is disconnected",
      [{ id: "a", connected: false, speechTranscription: true }],
    ],
  ] as const)("keeps dictation unavailable with the reason when %s", async (_name, servers) => {
    await mount(servers);
    await act(() => flushAsync(40));

    expect(microphone()?.disabled).toBe(false);
    expect(microphone()?.getAttribute("aria-disabled")).toBe("true");
    expect(microphone()?.getAttribute("title")).toBe(
      "Dictation needs a connected server with speech transcription.",
    );
    act(() => microphone()?.click());
    expect(audio.getUserMedia).not.toHaveBeenCalled();
    expect(host.querySelector('[data-dictation-notice="unavailable"] span')?.textContent).toBe(
      "Dictation needs a connected server with speech transcription.",
    );
  });

  it("stops recording when the composer is hidden and still inserts what was heard", async () => {
    const speech = await mount([{ id: "speech", connected: true, speechTranscription: true }]);
    await waitForReact(() =>
      expect(microphone()?.getAttribute("aria-label")).toBe("Start dictation"),
    );
    act(() => microphone()?.click());
    await act(() => flushAsync());
    act(() => audio.emit(dictationUtterance()));
    expect(audio.microphoneLive()).toBe(true);

    showComposer(false);

    expect(audio.microphoneLive()).toBe(false);
    expect(speech.calls).toHaveLength(1);
    await act(async () => {
      speech.calls[0]?.resolve({ text: "said before leaving" });
      await flushAsync();
    });
    expect(prompt()?.value).toBe("said before leaving");

    act(() => microphone()?.click());
    await act(() => flushAsync());
    expect(audio.getUserMedia).toHaveBeenCalledTimes(1);

    showComposer(true);
    act(() => microphone()?.click());
    await act(() => flushAsync());
    expect(audio.getUserMedia).toHaveBeenCalledTimes(2);
    expect(audio.microphoneLive()).toBe(true);
  });

  it("renders no microphone when the composition root provides no dictation ports", async () => {
    await mount([{ id: "speech", connected: true, speechTranscription: true }], { ports: false });
    await act(() => flushAsync(40));

    expect(prompt()).not.toBeNull();
    expect(microphone()).toBeNull();
  });
});
