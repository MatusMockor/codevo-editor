import { invoke, isTauri } from "@tauri-apps/api/core";
import type {
  PhpSyntaxDiagnostic,
  PhpSyntaxDiagnosticsGateway,
} from "../domain/phpSyntaxDiagnostics";

type InvokeCommand = (
  command: string,
  args?: Record<string, unknown>,
) => Promise<unknown>;
type RuntimeDetector = () => boolean;

const invokeCommand: InvokeCommand = (command, args) => invoke(command, args);

export class TauriPhpSyntaxDiagnosticsGateway
  implements PhpSyntaxDiagnosticsGateway
{
  constructor(
    private readonly invokeSyntaxCommand: InvokeCommand = invokeCommand,
    private readonly isRuntimeAvailable: RuntimeDetector = isTauri,
  ) {}

  async validate(source: string): Promise<PhpSyntaxDiagnostic[]> {
    if (!this.isRuntimeAvailable()) {
      return [];
    }

    return (await this.invokeSyntaxCommand("parse_php_syntax", {
      source,
    })) as PhpSyntaxDiagnostic[];
  }
}
