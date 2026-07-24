import { describe, expect, it } from "vitest";
import {
  neonDocumentSymbolOccurrences,
  neonSymbolOccurrencesAt,
  neonSymbolTargetAt,
  planNeonSymbolRename,
} from "./neonSymbolEdits";

describe("NEON symbol references and rename", () => {
  const source = [
    "parameters:",
    "  mail:",
    "    host: localhost",
    "services:",
    "  mailer: App\\Mailer(%mail.host%)",
    "  consumer:",
    "    factory: App\\Consumer(@mailer)",
    "    setup:",
    "      - setMailer(@mailer)",
  ].join("\n");

  it("finds parameter declaration and references using delimiter-free spans", () => {
    const offset = source.indexOf("%mail.host%") + 3;
    const occurrences = neonSymbolOccurrencesAt(source, offset);
    expect(occurrences.map(({ span }) => source.slice(span.start, span.end))).toEqual([
      "host",
      "mail.host",
    ]);
  });

  it("renames one declared service and every local reference", () => {
    const offset = source.indexOf("@mailer") + 2;
    const plan = planNeonSymbolRename(source, offset, "primaryMailer");
    expect(plan?.placeholder).toBe("mailer");
    expect(plan?.edits.map(({ span }) => source.slice(span.start, span.end))).toEqual([
      "mailer",
      "mailer",
      "mailer",
    ]);
    expect(plan?.edits.every(({ newText }) => newText === "primaryMailer")).toBe(true);
  });

  it("renames only a parameter leaf while preserving its nesting", () => {
    const offset = source.indexOf("%mail.host%") + 3;
    const plan = planNeonSymbolRename(source, offset, "mail.server");
    expect(plan?.edits.map(({ newText }) => newText)).toEqual(["server", "mail.server"]);
    expect(planNeonSymbolRename(source, offset, "smtp.host")).toBeNull();
  });

  it("fails closed for undeclared, ambiguous, colliding, class and invalid names", () => {
    expect(planNeonSymbolRename("services:\n  x: App\\X(@missing)", 24, "renamed")).toBeNull();
    expect(
      planNeonSymbolRename("services:\n  one: App\\One\n  two: App\\Two(@one)", 46, "two"),
    ).toBeNull();
    expect(planNeonSymbolRename("services:\n  one: App\\One(@App\\Other)", 31, "Other")).toBeNull();
    expect(planNeonSymbolRename(source, source.indexOf("@mailer") + 2, "../escape")).toBeNull();
  });

  it("omits declarations when requested", () => {
    const offset = source.indexOf("@mailer") + 2;
    expect(neonSymbolOccurrencesAt(source, offset, false)).toHaveLength(2);
  });

  it("exposes per-document facts for a reference whose declaration is elsewhere", () => {
    const referenceOnly = "services:\n  consumer: App\\Consumer(@mailer)";
    const target = neonSymbolTargetAt(referenceOnly, referenceOnly.indexOf("mailer") + 2);
    expect(target).toMatchObject({ kind: "service", name: "mailer" });
    if (!target) throw new Error("Expected a service target.");
    expect(neonDocumentSymbolOccurrences(referenceOnly, target)).toEqual([
      {
        declaration: false,
        span: {
          start: referenceOnly.indexOf("mailer"),
          end: referenceOnly.indexOf("mailer") + "mailer".length,
        },
      },
    ]);
    expect(neonSymbolOccurrencesAt(referenceOnly, referenceOnly.indexOf("mailer") + 2)).toEqual([]);
  });

  it("does not expose class-typed service references as rename targets", () => {
    const classReference = "services:\n  consumer: App\\Consumer(@App\\Mailer)";
    expect(
      neonSymbolTargetAt(classReference, classReference.indexOf("App\\Mailer") + 2),
    ).toBeNull();
  });
});
