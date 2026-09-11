import {
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type FocusEvent,
  type MouseEvent,
} from "react";
import type { AgentMinimapEntry } from "./agentThreadMinimapPresentation";

type Anchor = { readonly button: HTMLButtonElement; readonly index: number };

/** Keep the preview beside the scrollable list, inside the themed rail. */
export function useAgentMinimapPreview(
  entries: ReadonlyArray<AgentMinimapEntry>,
  enabled: boolean,
) {
  const [hovered, setHovered] = useState<Anchor | null>(null);
  const [focused, setFocused] = useState<Anchor | null>(null);
  const anchor = enabled ? (hovered ?? focused) : null;
  const entry = anchor ? entries[anchor.index] : undefined;
  const previewRef = useRef<HTMLSpanElement>(null);
  const [style, setStyle] = useState<CSSProperties>({ visibility: "hidden" });

  useLayoutEffect(() => {
    const preview = previewRef.current;
    if (!anchor || !preview || !entry) return;
    const update = () => {
      const rail = preview.parentElement?.getBoundingClientRect();
      const button = anchor.button.getBoundingClientRect();
      if (!rail) return;
      const margin = 8;
      const width = Math.min(260, Math.max(0, window.innerWidth - margin * 2));
      const topBound = Math.max(margin, rail.top);
      const bottomBound = Math.min(window.innerHeight - margin, rail.bottom);
      const maxHeight = Math.max(0, bottomBound - topBound);
      const height = Math.min(preview.getBoundingClientRect().height, maxHeight);
      const left = Math.max(
        margin,
        Math.min(button.right + 12, window.innerWidth - width - margin),
      );
      const top = Math.max(topBound, Math.min(button.top - 6, bottomBound - height));
      setStyle({
        left: left - rail.left,
        top: top - rail.top,
        width,
        maxHeight,
        visibility: button.bottom <= topBound || button.top >= bottomBound ? "hidden" : "visible",
      });
    };
    update();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(update);
    if (preview.parentElement) observer?.observe(preview.parentElement);
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
    };
  }, [anchor, entry]);

  function target(
    event: MouseEvent<HTMLOListElement> | FocusEvent<HTMLOListElement>,
  ): Anchor | null {
    if (!(event.target instanceof Element)) return null;
    const button = event.target.closest("button");
    if (!(button instanceof HTMLButtonElement) || !event.currentTarget.contains(button))
      return null;
    return { button, index: [...event.currentTarget.querySelectorAll("button")].indexOf(button) };
  }

  return {
    handlers: {
      onMouseOver: (event: MouseEvent<HTMLOListElement>) => {
        if (enabled) setHovered(target(event));
      },
      onMouseLeave: () => setHovered(null),
      onFocus: (event: FocusEvent<HTMLOListElement>) => {
        if (enabled) setFocused(target(event));
      },
      onBlur: () => setFocused(null),
    },
    preview: entry ? (
      <span aria-hidden="true" className="agent-minimap__preview" ref={previewRef} style={style}>
        <small className="agent-minimap__caption">{entry.caption}</small>
        <span className="agent-minimap__preview-body">{entry.preview}</span>
      </span>
    ) : null,
  };
}
