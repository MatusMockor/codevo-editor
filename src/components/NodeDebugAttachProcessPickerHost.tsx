import type { NodeDebugAttachProcessPickerController } from "../application/useNodeDebugAttachProcessPicker";
import { NodeDebugAttachProcessPicker } from "./NodeDebugAttachProcessPicker";

interface NodeDebugAttachProcessPickerHostProps {
  readonly controller: NodeDebugAttachProcessPickerController;
}

export function NodeDebugAttachProcessPickerHost({
  controller,
}: NodeDebugAttachProcessPickerHostProps) {
  return (
    <NodeDebugAttachProcessPicker
      onClose={controller.close}
      onManualPort={controller.attachByPort}
      onRetry={controller.retry}
      onSelectCandidate={controller.selectCandidate}
      open={controller.isOpen}
      result={controller.result}
    />
  );
}
