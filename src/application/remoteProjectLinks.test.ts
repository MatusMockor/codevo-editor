// @vitest-environment jsdom
import { beforeEach, expect, it, vi } from "vitest";
import {
  readRemoteProjectLinks,
  removeRemoteProjectLink,
  saveRemoteProjectLink,
  subscribeRemoteProjectLinks,
} from "./remoteProjectLinks";
const KEY = "codevo.remote-project-links.v1";
beforeEach(() => localStorage.clear());
it("keeps exact server and runner identities separate and notifies subscribers", () => {
  const notify = vi.fn();
  const unsubscribe = subscribeRemoteProjectLinks(notify);
  saveRemoteProjectLink("remote:one:runner:app", "/local/app");
  saveRemoteProjectLink("remote:two:runner:app", "/local/other");
  expect(readRemoteProjectLinks().get("remote:one:runner:app")).toBe("/local/app");
  expect(readRemoteProjectLinks().has("remote:one:replacement:app")).toBe(false);
  expect(readRemoteProjectLinks()).toBe(readRemoteProjectLinks());
  removeRemoteProjectLink("remote:one:runner:app");
  expect([...readRemoteProjectLinks()]).toEqual([["remote:two:runner:app", "/local/other"]]);
  expect(notify).toHaveBeenCalledTimes(3);
  unsubscribe();
});
it.each([
  "[]",
  "{bad",
  JSON.stringify([["remote:s:r:p", "/local/../other"]]),
  JSON.stringify([["remote:s:r:%70", "/local"]]),
  JSON.stringify([
    ["remote:s:r:p", "/local"],
    ["remote:s:r:p", "/other"],
  ]),
])("fails closed for untrusted storage %s", (raw) => {
  localStorage.setItem(KEY, raw);
  expect(readRemoteProjectLinks().size).toBe(0);
});
it("rejects invalid keys, path aliases and oversized associations without overwriting", () => {
  saveRemoteProjectLink("remote:s:r:p", "/local");
  for (const root of [
    "relative",
    "/local/../other",
    "/local//other",
    "/local/",
    "/a\n",
    "/" + "a".repeat(4096),
  ])
    expect(() => saveRemoteProjectLink("remote:s:r:p", root)).toThrow();
  for (const key of ["remote:s:r:", "remote:s:r:%", "remote:s:r:%00", "remote:s:r:%70"])
    expect(() => saveRemoteProjectLink(key, "/other")).toThrow();
  expect(readRemoteProjectLinks().get("remote:s:r:p")).toBe("/local");
});
it("rejects new associations at capacity but allows changing existing ones", () => {
  localStorage.setItem(
    KEY,
    JSON.stringify(Array.from({ length: 256 }, (_, index) => [`remote:s:r:p${index}`, "/local"])),
  );
  expect(() => saveRemoteProjectLink("remote:s:r:new", "/other")).toThrow();
  saveRemoteProjectLink("remote:s:r:p0", "/other");
  expect(readRemoteProjectLinks().get("remote:s:r:p0")).toBe("/other");
});
it("does not silently replace corrupt preferences", () => {
  localStorage.setItem(KEY, "broken");
  expect(() => saveRemoteProjectLink("remote:s:r:p", "/local")).toThrow();
  expect(localStorage.getItem(KEY)).toBe("broken");
});
it("publishes external storage changes", () => {
  const notify = vi.fn();
  const unsubscribe = subscribeRemoteProjectLinks(notify);
  window.dispatchEvent(new StorageEvent("storage", { key: KEY }));
  expect(notify).toHaveBeenCalledOnce();
  unsubscribe();
});
