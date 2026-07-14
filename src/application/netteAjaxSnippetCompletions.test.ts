import { describe, expect, it } from "vitest";
import { latteNetteSnippetNameCompletions } from "./netteAjaxSnippetCompletions";

describe("latteNetteSnippetNameCompletions", () => {
  it("offers matching snippet names from the current Latte template", () => {
    const source = [
      "{snippet mailLogslisting}",
      "{/snippet}",
      '<div n:snippet="mailSidebar"></div>',
      "{snippet mail}",
    ].join("\n");
    const offset = source.lastIndexOf("mail") + "mail".length;
    const replaceEnd = source.lastIndexOf("}");
    const replaceStart = source.lastIndexOf("mail");

    expect(latteNetteSnippetNameCompletions(source, offset)).toEqual([
      {
        detail: "Latte snippet",
        insertText: "mailLogslisting",
        kind: "snippet",
        label: "mailLogslisting",
        replaceEnd,
        replaceStart,
      },
      {
        detail: "Latte snippet",
        insertText: "mailSidebar",
        kind: "snippet",
        label: "mailSidebar",
        replaceEnd,
        replaceStart,
      },
      {
        detail: "Latte snippet",
        insertText: "mail",
        kind: "snippet",
        label: "mail",
        replaceEnd,
        replaceStart,
      },
    ]);
  });

  it("returns null outside snippet completion contexts", () => {
    expect(latteNetteSnippetNameCompletions("{if $mail}", 5)).toBeNull();
  });

  it("deduplicates repeated snippet names", () => {
    const source = [
      "{snippet listing}",
      "{/snippet}",
      '<div n:snippet="listing"></div>',
      "{snippet lis}",
    ].join("\n");
    const offset = source.lastIndexOf("lis") + "lis".length;
    const labels =
      latteNetteSnippetNameCompletions(source, offset)?.map(
        (completion) => completion.label,
      ) ?? [];

    expect(labels).toEqual(["listing", "lis"]);
  });
});
