import type { SpeechDictationPorts } from "../application/speechDictationPorts";
import { SpeechInputSelection } from "../application/speechInputSelection";
import { BrowserAudioCapture } from "./browserAudioCapture";
import { BrowserAudioInputDevices } from "./browserAudioInputDevices";
import {
  RemoteRunnerSpeechTranscriber,
  type SpeechTranscriptionGateway,
} from "./remoteRunnerSpeechTranscriber";
import speechCaptureWorkletUrl from "./speechCapture.worklet.ts?worker&url";

export function createSpeechDictationPorts(
  gateway: SpeechTranscriptionGateway,
): SpeechDictationPorts {
  const selection = new SpeechInputSelection();
  const devices = new BrowserAudioInputDevices();
  return {
    capture: new BrowserAudioCapture(speechCaptureWorkletUrl, {
      selected: selection.current,
      opened: devices.refresh,
    }),
    transcriber: new RemoteRunnerSpeechTranscriber(gateway),
    input: { devices, selection },
  };
}
