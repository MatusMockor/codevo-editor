import { useLayoutEffect, type RefObject } from "react";

const TYPOGRAPHY_SHELL_CLASS = "app-shell";

/** Measure only the active composer; CSS owns the viewport and font-scale limits. */
export function useAgentComposerAutosize(
  textareaRef: RefObject<HTMLTextAreaElement | null>,
  prompt: string,
): void {
  useLayoutEffect(() => {
    const textarea = textareaRef.current;
    if (textarea !== null) resizeAgentComposer(textarea);
  }, [prompt, textareaRef]);

  useLayoutEffect(() => {
    const textarea = textareaRef.current;
    if (textarea === null) return;
    const resize = (): void => resizeAgentComposer(textarea);
    let width = textarea.getBoundingClientRect().width;
    const observer =
      typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver(() => {
            const nextWidth = textarea.getBoundingClientRect().width;
            if (nextWidth === width) return;
            width = nextWidth;
            resize();
          });
    observer?.observe(textarea);
    // Thread typography is inherited from the application shell. Its style can
    // change without changing this textarea's explicit width or height.
    const shell = textarea.closest(`.${TYPOGRAPHY_SHELL_CLASS}`);
    const typographyObserver = shell === null ? null : new MutationObserver(resize);
    if (shell !== null) {
      typographyObserver?.observe(shell, { attributes: true, attributeFilter: ["style"] });
    }
    window.addEventListener("resize", resize);
    return () => {
      observer?.disconnect();
      typographyObserver?.disconnect();
      window.removeEventListener("resize", resize);
    };
  }, [textareaRef]);
}

export function resizeAgentComposer(textarea: HTMLTextAreaElement): void {
  const release = holdComposerLayout(textarea);
  try {
    measureComposer(textarea);
  } finally {
    release();
  }
}

function measureComposer(textarea: HTMLTextAreaElement): void {
  const scrollTop = textarea.scrollTop;
  textarea.style.height = "0px";
  const contentHeight = textarea.scrollHeight;
  textarea.style.height = `${contentHeight}px`;
  textarea.style.overflowY = contentHeight > textarea.clientHeight ? "auto" : "hidden";
  textarea.scrollTop = scrollTop;
}

/**
 * Measuring collapses the textarea for one forced layout. Without a floor under its
 * parent the whole composer would shrink for that instant, and a transcript scrolled to
 * its bottom keeps the scroll offset the browser clamped it to meanwhile.
 */
function holdComposerLayout(textarea: HTMLTextAreaElement): () => void {
  const holder = textarea.parentElement;
  if (holder === null || holder.classList.contains(TYPOGRAPHY_SHELL_CLASS)) return releaseNothing;
  const { boxSizing, minHeight } = holder.style;
  const height = holder.getBoundingClientRect().height;
  holder.style.boxSizing = "border-box";
  holder.style.minHeight = `${height}px`;
  return () => {
    holder.style.boxSizing = boxSizing;
    holder.style.minHeight = minHeight;
  };
}

function releaseNothing(): void {}
