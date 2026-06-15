import { isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type {
  DiagnosticsUnsubscribeFn,
  LanguageServerDiagnosticEvent,
  LanguageServerDiagnosticsGateway,
} from "../domain/languageServerDiagnostics";

const DIAGNOSTICS_EVENT = "language-server://diagnostics";

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
  ) {}

  subscribeDiagnostics(
    listener: (event: LanguageServerDiagnosticEvent) => void,
  ): Promise<DiagnosticsUnsubscribeFn> {
    if (!this.isRuntimeAvailable()) {
      return Promise.resolve(() => undefined);
    }

    return this.listenToEvent(DIAGNOSTICS_EVENT, (event) => {
      listener(event.payload);
    });
  }
}
