import type { AudioInputDevicesPort } from "../../application/speechDictationPorts";
import { useAudioInputDevices } from "../../application/useSpeechInput";
import {
  effectiveSpeechInputSetting,
  type SpeechInputDevice,
  type SpeechInputSetting,
} from "../../domain/speechDictationInputSetting";
import {
  dictationMicrophoneChoice,
  dictationMicrophoneRowModel,
  type DictationMicrophoneRowModel,
} from "./dictationMicrophoneRowModel";
import { SettingsButton } from "./primitives/SettingsButton";
import { SettingsRow } from "./primitives/SettingsRow";
import { SettingsSelect } from "./primitives/SettingsSelect";

const NO_DEVICES: readonly SpeechInputDevice[] = [];

export interface AgentDictationMicrophoneRowProps {
  readonly devices: AudioInputDevicesPort | null;
  readonly input: SpeechInputSetting | undefined;
  onChangeInput(input: SpeechInputSetting): void;
}

export function AgentDictationMicrophoneRow({
  devices,
  input,
  onChangeInput,
}: AgentDictationMicrophoneRowProps) {
  const snapshot = useAudioInputDevices(devices);
  const model = dictationMicrophoneRowModel(snapshot, effectiveSpeechInputSetting(input));
  const listed = snapshot.kind === "ready" ? snapshot.devices : NO_DEVICES;

  return (
    <SettingsRow description={model.description} rowId="agents.dictationMicrophone">
      <DictationMicrophoneControl
        model={model}
        onChoose={(value) => {
          const next = dictationMicrophoneChoice(value, listed);

          if (next === null) return;

          onChangeInput(next);
        }}
        onRequestAccess={() => devices?.requestAccess()}
      />
    </SettingsRow>
  );
}

function DictationMicrophoneControl({
  model,
  onChoose,
  onRequestAccess,
}: {
  readonly model: DictationMicrophoneRowModel;
  onChoose(value: string): void;
  onRequestAccess(): void;
}) {
  switch (model.kind) {
    case "readout":
      return <span className="settings-readout">{model.text}</span>;
    case "access":
      return (
        <SettingsButton
          busy={model.busy}
          disabled={model.busy}
          onClick={onRequestAccess}
          variant="outline"
        >
          {model.action}
        </SettingsButton>
      );
    case "select":
      return (
        <SettingsSelect
          disabled={model.disabled}
          onChange={onChoose}
          options={model.options}
          value={model.value}
          width="md"
        />
      );
    default:
      return unreachable(model);
  }
}

function unreachable(value: never): never {
  throw new TypeError(`Unsupported microphone row control: ${JSON.stringify(value)}`);
}
