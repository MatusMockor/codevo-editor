import {
  detectMissingThisMember,
  phpClassDeclaresMember,
  renderCreateConstantStub,
  renderCreateMethodStub,
  renderCreatePropertyStub,
  type MissingThisMember,
} from "../domain/phpCreateFromUsage";
import { findClassBodyInsertionOffset } from "../domain/phpInsertionPoint";
import { phpClassBodyInsertionAction } from "./phpClassGenerateCodeActions";
import type {
  PhpCodeActionDescriptor,
  PhpCodeActionRange,
} from "./phpCodeActionTypes";

/**
 * Offers "Create method/property/constant" when the cursor sits on an
 * unresolved `$this->`, `self::`, `static::` or same-file `parent::` usage.
 */
export function phpCreateFromUsageCodeAction(
  source: string,
  range: PhpCodeActionRange,
): PhpCodeActionDescriptor | null {
  const member = detectMissingThisMember(source, range.start);

  if (!member) {
    return null;
  }

  if (member.target === "parent") {
    return phpCreateParentMemberCodeAction(source, member);
  }

  return phpCreateSelfMemberCodeAction(source, member);
}

function phpCreateSelfMemberCodeAction(
  source: string,
  member: MissingThisMember,
): PhpCodeActionDescriptor | null {
  if (member.kind === "constant") {
    return phpPreferredQuickfix(
      phpClassBodyInsertionAction(
        source,
        renderCreateConstantStub(member.name, { indent: "" }),
        `Create constant '${member.name}'`,
      ),
    );
  }

  if (member.kind === "method") {
    return phpPreferredQuickfix(
      phpClassBodyInsertionAction(
        source,
        renderCreateMethodStub(member.name, member.argTypes ?? [], {
          indent: "",
          isStatic: member.isStatic,
        }),
        `Create method '${member.name}'`,
      ),
    );
  }

  return phpPreferredQuickfix(
    phpClassBodyInsertionAction(
      source,
      renderCreatePropertyStub(member.name, {
        indent: "",
        type: member.propertyType ?? null,
      }),
      `Create property '${member.name}'`,
    ),
  );
}

function phpCreateParentMemberCodeAction(
  source: string,
  member: MissingThisMember,
): PhpCodeActionDescriptor | null {
  const parentName = member.parentClass;

  if (!parentName) {
    return null;
  }

  const parentShortName = phpShortClassName(parentName);
  const insertion = findClassBodyInsertionOffset(source, parentShortName);

  if (!insertion) {
    return null;
  }

  if (
    phpClassDeclaresMember(source, member.name, member.kind, parentShortName)
  ) {
    return null;
  }

  if (member.kind === "constant") {
    return phpPreferredQuickfix(
      phpClassBodyInsertionAction(
        source,
        renderCreateConstantStub(member.name, { indent: "" }),
        `Create constant '${member.name}' in '${parentShortName}'`,
        parentShortName,
      ),
    );
  }

  if (member.kind === "method") {
    return phpPreferredQuickfix(
      phpClassBodyInsertionAction(
        source,
        renderCreateMethodStub(member.name, member.argTypes ?? [], {
          indent: "",
        }),
        `Create method '${member.name}' in '${parentShortName}'`,
        parentShortName,
      ),
    );
  }

  return null;
}

function phpShortClassName(reference: string): string {
  const segments = reference
    .split("\\")
    .filter((segment) => segment.length > 0);

  return segments[segments.length - 1] ?? reference;
}

export function phpPreferredQuickfix(
  action: PhpCodeActionDescriptor | null,
): PhpCodeActionDescriptor | null {
  if (!action) {
    return null;
  }

  return { ...action, isPreferred: true, kind: "quickfix" };
}
