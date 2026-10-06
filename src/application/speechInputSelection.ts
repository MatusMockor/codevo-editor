import {
  SYSTEM_DEFAULT_SPEECH_INPUT,
  effectiveSpeechInputSetting,
  type SpeechInputSetting,
} from "../domain/speechDictationInputSetting";
import type { SpeechInputSelectionPort } from "./speechDictationPorts";

export class SpeechInputSelection implements SpeechInputSelectionPort {
  private setting: SpeechInputSetting = SYSTEM_DEFAULT_SPEECH_INPUT;

  readonly current = (): SpeechInputSetting => this.setting;

  readonly select = (setting: SpeechInputSetting): void => {
    this.setting = effectiveSpeechInputSetting(setting);
  };
}
