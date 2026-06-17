import { isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type {
  LanguageServerWorkspaceEditEvent,
  LanguageServerWorkspaceEditGateway,
  LanguageServerWorkspaceEditUnsubscribeFn,
} from "../domain/languageServerFeatures";

const WORKSPACE_EDIT_EVENT = "language-server://workspace-edit";
export const JAVASCRIPT_TYPESCRIPT_WORKSPACE_EDIT_EVENT =
  "javascript-typescript-language-server://workspace-edit";

type ListenToWorkspaceEdit = (
  event: string,
  handler: (event: { payload: LanguageServerWorkspaceEditEvent }) => void,
) => Promise<LanguageServerWorkspaceEditUnsubscribeFn>;
type RuntimeDetector = () => boolean;

const listenToWorkspaceEdit: ListenToWorkspaceEdit = (event, handler) =>
  listen<LanguageServerWorkspaceEditEvent>(event, handler);

export class TauriLanguageServerWorkspaceEditGateway
  implements LanguageServerWorkspaceEditGateway
{
  constructor(
    private readonly listenToEvent: ListenToWorkspaceEdit = listenToWorkspaceEdit,
    private readonly isRuntimeAvailable: RuntimeDetector = isTauri,
    private readonly workspaceEditEvent: string = WORKSPACE_EDIT_EVENT,
  ) {}

  subscribeWorkspaceEdits(
    listener: (event: LanguageServerWorkspaceEditEvent) => void,
  ): Promise<LanguageServerWorkspaceEditUnsubscribeFn> {
    if (!this.isRuntimeAvailable()) {
      return Promise.resolve(() => undefined);
    }

    return this.listenToEvent(this.workspaceEditEvent, (event) => {
      listener(event.payload);
    });
  }
}
