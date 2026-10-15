export const AGENT_FILE_SEARCH_SELECTOR = 'input[aria-label="Search workspace files"]';
const MAX_FOCUS_ATTEMPTS = 10;

export function focusAgentFileSearch(): void {
  if (typeof window === "undefined") return;
  let attempts = 0;
  const tryFocus = () => {
    attempts += 1;
    const input = document.querySelector<HTMLInputElement>(AGENT_FILE_SEARCH_SELECTOR);
    if (input && !input.disabled) {
      input.focus();
      input.select();
      return;
    }
    if (attempts >= MAX_FOCUS_ATTEMPTS) return;
    window.requestAnimationFrame(tryFocus);
  };
  window.requestAnimationFrame(tryFocus);
}
