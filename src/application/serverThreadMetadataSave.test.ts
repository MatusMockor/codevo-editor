import { expect, it } from "vitest";
import { serverThreadMetadataSaveError } from "./serverThreadMetadataSave";

it.each([
  ["Runner request failed (HTTP 409).", "changed on another device"],
  ["Runner request failed (HTTP 429).", "a server limit was reached"],
  ["Runner request failed (HTTP 503).", "temporarily unavailable"],
  ["Runner request failed (HTTP 404).", "no longer available on the server"],
  ["Runner request failed (HTTP 400).", "rejected by the server"],
  [
    "The server runner rejected this request as invalid (HTTP 400). If it is older than this editor, update the runner on the server.",
    "rejected by the server",
  ],
])("presents the known server failure without exposing a raw payload: %s", (error, expected) => {
  for (const viewed of [false, true]) {
    expect(serverThreadMetadataSaveError(error, viewed)).toContain(expected);
    expect(serverThreadMetadataSaveError(new Error(error), viewed)).toContain(expected);
  }
});

it.each([undefined, { error: "conflict" }, "private path HTTP 400 rejected"])(
  "keeps unknown failures generic and distinguishes automatic read status: %j",
  (error) => {
    expect(serverThreadMetadataSaveError(error, false)).toBe(
      "The conversation change could not be saved on the server. Refresh and try again.",
    );
    expect(serverThreadMetadataSaveError(error, true)).toBe(
      "The conversation read status could not be saved on the server. Refresh and try again.",
    );
  },
);
