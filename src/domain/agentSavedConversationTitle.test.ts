import { describe, expect, it } from "vitest";
import {
  boundedSavedConversationTitle,
  savedConversationTitle,
} from "./agentSavedConversationTitle";

describe("saved conversation title", () => {
  it("compacts long merge request URLs to host and the last path segments", () => {
    expect(
      savedConversationTitle("https://git.efabrica.sk/ebox/backend/crm/-/merge_requests/123 pozri"),
    ).toBe("git.efabrica.sk/…/merge_requests/123 pozri");
  });

  it("keeps short URLs readable without the scheme, www, query or fragment", () => {
    expect(
      savedConversationTitle("https://efabrica.atlassian.net/browse/EPIK-16737 je to hotove?"),
    ).toBe("efabrica.atlassian.net/browse/EPIK-16737 je to hotove?");
    expect(savedConversationTitle("see http://www.example.com/?q=1#top, then")).toBe(
      "see example.com, then",
    );
  });

  it("collapses whitespace and falls back for empty titles", () => {
    expect(savedConversationTitle("  Telekom \n  phone ")).toBe("Telekom phone");
    expect(savedConversationTitle("   ")).toBe("Untitled conversation");
  });

  it("leaves text that only looks like a URL untouched", () => {
    expect(savedConversationTitle("https:// is not a link")).toBe("https:// is not a link");
  });

  it("bounds a long title to one line with an ellipsis", () => {
    const bounded = boundedSavedConversationTitle(`${"slovo ".repeat(30)}\nkoniec`, 60);
    expect(Array.from(bounded).length).toBeLessThanOrEqual(60);
    expect(bounded.endsWith("…")).toBe(true);
    expect(boundedSavedConversationTitle("Telekom phone", 60)).toBe("Telekom phone");
  });
});
