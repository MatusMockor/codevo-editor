/**
 * Pure domain logic for the "Surround With" editor action (PhpStorm Cmd+Alt+T).
 *
 * Given a piece of selected text plus the editor's indentation settings, it
 * produces a Monaco snippet string (with `${1:...}` tab-stops and a final `$0`)
 * that wraps the selection in a PHP control-flow / exception block.
 *
 * The module is intentionally free of Monaco / React dependencies so it can be
 * unit-tested in isolation. The editor surface is responsible for reading the
 * selection + indentation and feeding the resulting snippet into Monaco's
 * snippet controller.
 */

export type SurroundWithTemplateId =
  | "for"
  | "foreach"
  | "if"
  | "try-catch"
  | "try-finally"
  | "while";

export interface SurroundWithTemplate {
  id: SurroundWithTemplateId;
  label: string;
}

export interface SurroundWithInput {
  /** The end-of-line sequence used by the target document. */
  eol: string;
  /** Leading whitespace copied from the first selected line. */
  indent: string;
  /** A single indentation level (e.g. four spaces or a tab). */
  indentUnit: string;
  id: SurroundWithTemplateId;
  /** The selected text (or current line) being wrapped. */
  text: string;
}

interface SurroundWithLayout {
  /** Snippet lines rendered before the wrapped body, e.g. `if (...) {`. */
  header: string[];
  /** Snippet lines rendered after the wrapped body, e.g. `}`. */
  footer: string[];
  /**
   * When true the final caret stop (`$0`) is appended to the body instead of
   * being placed in the footer. Used by blocks whose body is the place the
   * developer keeps editing (if / loops). Try blocks place the caret in the
   * catch / finally clause instead.
   */
  trailingBodyStop: boolean;
}

export const surroundWithTemplates: readonly SurroundWithTemplate[] = [
  { id: "if", label: "if" },
  { id: "foreach", label: "foreach" },
  { id: "for", label: "for" },
  { id: "while", label: "while" },
  { id: "try-catch", label: "try / catch" },
  { id: "try-finally", label: "try / finally" },
];

type SurroundWithLayoutBuilder = () => SurroundWithLayout;

const layoutBuilders: Record<SurroundWithTemplateId, SurroundWithLayoutBuilder> = {
  if: () => ({
    header: ["if (${1:condition}) {"],
    footer: ["}"],
    trailingBodyStop: true,
  }),
  foreach: () => ({
    header: ["foreach (${1:\\$items} as ${2:\\$item}) {"],
    footer: ["}"],
    trailingBodyStop: true,
  }),
  for: () => ({
    header: ["for (${1:\\$i = 0}; ${2:\\$i < \\$count}; ${3:\\$i++}) {"],
    footer: ["}"],
    trailingBodyStop: true,
  }),
  while: () => ({
    header: ["while (${1:condition}) {"],
    footer: ["}"],
    trailingBodyStop: true,
  }),
  "try-catch": () => ({
    header: ["try {"],
    footer: ["} catch (${1:\\Exception} ${2:\\$e}) {", "${INDENT}$0", "}"],
    trailingBodyStop: false,
  }),
  "try-finally": () => ({
    header: ["try {"],
    footer: ["} finally {", "${INDENT}$0", "}"],
    trailingBodyStop: false,
  }),
};

export function surroundWithSnippet(input: SurroundWithInput): string {
  const buildLayout = layoutBuilders[input.id];

  if (!buildLayout) {
    throw new Error(`Unknown surround-with template: ${String(input.id)}`);
  }

  const layout = buildLayout();
  const body = wrappedBodyLines(input, layout.trailingBodyStop);
  const lines = [
    ...prefixLines(layout.header, input.indent),
    ...body,
    ...prefixLines(resolveFooterIndentPlaceholder(layout.footer, input), input.indent),
  ];

  return lines.join(input.eol);
}

function wrappedBodyLines(
  input: SurroundWithInput,
  trailingBodyStop: boolean,
): string[] {
  const sourceLines = bodySourceLines(input);
  const bodyIndent = input.indent + input.indentUnit;
  const lastIndex = sourceLines.length - 1;

  return sourceLines.map((line, index) => {
    const escaped = escapeSnippet(line);
    const caret = index === lastIndex && trailingBodyStop ? "$0" : "";

    return `${bodyIndent}${escaped}${caret}`;
  });
}

function bodySourceLines(input: SurroundWithInput): string[] {
  if (input.text.length === 0) {
    return [""];
  }

  return splitLines(input.text);
}

function resolveFooterIndentPlaceholder(
  footer: string[],
  input: SurroundWithInput,
): string[] {
  return footer.map((line) =>
    line.replace("${INDENT}", input.indentUnit),
  );
}

function prefixLines(lines: string[], indent: string): string[] {
  return lines.map((line) => `${indent}${line}`);
}

function splitLines(text: string): string[] {
  return text.split(/\r\n|\r|\n/);
}

/**
 * Escapes the characters that carry meaning inside a Monaco snippet template so
 * the literal selected text is reproduced verbatim ($ would otherwise start a
 * tab-stop, and } / \ are snippet meta-characters).
 */
function escapeSnippet(text: string): string {
  return text.replace(/\\/g, "\\\\").replace(/\$/g, "\\$").replace(/}/g, "\\}");
}
