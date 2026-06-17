import { isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type {
  DiagnosticsUnsubscribeFn,
  LanguageServerDiagnosticEvent,
  LanguageServerDiagnosticsGateway,
} from "../domain/languageServerDiagnostics";

const DIAGNOSTICS_EVENT = "language-server://diagnostics";
export const JAVASCRIPT_TYPESCRIPT_DIAGNOSTICS_EVENT =
  "javascript-typescript-language-server://diagnostics";

type ListenToDiagnostics = (
  event: string,
  handler: (event: { payload: LanguageServerDiagnosticEvent }) => void,
) => Promise<DiagnosticsUnsubscribeFn>;
type RuntimeDetector = () => boolean;

const listenToDiagnostics: ListenToDiagnostics = (event, handler) =>
  listen<LanguageServerDiagnosticEvent>(event, handler);

export class TauriLanguageServerDiagnosticsGateway
  implements LanguageServerDiagnosticsGateway
{
  constructor(
    private readonly listenToEvent: ListenToDiagnostics = listenToDiagnostics,
    private readonly isRuntimeAvailable: RuntimeDetector = isTauri,
    private readonly diagnosticsEvent: string = DIAGNOSTICS_EVENT,
  ) {}

  subscribeDiagnostics(
    listener: (event: LanguageServerDiagnosticEvent) => void,
  ): Promise<DiagnosticsUnsubscribeFn> {
    if (!this.isRuntimeAvailable()) {
      return Promise.resolve(() => undefined);
    }

    return this.listenToEvent(this.diagnosticsEvent, (event) => {
      listener(event.payload);
    });
  }
}
