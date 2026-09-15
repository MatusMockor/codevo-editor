import { useLayoutEffect, type RefObject } from "react";

/** Measure only the active composer; CSS owns the viewport and font-scale limits. */
export function useAgentComposerAutosize(
  textareaRef: RefObject<HTMLTextAreaElement | null>,
  prompt: string,
): void {
  useLayoutEffect(() => {
    const textarea = textareaRef.current;
    if (textarea !== null) resizeComposer(textarea);
  }, [prompt, textareaRef]);

  useLayoutEffect(() => {
    const textarea = textareaRef.current;
    if (textarea === null) return;
    const resize = (): void => resizeComposer(textarea);
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
    const shell = textarea.closest(".app-shell");
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

function resizeComposer(textarea: HTMLTextAreaElement): void {
  const scrollTop = textarea.scrollTop;
  textarea.style.height = "0px";
  textarea.style.height = `${textarea.scrollHeight}px`;
  textarea.style.overflowY = textarea.scrollHeight > textarea.clientHeight ? "auto" : "hidden";
  textarea.scrollTop = scrollTop;
}
