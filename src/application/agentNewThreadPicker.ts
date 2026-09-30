import type {
  CommandPaletteLaunch,
  PaletteLaunchRequest,
} from "./commandPalette/commandPaletteLaunch";

export interface AgentNewThreadPicker {
  open(): boolean;
}

export function commandPaletteNewThreadPicker(
  launch: CommandPaletteLaunch,
  openPalette: () => boolean,
): AgentNewThreadPicker {
  return {
    open() {
      const request: PaletteLaunchRequest = { page: "newThreadIn", query: "" };
      launch.request(request);
      if (openPalette()) return true;
      const pending = launch.take();
      if (pending !== null && pending !== request) launch.request(pending);
      return false;
    },
  };
}
