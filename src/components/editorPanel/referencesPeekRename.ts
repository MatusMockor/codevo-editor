const BUTTON_CLASS = "cv-peek-rename";
const REFERENCES_PEEK_CLASS = "reference-zone-widget";
const PEEK_ACTIONS = ".peekview-actions";

export interface PeekObserverSubscription {
  disconnect(): void;
}

export type PeekObserve = (target: Node, callback: MutationCallback) => PeekObserverSubscription;

const defaultObserve: PeekObserve = (target, callback) => {
  const observer = new MutationObserver(callback);
  observer.observe(target, { childList: true, subtree: true });
  return observer;
};

export function installReferencesPeekRename(
  root: HTMLElement,
  onRename: () => void,
  observe: PeekObserve = defaultObserve,
): () => void {
  const peeks = root.getElementsByClassName(REFERENCES_PEEK_CLASS);
  let disposed = false;
  const decorate = (): void => {
    if (disposed || peeks.length === 0) return;
    for (const peek of Array.from(peeks)) {
      if (!peek.classList.contains("peekview-widget")) continue;
      const actions = peek.querySelector<HTMLElement>(PEEK_ACTIONS);
      if (actions === null || actions.querySelector(`.${BUTTON_CLASS}`) !== null) continue;
      actions.prepend(renameButton(onRename));
    }
  };
  decorate();
  const subscription = observe(root, decorate);
  return () => {
    disposed = true;
    subscription.disconnect();
    for (const button of Array.from(root.querySelectorAll(`.${BUTTON_CLASS}`))) button.remove();
  };
}

function renameButton(onRename: () => void): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.className = BUTTON_CLASS;
  button.title = "Rename symbol (F2)";
  button.setAttribute("aria-keyshortcuts", "F2");
  button.append("Rename");
  const kbd = document.createElement("kbd");
  kbd.className = "cv-kbd";
  kbd.textContent = "F2";
  button.append(kbd);
  button.addEventListener("mousedown", (event) => {
    event.preventDefault();
    event.stopPropagation();
  });
  button.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    onRename();
  });
  return button;
}
