export interface AgentConversationEscapeScope {
  readonly conversation: HTMLElement;
  readonly ownsLastInteraction: boolean;
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
const OPEN_AGENT_POPOVER_SELECTOR = '[aria-haspopup][aria-expanded="true"], .agent-popover';

export function agentConversationEscapeApplies(
  event: KeyboardEvent,
  scope: AgentConversationEscapeScope,
): boolean {
  if (!isPlainUnhandledEscape(event)) return false;
  if (!agentSurfaceIsInteractive(scope.conversation)) return false;
  const document = scope.conversation.ownerDocument;
  if (document.querySelector(OPEN_MODAL_SELECTOR) !== null) return false;
  const target = event.target;
  if (target === document.body || target === document.documentElement || target === document) {
    return scope.ownsLastInteraction;
  }
  if (!(target instanceof Element)) return false;
  if (target.closest(OWN_ESCAPE_SELECTOR) !== null) return false;
  return scope.conversation.contains(target) || scope.ownsLastInteraction;
}

export function agentEscapeIsUnclaimed(event: KeyboardEvent, document: Document): boolean {
  if (!isPlainUnhandledEscape(event)) return false;
  if (document.querySelector(OPEN_MODAL_SELECTOR) !== null) return false;
  if (agentPopoverOpen(document)) return false;
  const target = event.target;
  if (!(target instanceof Element)) return true;
  return target.closest(OWN_ESCAPE_SELECTOR) === null;
}

function isPlainUnhandledEscape(event: KeyboardEvent): boolean {
  if (event.key !== "Escape") return false;
  if (event.defaultPrevented) return false;
  if (event.isComposing || event.keyCode === 229) return false;
  return !(event.altKey || event.ctrlKey || event.metaKey || event.shiftKey);
}

export function agentSurfaceIsInteractive(conversation: HTMLElement): boolean {
  if (!conversation.isConnected) return false;
  if (conversation.closest("[inert], [hidden]") !== null) return false;
  if (typeof conversation.checkVisibility !== "function") return true;
  return conversation.checkVisibility({ checkVisibilityCSS: true, visibilityProperty: true });
}

export function agentComposerPopoverOpen(composer: Element | null): boolean {
  if (composer === null) return false;
  return agentPopoverOpen(composer.closest(".cv-composer") ?? composer);
}

function agentPopoverOpen(scope: ParentNode): boolean {
  return scope.querySelector(OPEN_AGENT_POPOVER_SELECTOR) !== null;
}
