import {
  useHeadlessTestResults,
  type HeadlessTestResultsState,
  type UseHeadlessTestResultsOptions,
} from "./useHeadlessTestResults";

export type UseJsTestResultsOptions = Omit<
  UseHeadlessTestResultsOptions,
  "trustMessage"
>;

export type JsTestResultsState = HeadlessTestResultsState;

const trustMessage = "Trust this workspace to run JavaScript tests.";

export function useJsTestResults(
  options: UseJsTestResultsOptions,
): JsTestResultsState {
  return useHeadlessTestResults({ ...options, trustMessage });
}
