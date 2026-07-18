import type {
  PhpChangeSignatureEditableParameter,
  PhpChangeSignatureParameter,
} from "./phpChangeSignature";

export interface PhpChangeSignatureFormRow {
  byReference: boolean;
  callArgument: string;
  defaultValue: string;
  id: string;
  modifiers: string;
  name: string;
  sourceName: string | null;
  type: string;
  variadic: boolean;
}

export type PhpChangeSignatureFormValidation =
  | { kind: "valid"; parameters: readonly PhpChangeSignatureParameter[] }
  | { kind: "invalid"; message: string; rowId?: string };

export function initialPhpChangeSignatureRows(
  parameters: readonly PhpChangeSignatureEditableParameter[],
): PhpChangeSignatureFormRow[] {
  return parameters.map((parameter, index) => ({
    ...parameter,
    callArgument: "",
    id: `existing-${index}-${parameter.sourceName}`,
    sourceName: parameter.sourceName,
  }));
}

export function newPhpChangeSignatureRow(
  sequence: number,
): PhpChangeSignatureFormRow {
  return {
    byReference: false,
    callArgument: "",
    defaultValue: "null",
    id: `new-${sequence}`,
    modifiers: "",
    name: `parameter${sequence}`,
    sourceName: null,
    type: "mixed",
    variadic: false,
  };
}

export function validatePhpChangeSignatureRows(
  rows: readonly PhpChangeSignatureFormRow[],
): PhpChangeSignatureFormValidation {
  const names = new Set<string>();
  let optionalSeen = false;

  for (const [index, row] of rows.entries()) {
    const name = row.name.trim().replace(/^\$/, "");
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) {
      return {
        kind: "invalid",
        message: "Enter a valid PHP parameter name.",
        rowId: row.id,
      };
    }
    if (names.has(name)) {
      return {
        kind: "invalid",
        message: `Parameter $${name} is duplicated.`,
        rowId: row.id,
      };
    }
    names.add(name);

    if (!validType(row.type)) {
      return {
        kind: "invalid",
        message: "The parameter type is not valid PHP syntax.",
        rowId: row.id,
      };
    }
    if (row.variadic && index !== rows.length - 1) {
      return {
        kind: "invalid",
        message: "A variadic parameter must be last.",
        rowId: row.id,
      };
    }

    const optional = row.variadic || row.defaultValue.trim().length > 0;
    if (optional) optionalSeen = true;
    if (optionalSeen && !optional) {
      return {
        kind: "invalid",
        message: "Required parameters cannot follow optional parameters.",
        rowId: row.id,
      };
    }
    if (row.sourceName === null && !optional && !row.callArgument.trim()) {
      return {
        kind: "invalid",
        message: "Provide a call-site value for a new required parameter.",
        rowId: row.id,
      };
    }
  }

  return {
    kind: "valid",
    parameters: rows.map((row) => ({
      callArgument: row.callArgument.trim() || undefined,
      declaration: parameterDeclaration(row),
      sourceName: row.sourceName,
    })),
  };
}

function parameterDeclaration(row: PhpChangeSignatureFormRow): string {
  const parts = [row.modifiers.trim(), row.type.trim()].filter(Boolean);
  const marker = `${row.byReference ? "&" : ""}${row.variadic ? "..." : ""}`;
  const defaultValue = row.defaultValue.trim();
  return `${parts.join(" ")}${parts.length ? " " : ""}${marker}$${row.name.trim().replace(/^\$/, "")}${defaultValue ? ` = ${defaultValue}` : ""}`;
}

function validType(type: string): boolean {
  const compact = type.trim().replace(/\s+/g, "");
  if (!compact) return true;
  if (!/^[A-Za-z0-9_\\?&|()]+$/.test(compact)) return false;
  if (/\?\?|[|&]{2}|\(\)|^[|&]|[|&]$|\([|&]|[|&]\)/.test(compact)) return false;
  return !(compact.startsWith("?") && /[|&]/.test(compact));
}
