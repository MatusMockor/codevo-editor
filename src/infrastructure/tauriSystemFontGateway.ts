import { invoke, isTauri } from "@tauri-apps/api/core";
import type { SystemFontGateway } from "../domain/systemFonts";
import { BrowserSystemFontGateway } from "./browserSystemFontGateway";

type InvokeSystemFontCommand = (
  command: string,
  args?: Record<string, unknown>,
) => Promise<unknown>;
type RuntimeDetector = () => boolean;

const invokeSystemFontCommand: InvokeSystemFontCommand = (command, args) =>
  invoke<unknown>(command, args);

export class TauriSystemFontGateway implements SystemFontGateway {
  constructor(
    private readonly invokeCommand: InvokeSystemFontCommand =
      invokeSystemFontCommand,
    private readonly isRuntimeAvailable: RuntimeDetector = isTauri,
    private readonly browserFallback: SystemFontGateway =
      new BrowserSystemFontGateway(),
  ) {}

  async listMonospaceFontFamilies(): Promise<string[]> {
    if (!this.isRuntimeAvailable()) {
      return this.browserFallback.listMonospaceFontFamilies();
    }

    return this.invokeCommand("list_monospace_font_families") as Promise<
      string[]
    >;
  }
}
