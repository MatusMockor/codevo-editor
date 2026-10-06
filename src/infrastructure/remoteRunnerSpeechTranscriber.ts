import type {
  SpeechTranscriberPort,
  SpeechTranscriptionRequest,
} from "../application/speechDictationPorts";
import type { RemoteRunnerGateway } from "../domain/remoteRunner";
import { encodeSpeechPcmBase64 } from "../domain/speechPcm";
import {
  classifySpeechTranscriptionError,
  type SpeechTranscription,
} from "../domain/speechTranscription";

export type SpeechTranscriptionGateway = Pick<RemoteRunnerGateway, "transcribeSpeech">;

const FAILED: SpeechTranscription = { kind: "failed", reason: "transcription-failed" };

export class RemoteRunnerSpeechTranscriber implements SpeechTranscriberPort {
  constructor(private readonly gateway: SpeechTranscriptionGateway) {}

  async transcribe(request: SpeechTranscriptionRequest): Promise<SpeechTranscription> {
    const base64 = encodeSpeechPcmBase64(request.pcm);
    if (base64 === null || this.gateway.transcribeSpeech === undefined) return FAILED;
    try {
      const transcript = await this.gateway.transcribeSpeech({
        serverId: request.serverId,
        language: request.language,
        base64,
      });
      return { kind: "transcribed", text: transcript.text };
    } catch (error) {
      return { kind: "failed", reason: classifySpeechTranscriptionError(error) };
    }
  }
}
