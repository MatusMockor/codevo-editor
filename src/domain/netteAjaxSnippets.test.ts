import { describe, expect, it } from "vitest";
import {
  detectNetteRedrawControlAt,
  detectNetteLatteSnippetAt,
  findNetteLatteSnippetReference,
  findNetteRedrawControlCall,
  findNetteRedrawControlCalls,
} from "./netteAjaxSnippets";

describe("detectNetteLatteSnippetAt", () => {
  it("detects a static {snippet name} reference", () => {
    const source = "{snippet mailLogslisting}";

    expect(detectNetteLatteSnippetAt(source, source.indexOf("Logs"))).toEqual({
      kind: "tag",
      name: "mailLogslisting",
      nameEnd: source.indexOf("}"),
      nameStart: source.indexOf("mailLogslisting"),
    });
  });

  it("detects a static n:snippet attribute reference", () => {
    const source = '<div n:snippet="mailLogslisting"></div>';

    expect(detectNetteLatteSnippetAt(source, source.indexOf("Logs"))).toEqual({
      kind: "attribute",
      name: "mailLogslisting",
      nameEnd: source.indexOf('"', source.indexOf("mailLogslisting")),
      nameStart: source.indexOf("mailLogslisting"),
    });
  });

  it("ignores dynamic snippet expressions", () => {
    expect(detectNetteLatteSnippetAt("{snippet $name}", 10)).toBeNull();
    expect(detectNetteLatteSnippetAt('<div n:snippet="$name"></div>', 18)).toBeNull();
  });

  it("ignores snippets inside Latte comments", () => {
    const source = "{* {snippet mailLogslisting} *}";

    expect(detectNetteLatteSnippetAt(source, source.indexOf("Logs"))).toBeNull();
  });
});

describe("findNetteRedrawControlCalls", () => {
  it("finds static $this->redrawControl calls", () => {
    const source = `<?php
$this->redrawControl('mailLogslisting');
$this->redrawControl("sidebar");
`;

    expect(findNetteRedrawControlCalls(source).map((call) => call.name)).toEqual([
      "mailLogslisting",
      "sidebar",
    ]);
    expect(findNetteRedrawControlCall(source, "mailLogslisting")).toEqual({
      name: "mailLogslisting",
      nameEnd: source.indexOf("mailLogslisting") + "mailLogslisting".length,
      nameStart: source.indexOf("mailLogslisting"),
    });
  });

  it("ignores dynamic redrawControl arguments", () => {
    expect(
      findNetteRedrawControlCalls("<?php $this->redrawControl($name);"),
    ).toEqual([]);
  });
});

describe("detectNetteRedrawControlAt", () => {
  it("detects a static redrawControl string at the cursor", () => {
    const source = "<?php $this->redrawControl('mailLogslisting');";

    expect(detectNetteRedrawControlAt(source, source.indexOf("Logs"))).toEqual({
      name: "mailLogslisting",
      nameEnd: source.indexOf("mailLogslisting") + "mailLogslisting".length,
      nameStart: source.indexOf("mailLogslisting"),
    });
  });

  it("ignores dynamic redrawControl arguments", () => {
    const source = "<?php $this->redrawControl($name);";

    expect(detectNetteRedrawControlAt(source, source.indexOf("name"))).toBeNull();
  });
});

describe("findNetteLatteSnippetReference", () => {
  it("finds a matching colocated static Latte snippet", () => {
    const source = `<div n:snippet="sidebar"></div>
{snippet mailLogslisting}
{/snippet}
`;

    expect(findNetteLatteSnippetReference(source, "mailLogslisting")).toEqual({
      kind: "tag",
      name: "mailLogslisting",
      nameEnd: source.indexOf("mailLogslisting") + "mailLogslisting".length,
      nameStart: source.indexOf("mailLogslisting"),
    });
  });

  it("ignores dynamic and commented snippets", () => {
    expect(
      findNetteLatteSnippetReference(
        "{* {snippet mailLogslisting} *}\n{snippet $name}",
        "mailLogslisting",
      ),
    ).toBeNull();
  });
});
