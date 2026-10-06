import type { AudioInputDevicesPort } from "../../application/speechDictationPorts";
import { SPEECH_LANGUAGES, parseSpeechLanguage } from "../../domain/speechDictation";
import type { SpeechLanguage } from "../../domain/speechDictation";
import type { SpeechInputSetting } from "../../domain/speechDictationInputSetting";
import { effectiveSpeechDictationLanguage } from "../../domain/speechDictationLanguageSetting";
import { systemLocale } from "../agentMode/dictation/agentDictationContext";
import { SPEECH_LANGUAGE_LABELS } from "../agentMode/dictation/agentDictationPresentation";
import { AgentDictationMicrophoneRow } from "./AgentDictationMicrophoneRow";
import { SettingsRow } from "./primitives/SettingsRow";
import { SettingsSectionHeading } from "./primitives/SettingsSectionHeading";
import { SettingsSelect } from "./primitives/SettingsSelect";

const LANGUAGE_OPTIONS = SPEECH_LANGUAGES.map((language) => ({
  label: SPEECH_LANGUAGE_LABELS[language],
  value: language,
}));

export interface AgentDictationSettingsRowsProps {
  readonly language: SpeechLanguage | undefined;
  readonly locale?: string;
  readonly input: SpeechInputSetting | undefined;
  readonly inputDevices: AudioInputDevicesPort | null;
  onChangeLanguage(language: SpeechLanguage): void;
  onChangeInput(input: SpeechInputSetting): void;
}

export function AgentDictationSettingsRows({
  language,
  locale = systemLocale(),
  input,
  inputDevices,
  onChangeLanguage,
  onChangeInput,
}: AgentDictationSettingsRowsProps) {
  return (
    <SettingsSectionHeading title="Dictation">
      <SettingsRow rowId="agents.dictationLanguage">
        <SettingsSelect
          onChange={(value) => {
            const next = parseSpeechLanguage(value);

            if (next === null) return;

            onChangeLanguage(next);
          }}
          options={LANGUAGE_OPTIONS}
          value={effectiveSpeechDictationLanguage(language, locale)}
          width="md"
        />
      </SettingsRow>
      <AgentDictationMicrophoneRow
        devices={inputDevices}
        input={input}
        onChangeInput={onChangeInput}
      />
    </SettingsSectionHeading>
  );
}
