// @vitest-environment jsdom
import type { MouseEvent } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { handleAgentMarkdownLinkClick } from "./agentMarkdownLinks";

function turn(href: string, artifactPath: string | null): HTMLAnchorElement {
  const article = document.createElement("article");
  article.dataset.agentTurn = "agt-2-0a1b";
  const link = document.createElement("a");
  link.setAttribute("href", href);
  article.append(link);
  if (artifactPath !== null) {
    const disclosure = document.createElement("button");
    disclosure.type = "button";
    disclosure.dataset.agentArtifactPath = artifactPath;
    disclosure.setAttribute("aria-expanded", "false");
    article.append(disclosure);
  }
  document.body.append(article);
  return link;
}

function click(link: HTMLAnchorElement): MouseEvent<HTMLElement> {
  return {
    button: 0,
    target: link,
    preventDefault: vi.fn(),
  } as unknown as MouseEvent<HTMLElement>;
}

describe("handleAgentMarkdownLinkClick", () => {
  afterEach(() => {
    document.body.replaceChildren();
  });

  it("opens safe external links only through the opener", () => {
    const openExternal = vi.fn().mockResolvedValue(undefined);
    handleAgentMarkdownLinkClick(click(turn("https://example.com", null)), openExternal);
    expect(openExternal).toHaveBeenCalledWith("https://example.com");
  });

  it("never opens a workspace-relative link externally", () => {
    const openExternal = vi.fn().mockResolvedValue(undefined);
    handleAgentMarkdownLinkClick(
      click(turn("docs/design/page.html", "docs/design/page.html")),
      openExternal,
    );
    expect(openExternal).not.toHaveBeenCalled();
  });

  it("expands this turn's artifact disclosure when the prose link matches it", () => {
    const link = turn("docs/design/page.html", "docs/design/page.html");
    const disclosure = document.querySelector<HTMLButtonElement>("[data-agent-artifact-path]")!;
    const clicked = vi.fn(() => disclosure.setAttribute("aria-expanded", "true"));
    disclosure.addEventListener("click", clicked);

    handleAgentMarkdownLinkClick(click(link), vi.fn().mockResolvedValue(undefined));

    expect(clicked).toHaveBeenCalledOnce();
    expect(document.activeElement).toBe(disclosure);
  });

  it("does not collapse an already expanded disclosure", () => {
    const link = turn("docs/design/page.html", "docs/design/page.html");
    const disclosure = document.querySelector<HTMLButtonElement>("[data-agent-artifact-path]")!;
    disclosure.setAttribute("aria-expanded", "true");
    const clicked = vi.fn();
    disclosure.addEventListener("click", clicked);

    handleAgentMarkdownLinkClick(click(link), vi.fn().mockResolvedValue(undefined));

    expect(clicked).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(disclosure);
  });

  it("stays inert when the turn has no matching artifact", () => {
    const openExternal = vi.fn().mockResolvedValue(undefined);
    const link = turn("docs/design/page.html", "docs/other.html");
    const clicked = vi.fn();
    document.querySelector("[data-agent-artifact-path]")!.addEventListener("click", clicked);

    handleAgentMarkdownLinkClick(click(link), openExternal);

    expect(clicked).not.toHaveBeenCalled();
    expect(openExternal).not.toHaveBeenCalled();
  });

  it("never reaches an artifact disclosure belonging to another turn", () => {
    const link = turn("docs/design/page.html", null);
    const other = document.createElement("article");
    other.dataset.agentTurn = "agt-3-0a1b";
    const disclosure = document.createElement("button");
    disclosure.dataset.agentArtifactPath = "docs/design/page.html";
    disclosure.setAttribute("aria-expanded", "false");
    other.append(disclosure);
    document.body.append(other);
    const clicked = vi.fn();
    disclosure.addEventListener("click", clicked);

    handleAgentMarkdownLinkClick(click(link), vi.fn().mockResolvedValue(undefined));

    expect(clicked).not.toHaveBeenCalled();
  });
});
