import type { SpeechDictationPorts } from "../application/speechDictationPorts";
import { BrowserAudioCapture } from "./browserAudioCapture";
import {
  RemoteRunnerSpeechTranscriber,
  type SpeechTranscriptionGateway,
} from "./remoteRunnerSpeechTranscriber";
import speechCaptureWorkletUrl from "./speechCapture.worklet.ts?worker&url";

export function createSpeechDictationPorts(
  gateway: SpeechTranscriptionGateway,
): SpeechDictationPorts {
  return {
    capture: new BrowserAudioCapture(speechCaptureWorkletUrl),
    transcriber: new RemoteRunnerSpeechTranscriber(gateway),
  };
}
