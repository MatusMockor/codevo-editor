export interface AgentConversationEscapeScope {
  readonly conversation: HTMLElement;
  readonly ownsDetachedFocus: boolean;
}

const OWN_ESCAPE_SELECTOR = [
  "input",
  "textarea",
  "select",
  '[contenteditable]:not([contenteditable="false"])',
  '[role="textbox"]',
  '[role="combobox"]',
  '[role="menu"]',
  '[role="menubar"]',
  '[role="listbox"]',
  '[role="dialog"]',
  ".agent-popover",
  ".monaco-editor",
  ".xterm",
].join(", ");

const OPEN_MODAL_SELECTOR = '[aria-modal="true"], dialog[open]';

export function agentConversationEscapeApplies(
  event: KeyboardEvent,
  scope: AgentConversationEscapeScope,
): boolean {
  if (event.key !== "Escape") return false;
  if (event.defaultPrevented) return false;
  if (event.isComposing || event.keyCode === 229) return false;
  if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return false;
  if (!conversationIsInteractive(scope.conversation)) return false;
  const document = scope.conversation.ownerDocument;
  if (document.querySelector(OPEN_MODAL_SELECTOR) !== null) return false;
  const target = event.target;
  if (target === document.body || target === document.documentElement || target === document) {
    return scope.ownsDetachedFocus;
  }
  if (!(target instanceof Element)) return false;
  if (!scope.conversation.contains(target)) return false;
  return target.closest(OWN_ESCAPE_SELECTOR) === null;
}

function conversationIsInteractive(conversation: HTMLElement): boolean {
  if (!conversation.isConnected) return false;
  if (conversation.closest("[inert], [hidden]") !== null) return false;
  if (typeof conversation.checkVisibility !== "function") return true;
  return conversation.checkVisibility({ checkVisibilityCSS: true, visibilityProperty: true });
}

const OPEN_COMPOSER_POPOVER_SELECTOR = '[aria-haspopup][aria-expanded="true"], .agent-popover';

export function agentComposerPopoverOpen(composer: Element | null): boolean {
  if (composer === null) return false;
  const scope = composer.closest(".cv-composer") ?? composer;
  return scope.querySelector(OPEN_COMPOSER_POPOVER_SELECTOR) !== null;
}
