import { isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type {
  LanguageServerRefreshEvent,
  LanguageServerRefreshGateway,
  LanguageServerRefreshUnsubscribeFn,
} from "../domain/languageServerFeatures";

const REFRESH_EVENT = "language-server://refresh";
export const JAVASCRIPT_TYPESCRIPT_REFRESH_EVENT =
  "javascript-typescript-language-server://refresh";

type ListenToRefreshEvent = (
  event: string,
  handler: (event: { payload: LanguageServerRefreshEvent }) => void,
) => Promise<LanguageServerRefreshUnsubscribeFn>;
type RuntimeDetector = () => boolean;

const listenToRefreshEvent: ListenToRefreshEvent = (event, handler) =>
  listen<LanguageServerRefreshEvent>(event, handler);

export class TauriLanguageServerRefreshGateway
  implements LanguageServerRefreshGateway
{
  constructor(
    private readonly listenToEvent: ListenToRefreshEvent = listenToRefreshEvent,
    private readonly isRuntimeAvailable: RuntimeDetector = isTauri,
    private readonly refreshEvent: string = REFRESH_EVENT,
  ) {}

  subscribeRefreshEvents(
    listener: (event: LanguageServerRefreshEvent) => void,
  ): Promise<LanguageServerRefreshUnsubscribeFn> {
    if (!this.isRuntimeAvailable()) {
      return Promise.resolve(() => undefined);
    }

    return this.listenToEvent(this.refreshEvent, (event) => {
      listener(event.payload);
    });
  }
}
