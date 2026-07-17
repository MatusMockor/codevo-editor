import {
  useHeadlessTestResults,
  type HeadlessTestResultsState,
  type UseHeadlessTestResultsOptions,
} from "./useHeadlessTestResults";

export type UsePhpTestResultsOptions = Omit<
  UseHeadlessTestResultsOptions,
  "trustMessage"
>;

export type PhpTestResultsState = HeadlessTestResultsState;

const trustMessage = "Trust this workspace to run PHP tests.";

export function usePhpTestResults(
  options: UsePhpTestResultsOptions,
): PhpTestResultsState {
  return useHeadlessTestResults({ ...options, trustMessage });
}
