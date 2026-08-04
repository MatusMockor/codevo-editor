import type { RetainedEslintDiagnostic, EslintFix } from "../domain/eslintDiagnostics";
import type { EditorGroupId } from "../domain/editorGroups";
import type { RetainedPhpstanDiagnostic } from "../domain/phpstanDiagnostics";
import type { WorkspaceSessionViewState } from "../domain/settings";

export const EMPTY_EDITOR_VIEW_STATES: Readonly<Record<string, WorkspaceSessionViewState>> =
  Object.freeze({});

export const EMPTY_EDITOR_VIEW_STATES_BY_GROUP: Readonly<
  Record<EditorGroupId, Record<string, WorkspaceSessionViewState>>
> = Object.freeze({});

export const EMPTY_ESLINT_FIXES: readonly EslintFix[] = Object.freeze([]);

export const EMPTY_ESLINT_DIAGNOSTICS: readonly RetainedEslintDiagnostic[] = Object.freeze([]);

export const EMPTY_PHPSTAN_DIAGNOSTICS: readonly RetainedPhpstanDiagnostic[] = Object.freeze([]);
