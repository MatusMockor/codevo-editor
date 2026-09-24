import { describe, expect, it } from "vitest";
import { readStyleSheet } from "../../../cssContractTestSupport";

const SHEETS = [
  "components/agentMode/rightPanel/git/agentGit.css",
  "components/agentMode/rightPanel/git/agentGitBranchPicker.css",
  "components/agentMode/rightPanel/pullRequest/agentPullRequest.css",
];
const TOKENIZED_SPACING = /^\s*(?:padding|margin|gap)[a-z-]*:[^;]*\b(?:2|4|6|8|12|16|24|32)px/m;
const TOKENIZED_FONT_SIZE = /^\s*font-size:\s*(?:11|12|13|14|15|20)px/m;
const RAW_FOCUS = /box-shadow:\s*inset 0 0 0 1px var\(--cv-focus\)/;

describe("right panel Git and pull request styles", () => {
  it.each(SHEETS)("uses spacing, type and focus tokens in %s", (sheet) => {
    const { source } = readStyleSheet(sheet);
    expect(source).not.toMatch(TOKENIZED_SPACING);
    expect(source).not.toMatch(TOKENIZED_FONT_SIZE);
    expect(source).not.toMatch(RAW_FOCUS);
  });
});
