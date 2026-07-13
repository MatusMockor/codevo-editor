import {
  planPhpCreateFromUsage,
  phpClassDeclaresMember,
  renderCreateConstantStub,
  renderCreateMethodStub,
  renderCreatePropertyStub,
  type MissingThisMember,
  type PhpCreateDeclarationIdentity,
  type PhpCreateRenderTarget,
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
  const plan = planPhpCreateFromUsage(source, range.start);

  if (!plan) {
    return null;
  }

  if (plan.member.target === "external") {
    return phpCreateExternalMemberCodeAction(
      source,
      plan.member,
      plan.owner,
      plan.sameFileExternal,
    );
  }

  if (!plan.owner) {
    return null;
  }

  if (plan.member.target === "parent") {
    return phpCreateParentMemberCodeAction(
      source,
      plan.member,
      plan.owner,
      plan.sameFileParent,
    );
  }

  return phpCreateSelfMemberCodeAction(source, plan.member, plan.owner);
}

function phpCreateSelfMemberCodeAction(
  source: string,
  member: MissingThisMember,
  owner: PhpCreateDeclarationIdentity,
): PhpCodeActionDescriptor | null {
  const insertionTarget = { bodyStartOffset: owner.bodyStartOffset };
  const renderTarget = { kind: owner.kind, relationship: "self" } as const;

  if (member.kind === "constant") {
    const stub = renderCreateConstantStub(member.name, {
      indent: "",
      target: renderTarget,
    });

    if (!stub) {
      return null;
    }

    return phpPreferredQuickfix(
      phpClassBodyInsertionAction(
        source,
        stub,
        `Create constant '${member.name}'`,
        insertionTarget,
      ),
    );
  }

  if (member.kind === "method") {
    const stub = renderCreateMethodStub(member.name, member.argTypes ?? [], {
      indent: "",
      isStatic: member.isStatic,
      target: renderTarget,
    });

    if (!stub) {
      return null;
    }

    return phpPreferredQuickfix(
      phpClassBodyInsertionAction(
        source,
        stub,
        `Create method '${member.name}'`,
        insertionTarget,
      ),
    );
  }

  const stub = renderCreatePropertyStub(member.name, {
    indent: "",
    target: renderTarget,
    type: member.propertyType ?? null,
  });

  if (!stub) {
    return null;
  }

  return phpPreferredQuickfix(
    phpClassBodyInsertionAction(
      source,
      stub,
      `Create property '${member.name}'`,
      insertionTarget,
    ),
  );
}

function phpCreateParentMemberCodeAction(
  source: string,
  member: MissingThisMember,
  owner: PhpCreateDeclarationIdentity,
  parent: PhpCreateDeclarationIdentity | undefined,
): PhpCodeActionDescriptor | null {
  if (!parent) {
    return null;
  }

  const parentName = parent.name;
  const insertionTarget = { bodyStartOffset: parent.bodyStartOffset };
  const insertion = findClassBodyInsertionOffset(source, insertionTarget);

  if (!insertion) {
    return null;
  }

  if (
    phpClassDeclaresMember(source, member.name, member.kind, insertionTarget)
  ) {
    return null;
  }

  if (member.kind === "constant") {
    const stub = renderCreateConstantStub(member.name, {
      indent: "",
      target: {
        kind: parent.kind,
        relationship: "parent",
        typeContext:
          owner.namespace === parent.namespace
            ? "same-namespace"
            : "external-namespace",
      },
    });

    if (!stub) {
      return null;
    }

    return phpPreferredQuickfix(
      phpClassBodyInsertionAction(
        source,
        stub,
        `Create constant '${member.name}' in '${parentName}'`,
        insertionTarget,
      ),
    );
  }

  if (member.kind === "method") {
    const stub = renderCreateMethodStub(member.name, member.argTypes ?? [], {
      indent: "",
      isStatic: member.isStatic,
      target: {
        kind: parent.kind,
        relationship: "parent",
        typeContext:
          owner.namespace === parent.namespace
            ? "same-namespace"
            : "external-namespace",
      },
    });

    if (!stub) {
      return null;
    }

    return phpPreferredQuickfix(
      phpClassBodyInsertionAction(
        source,
        stub,
        `Create method '${member.name}' in '${parentName}'`,
        insertionTarget,
      ),
    );
  }

  return null;
}

function phpCreateExternalMemberCodeAction(
  source: string,
  member: MissingThisMember,
  owner: PhpCreateDeclarationIdentity | undefined,
  sibling: PhpCreateDeclarationIdentity | undefined,
): PhpCodeActionDescriptor | null {
  if (!sibling) {
    return null;
  }

  const insertionTarget = { bodyStartOffset: sibling.bodyStartOffset };
  const renderTarget: PhpCreateRenderTarget = {
    kind: sibling.kind,
    relationship: "external",
    typeContext:
      owner && owner.namespace === sibling.namespace
        ? "same-namespace"
        : "external-namespace",
  };

  if (member.kind === "constant") {
    const stub = renderCreateConstantStub(member.name, {
      indent: "",
      target: renderTarget,
    });

    if (!stub) {
      return null;
    }

    return phpPreferredQuickfix(
      phpClassBodyInsertionAction(
        source,
        stub,
        `Create constant '${member.name}' in '${sibling.name}'`,
        insertionTarget,
      ),
    );
  }

  if (member.kind !== "method") {
    return null;
  }

  const stub = renderCreateMethodStub(member.name, member.argTypes ?? [], {
    indent: "",
    isStatic: member.isStatic,
    target: renderTarget,
  });

  if (!stub) {
    return null;
  }

  return phpPreferredQuickfix(
    phpClassBodyInsertionAction(
      source,
      stub,
      `Create method '${member.name}' in '${sibling.name}'`,
      insertionTarget,
    ),
  );
}

export function phpPreferredQuickfix(
  action: PhpCodeActionDescriptor | null,
): PhpCodeActionDescriptor | null {
  if (!action) {
    return null;
  }

  return { ...action, isPreferred: true, kind: "quickfix" };
}
