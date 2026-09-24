import { describe, expect, it } from "vitest";
import {
  COLOR_LITERAL,
  parseAllStyleSheets,
  selectorParts,
  varReferences,
} from "../../cssContractTestSupport";

const CONVERSATION = "components/agentMode/conversation/conversation.css";
const WORK_ROWS = "components/agentMode/conversation/agentWorkRows.css";
const COMPOSER = "components/agentMode/composer/agentComposerFrame.css";
const TOOL_ROWS = "components/agentMode/agentToolRows.css";
const PROSE = "components/agentMode/conversation/agentProse.css";
const LIGHTBOX = "components/agentMode/conversation/agentLightbox.css";
const CHANGES = "components/agentMode/conversation/agentTurnChangesRow.css";
const P3_SHEETS: ReadonlyArray<string> = [
  CONVERSATION,
  WORK_ROWS,
  COMPOSER,
  TOOL_ROWS,
  PROSE,
  LIGHTBOX,
  CHANGES,
  "components/agentMode/agentComposerCommands.css",
  "components/agentMode/agentQuestionCard.css",
];
const MEDIA_CHIP_SELECTORS: ReadonlySet<string> = new Set<string>([
  ".agent-lightbox__chip",
  ".agent-lightbox__chip:hover",
  ".agent-lightbox__caption",
  ".agent-composer-attachment__remove",
  ".agent-composer-attachment__remove:hover",
]);
const TYPE_SCALE = "--codevo-fs-scale";
const LEGACY_TOKEN =
  /var\(\s*--(color|agent|settings|toast|change|ease)-|var\(\s*--codevo-(?!fs-scale\b)/;
const MOTION_PROPERTIES = new Set([
  "transition",
  "transition-duration",
  "animation",
  "animation-duration",
]);
const DURATION_LITERAL = /(^|[\s,(])\d+(\.\d+)?m?s\b/;
const MOTION_TOKEN = /var\(--cv-motion-(fast|base|slow|spin)\)/;
const REDUCED_MOTION = "@media (prefers-reduced-motion: reduce)";
const MIGRATED_SELECTORS = [
  ".agent-session__scroll",
  ".agent-session__body",
  ".agent-turn-list",
  ".agent-turn",
  ".agent-prompt",
  ".agent-prompt__bubble",
  ".agent-prompt__body",
  ".agent-answer",
  ".agent-turn__events",
  ".agent-text",
  ".agent-text__paragraph",
  ".agent-md__code",
  ".agent-md__code-body",
  ".agent-md__inline-code",
  ".agent-note",
  ".agent-finale",
  ".agent-raw",
  ".agent-message-actions",
  ".agent-message-copy",
  ".agent-attachments",
  ".agent-lightbox",
  ".agent-queued-list",
  ".agent-jump-latest",
] as const;

const parsed = parseAllStyleSheets();
const declaredTokens = new Set(
  parsed.rules
    .filter((rule) => rule.sheet.startsWith("ui/"))
    .flatMap((rule) => rule.declarations.map((declaration) => declaration.property))
    .filter((property) => property.startsWith("--cv-")),
);

function p3Declarations() {
  return parsed.rules
    .filter((rule) => P3_SHEETS.includes(rule.sheet))
    .flatMap((rule) => rule.declarations.map((declaration) => ({ rule, declaration })));
}

function declaredValue(
  sheet: string,
  selector: string,
  property: string,
  context: ReadonlyArray<string> = [],
): string | undefined {
  const values = parsed.rules
    .filter((rule) => rule.sheet === sheet)
    .filter((rule) => rule.context.join("|") === context.join("|"))
    .filter((rule) => selectorParts(rule.selector).includes(selector))
    .flatMap((rule) => rule.declarations)
    .filter((declaration) => declaration.property === property)
    .map((declaration) => declaration.value);
  return values[values.length - 1];
}

describe("P3 conversation sheets", () => {
  it("exist and parse cleanly", () => {
    expect(parsed.issues).toEqual([]);
    for (const sheet of P3_SHEETS) {
      expect(
        parsed.rules.some((rule) => rule.sheet === sheet),
        sheet,
      ).toBe(true);
    }
  });

  it("use only declared --cv tokens, the thread type scale and no legacy variables", () => {
    const undeclared = p3Declarations().flatMap(({ rule, declaration }) =>
      varReferences(declaration.value)
        .filter((name) => name !== TYPE_SCALE)
        .filter((name) => !name.startsWith("--cv-") || !declaredTokens.has(name))
        .map((name) => `${rule.sheet} ${rule.selector} ${name}`),
    );
    const legacy = p3Declarations()
      .filter(({ declaration }) => LEGACY_TOKEN.test(declaration.value))
      .map(({ rule, declaration }) => `${rule.sheet} ${rule.selector} ${declaration.property}`);

    expect(undeclared).toEqual([]);
    expect(legacy).toEqual([]);
  });

  it("declare no colour literals outside the media chips", () => {
    const literals = p3Declarations()
      .filter(({ rule }) => !MEDIA_CHIP_SELECTORS.has(rule.selector))
      .filter(({ declaration }) => COLOR_LITERAL.test(declaration.value))
      .map(({ rule, declaration }) => `${rule.sheet} ${rule.selector} ${declaration.property}`);

    expect(literals).toEqual([]);
  });

  it("animate only through the motion tokens", () => {
    const offenders = p3Declarations()
      .filter(({ declaration }) => MOTION_PROPERTIES.has(declaration.property))
      .filter(({ declaration }) => declaration.value !== "none")
      .filter(
        ({ declaration }) =>
          DURATION_LITERAL.test(declaration.value) || !MOTION_TOKEN.test(declaration.value),
      )
      .map(({ rule, declaration }) => `${rule.sheet} ${rule.selector}: ${declaration.value}`);

    expect(offenders).toEqual([]);
  });

  it("moves every transcript layout selector out of the legacy thread sheet", () => {
    for (const selector of MIGRATED_SELECTORS) {
      const sheets = parsed.rules
        .filter((rule) => rule.context.length === 0)
        .filter((rule) => selectorParts(rule.selector).includes(selector))
        .map((rule) => rule.sheet);
      expect(
        sheets.some((sheet) => P3_SHEETS.includes(sheet)),
        selector,
      ).toBe(true);
      expect(sheets, selector).not.toContain("components/agentMode/agentThread.css");
    }
  });

  it("centres the conversation on the 768px column with the mockup gutters", () => {
    expect(declaredValue(CONVERSATION, ".cv-conversation-column", "max-width")).toBe(
      "var(--cv-column)",
    );
    expect(declaredValue(CONVERSATION, ".cv-conversation-column", "margin")).toBe("0 auto");
    expect(declaredValue(CONVERSATION, ".cv-conversation-column", "min-width")).toBe("0");
    expect(declaredValue(CONVERSATION, ".agent-session__scroll", "padding")).toBe(
      "var(--cv-space-7) 20px var(--cv-space-5)",
    );
    expect(declaredValue(CONVERSATION, ".agent-turn-list", "gap")).toBe("var(--cv-space-2)");
  });

  it("draws the user message as the right-aligned t3code bubble", () => {
    expect(declaredValue(CONVERSATION, ".agent-prompt", "align-items")).toBe("flex-end");
    expect(declaredValue(CONVERSATION, ".agent-prompt", "padding-bottom")).toBe(
      "var(--cv-space-6)",
    );
    expect(declaredValue(CONVERSATION, ".agent-prompt__bubble", "max-width")).toBe("80%");
    expect(declaredValue(CONVERSATION, ".agent-prompt__bubble", "padding")).toBe(
      "var(--cv-space-5)",
    );
    expect(declaredValue(CONVERSATION, ".agent-prompt__bubble", "border-radius")).toBe(
      "var(--cv-r-bubble)",
    );
    expect(declaredValue(CONVERSATION, ".agent-prompt__bubble", "background")).toBe(
      "var(--cv-tint-2)",
    );
    expect(declaredValue(CONVERSATION, ".agent-prompt__bubble", "font-size")).toBe(
      "calc(var(--cv-t-sm) * var(--codevo-fs-scale, 1))",
    );
    expect(declaredValue(CONVERSATION, ".agent-prompt__bubble", "line-height")).toBe(
      "var(--cv-lh-prose)",
    );
    expect(declaredValue(CONVERSATION, ".agent-prompt__body", "white-space")).toBe("pre-wrap");
    expect(declaredValue(CONVERSATION, ".agent-prompt__body", "overflow-wrap")).toBe("anywhere");
  });

  it("publishes the shared work-row vocabulary with the mockup metrics", () => {
    expect(declaredValue(WORK_ROWS, ".cv-work-row", "min-height")).toBe("28px");
    expect(declaredValue(WORK_ROWS, ".cv-work-row", "gap")).toBe("var(--cv-space-3)");
    expect(declaredValue(WORK_ROWS, ".cv-work-row", "font-size")).toBe(
      "calc(var(--cv-t-sm) * var(--codevo-fs-scale, 1))",
    );
    expect(declaredValue(WORK_ROWS, ".cv-work-row", "color")).toBe("var(--cv-fg-subtle)");
    expect(declaredValue(WORK_ROWS, ".cv-work-row:hover", "color")).toBe("var(--cv-fg-strong)");
    expect(declaredValue(WORK_ROWS, ".cv-work-row__icon", "width")).toBe("24px");
    expect(declaredValue(WORK_ROWS, ".cv-work-row__icon", "height")).toBe("24px");
    expect(declaredValue(WORK_ROWS, ".cv-work-row__label", "text-overflow")).toBe("ellipsis");
    expect(declaredValue(WORK_ROWS, ".cv-work-row__meta", "opacity")).toBe("0");
    expect(declaredValue(WORK_ROWS, ".cv-live-row", "min-height")).toBe("28px");
  });

  it("stops the live pulse under reduced motion", () => {
    expect(
      declaredValue(WORK_ROWS, ".cv-live-row--pulse .cv-live-row__label", "animation", [
        REDUCED_MOTION,
      ]),
    ).toBe("none");
  });

  it("draws the composer slab, foot and drawer at the t3code measurements", () => {
    expect(declaredValue(COMPOSER, ".cv-composer__slab", "border-radius")).toBe(
      "var(--cv-r-composer)",
    );
    expect(declaredValue(COMPOSER, ".cv-composer__slab", "background")).toBe("var(--cv-raised)");
    expect(declaredValue(COMPOSER, ".cv-composer__slab", "box-shadow")).toBe(
      "var(--cv-ring-hair), var(--cv-edge-top), var(--cv-lift)",
    );
    expect(declaredValue(COMPOSER, ".cv-composer__slab:focus-within", "box-shadow")).toBe(
      "var(--cv-ring-hair-strong), var(--cv-edge-top), var(--cv-lift)",
    );
    expect(declaredValue(COMPOSER, ".agent-composer__box", "min-height")).toBe("86px");
    expect(declaredValue(COMPOSER, ".agent-composer__box", "padding")).toBe(
      "var(--cv-space-6) var(--cv-space-6) 10px",
    );
    expect(declaredValue(COMPOSER, ".cv-composer__foot", "height")).toBe("48px");
    expect(declaredValue(COMPOSER, ".cv-composer__foot", "padding")).toBe(
      "0 var(--cv-space-6) var(--cv-space-6) var(--cv-space-5)",
    );
    expect(declaredValue(COMPOSER, ".cv-composer__drawer", "height")).toBe("32px");
    expect(declaredValue(COMPOSER, ".cv-composer__drawer", "margin")).toBe("-1px 22px 0");
    expect(declaredValue(COMPOSER, ".cv-composer__drawer", "border-radius")).toBe("0 0 14px 14px");
    expect(declaredValue(COMPOSER, ".cv-composer__drawer", "background")).toBe("var(--cv-side)");
    expect(declaredValue(COMPOSER, ".agent-composer__textarea", "font-size")).toBe(
      "calc(var(--cv-t-sm) * var(--codevo-fs-scale, 1))",
    );
    expect(declaredValue(COMPOSER, '.cv-composer-dock[data-layout="hero"]', "flex")).toBe("1 1 0");
  });

  it("truncates the drawer and foot controls instead of widening the column", () => {
    expect(declaredValue(COMPOSER, ".cv-composer__drawer-start", "overflow")).toBe("hidden");
    expect(declaredValue(COMPOSER, ".cv-composer__drawer-end", "overflow")).toBe("hidden");
    expect(declaredValue(COMPOSER, ".cv-composer__controls", "overflow")).toBe("hidden");
    expect(declaredValue(COMPOSER, ".cv-composer__controls", "min-width")).toBe("0");
  });

  it("shows turn metadata only on hover or focus", () => {
    expect(declaredValue(CONVERSATION, ".cv-turn-meta", "opacity")).toBe("0");
    expect(declaredValue(CONVERSATION, ".cv-turn-meta", "height")).toBe("20px");
    expect(declaredValue(CONVERSATION, ".agent-prompt:hover > .cv-turn-meta", "opacity")).toBe("1");
    expect(
      declaredValue(CONVERSATION, ".agent-answer:focus-within > .cv-turn-meta", "opacity"),
    ).toBe("1");
    expect(declaredValue(CONVERSATION, ".cv-turn-meta__agent", "text-overflow")).toBe("ellipsis");
  });

  it("draws composer image tiles as 64px thumbnails with the round media remove chip", () => {
    expect(declaredValue(COMPOSER, ".agent-composer-attachment--image", "width")).toBe("64px");
    expect(declaredValue(COMPOSER, ".agent-composer-attachment--image", "height")).toBe("64px");
    expect(declaredValue(COMPOSER, ".agent-composer-attachment__thumb", "border-radius")).toBe(
      "var(--cv-r-card)",
    );
    expect(declaredValue(COMPOSER, ".agent-composer-attachment__remove", "width")).toBe("20px");
    expect(declaredValue(COMPOSER, ".agent-composer-attachment__remove", "top")).toBe("4px");
    expect(declaredValue(COMPOSER, ".agent-composer-attachment__remove", "background")).toBe(
      "rgba(0, 0, 0, 0.65)",
    );
    expect(declaredValue(COMPOSER, ".agent-composer__attachment-list", "gap")).toBe(
      "var(--cv-space-4)",
    );
  });

  it("draws the work fold as the t3code fold row", () => {
    expect(declaredValue(WORK_ROWS, ".agent-work__summary", "box-shadow")).toBe(
      "var(--cv-edge-bottom-hair)",
    );
    expect(declaredValue(WORK_ROWS, ".agent-work__summary", "padding")).toBe(
      "var(--cv-space-2) var(--cv-space-1) var(--cv-space-4)",
    );
    expect(declaredValue(WORK_ROWS, ".agent-work", "margin-bottom")).toBe("var(--cv-space-4)");
    expect(declaredValue(TOOL_ROWS, ".agent-tool-row--failed", "color")).toBe("var(--cv-danger)");
    expect(declaredValue(TOOL_ROWS, ".agent-tool-row__output", "white-space")).toBe("pre-wrap");
    expect(declaredValue(TOOL_ROWS, ".agent-tool-row__output", "overflow")).toBe("auto");
  });

  it("sets assistant prose and markdown like the mockup", () => {
    expect(declaredValue(PROSE, ".agent-text", "font-size")).toBe(
      "calc(var(--cv-t-sm) * var(--codevo-fs-scale, 1))",
    );
    expect(declaredValue(PROSE, ".agent-text", "line-height")).toBe("var(--cv-lh-prose)");
    expect(declaredValue(PROSE, ".agent-text__paragraph", "margin")).toBe("0 0 10px");
    expect(declaredValue(PROSE, ".agent-md__inline-code", "padding")).toBe("1px 4px");
    expect(declaredValue(PROSE, ".agent-md__inline-code", "border-radius")).toBe("var(--cv-r-xs)");
    expect(declaredValue(PROSE, ".agent-md__inline-code", "box-shadow")).toBeUndefined();
    expect(declaredValue(PROSE, ".agent-md__inline-code", "border")).toBeUndefined();
    expect(declaredValue(PROSE, ".agent-md__inline-code", "background")).toBe("var(--cv-tint-2)");
    expect(declaredValue(PROSE, ".agent-md__inline-code", "font-size")).toBe("0.9em");
    expect(declaredValue(PROSE, ".agent-md__inline-code", "line-height")).toBe("inherit");
    expect(declaredValue(PROSE, ".agent-md__path-link", "background")).toBeUndefined();
    expect(declaredValue(PROSE, ".agent-md__path-link", "padding")).toBeUndefined();
    expect(declaredValue(PROSE, ".agent-md__path-link", "display")).toBeUndefined();
    expect(declaredValue(PROSE, ".agent-md__path-link", "color")).toBe("var(--cv-accent)");
    expect(declaredValue(PROSE, ".agent-md__path-link", "text-decoration")).toBe("none");
    expect(declaredValue(PROSE, ".agent-md__path-link:hover", "text-decoration")).toBe("underline");
    expect(declaredValue(PROSE, ".agent-md__path-link .agent-md__inline-code", "color")).toBe(
      "inherit",
    );
  });

  it("puts code on one quiet slab with actions only on hover", () => {
    expect(declaredValue(PROSE, ".agent-md__code", "border-radius")).toBe("var(--cv-r-card)");
    expect(declaredValue(PROSE, ".agent-md__code", "background")).toBe("var(--cv-tint-1)");
    expect(declaredValue(PROSE, ".agent-md__code-body", "padding")).toBe("12.8px 14.4px");
    expect(declaredValue(PROSE, ".agent-md__code-body", "overflow-x")).toBe("auto");
    expect(declaredValue(PROSE, ".agent-md__code-body", "white-space")).toBe("pre-wrap");
    expect(declaredValue(PROSE, ".agent-md__code-bar", "opacity")).toBe("0");
    expect(declaredValue(PROSE, ".agent-md__code:hover .agent-md__code-bar", "opacity")).toBe("1");
    expect(declaredValue(PROSE, ".agent-md__table-scroll", "overflow-x")).toBe("auto");
    expect(declaredValue(PROSE, ".agent-raw__lines", "overflow")).toBe("auto");
  });

  it("keeps long approval commands inside the slab", () => {
    expect(declaredValue(COMPOSER, ".cv-composer-interaction__detail", "max-height")).toBe("80px");
    expect(declaredValue(COMPOSER, ".cv-composer-interaction__detail", "overflow")).toBe("auto");
    expect(declaredValue(COMPOSER, ".cv-composer-interaction__detail", "white-space")).toBe(
      "pre-wrap",
    );
    expect(declaredValue(COMPOSER, ".cv-composer-interaction__detail", "overflow-wrap")).toBe(
      "anywhere",
    );
    expect(declaredValue(COMPOSER, ".cv-composer-interaction__kicker b", "color")).toBe(
      "var(--cv-warn)",
    );
  });

  it("lays sent images out as the mockup's 2-column 4:3 grid above the text", () => {
    expect(declaredValue(CONVERSATION, ".agent-attachments", "grid-template-columns")).toBe(
      "repeat(2, minmax(0, 1fr))",
    );
    expect(declaredValue(CONVERSATION, ".agent-attachments", "max-width")).toBe("210px");
    expect(declaredValue(CONVERSATION, ".agent-attachments", "gap")).toBe("var(--cv-space-4)");
    expect(declaredValue(CONVERSATION, ".agent-attachments__open", "aspect-ratio")).toBe("4 / 3");
    expect(declaredValue(CONVERSATION, ".agent-attachments__open::after", "box-shadow")).toBe(
      "var(--cv-ring-hair-strong)",
    );
    expect(declaredValue(CONVERSATION, ".agent-attachments__image", "object-fit")).toBe("cover");
  });

  it("floats the image preview on the scrim with the close chip above the corner", () => {
    expect(declaredValue(LIGHTBOX, ".agent-lightbox__scrim", "background")).toBe("var(--cv-scrim)");
    expect(declaredValue(LIGHTBOX, ".agent-lightbox__image", "border-radius")).toBe(
      "var(--cv-r-card)",
    );
    expect(declaredValue(LIGHTBOX, ".agent-lightbox__close", "top")).toBe("-40px");
    expect(declaredValue(LIGHTBOX, ".agent-lightbox__chip", "width")).toBe("28px");
  });

  it("keeps the load-earlier controls quiet", () => {
    expect(declaredValue(CONVERSATION, ".cv-load-earlier", "background")).toBe("none");
    expect(declaredValue(CONVERSATION, ".cv-load-earlier", "color")).toBe("var(--cv-fg-subtle)");
    expect(declaredValue(CONVERSATION, ".cv-load-earlier:hover:not(:disabled)", "color")).toBe(
      "var(--cv-fg-strong)",
    );
    expect(declaredValue(CONVERSATION, ".cv-earlier", "display")).toBe("grid");
  });

  it("draws the changes row at the mockup size and truncates long counts", () => {
    expect(declaredValue(CHANGES, ".cv-changes-row", "height")).toBe("36px");
    expect(declaredValue(CHANGES, ".cv-changes-row", "padding")).toBe("0 6px 0 var(--cv-space-5)");
    expect(declaredValue(CHANGES, ".cv-changes-row", "border-radius")).toBe("var(--cv-r-card)");
    expect(declaredValue(CHANGES, ".cv-changes-row", "background")).toBe("var(--cv-tint-1)");
    expect(declaredValue(CHANGES, '.cv-changes-row[data-active="true"]', "background")).toBe(
      "var(--cv-tint-2)",
    );
    expect(declaredValue(CHANGES, ".cv-changes-row__count", "text-overflow")).toBe("ellipsis");
  });

  it("centres the empty-thread question like the mockup hero", () => {
    expect(declaredValue(CONVERSATION, ".cv-empty-hero", "flex")).toBe("1 1 0");
    expect(declaredValue(CONVERSATION, ".cv-empty-hero", "justify-content")).toBe("flex-end");
    expect(declaredValue(CONVERSATION, ".agent-empty__title", "font-size")).toBe("28px");
    expect(declaredValue(CONVERSATION, ".agent-empty__title", "line-height")).toBe("36px");
    expect(declaredValue(CONVERSATION, ".agent-empty__project", "text-decoration")).toBe(
      "underline dotted var(--cv-fg-subtle)",
    );
  });
});
