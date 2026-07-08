import {
  componentClassCandidatePathsForTemplate,
  presenterCandidatePathsForTemplate,
} from "../domain/nettePathResolution";

/**
 * The PHP classes that may own a Nette template: first the presenter candidates,
 * then colocated component/control candidates. Kept as an application-level
 * resolver because navigation, completion and view-data mapping share the same
 * ownership rule.
 */
export function componentOwnerCandidatePathsForTemplate(
  templateRelativePath: string,
): string[] {
  return Array.from(new Set([
    ...presenterCandidatePathsForTemplate(templateRelativePath),
    ...componentClassCandidatePathsForTemplate(templateRelativePath),
  ]));
}
