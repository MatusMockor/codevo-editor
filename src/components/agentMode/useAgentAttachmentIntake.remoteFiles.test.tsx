// @vitest-environment jsdom

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  IMAGE_SURFACE,
  mountMachine,
  settle,
  states,
  type Machine,
} from "../../application/agentAttachmentMachineTestSupport";
import type {
  AgentAttachmentOwner,
  AgentComposerAttachmentsSurface,
} from "../../application/useAgentComposerAttachments";
import { useRemoteAgentAttachments } from "../../application/useRemoteAgentAttachments";
import { AGENT_ATTACHMENT_REMOTE_FOLDER_REFUSAL } from "../../domain/agentAttachmentIntake";
import {
  REMOTE_FILE_ATTACHMENTS_UNSUPPORTED_REFUSAL,
  REMOTE_FILE_SOURCE_SPECIAL_ERROR,
  REMOTE_PASTED_FILE_REFUSAL,
} from "../../domain/remoteRunnerFileAttachment";
import { TauriRemoteRunnerGateway } from "../../infrastructure/tauriRemoteRunnerGateway";
import { useAgentAttachmentIntake } from "./useAgentAttachmentIntake";

const { invoke, isTauri } = vi.hoisted(() => ({ invoke: vi.fn(), isTauri: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke, isTauri }));

const PROJECT = "remote:server:runner:project";
const DRAFT_KEY = `new:${PROJECT}`;
const MIB = 1024 * 1024;
const FILE_TOO_LARGE = "File is larger than 50 MiB.";
const IMAGE_ONLY = /image|PNG|JPEG|GIF|WebP/i;

interface Deferred<T> {
  readonly promise: Promise<T>;
  resolve(value: T): void;
}

function deferred<T>(): Deferred<T> {
  let resolve: (value: T) => void = () => undefined;
  const promise = new Promise<T>((settled) => {
    resolve = settled;
  });
  return { promise, resolve };
}

interface NativeCall {
  readonly command: string;
  readonly request: Record<string, unknown>;
}

type StageOutcome = { readonly bytes: number } | { readonly error: string } | Deferred<number>;

describe("file attachments on a remote thread", () => {
  let root: Root;
  let calls: NativeCall[];
  let capabilities: Record<string, boolean>;
  let files: Map<string, StageOutcome>;
  let sources: Map<string, { readonly name: string; readonly bytes: number }>;
  let generation: number;
  let connected: boolean;
  let uploadGate: Deferred<void> | null;
  let picked: ReadonlyArray<string>;
  let errors: unknown[];
  let remote: ReturnType<typeof useRemoteAgentAttachments> | null;
  let intake: ReturnType<typeof useAgentAttachmentIntake> | null;
  let gateway: TauriRemoteRunnerGateway;

  const owner = (): AgentAttachmentOwner => ({
    projectRootKey: PROJECT,
    workspaceId: PROJECT,
    ownerId: PROJECT,
    generation,
  });

  async function native(command: string, args?: { readonly request?: unknown }): Promise<unknown> {
    const request = (args?.request ?? {}) as Record<string, unknown>;
    calls.push({ command, request });
    switch (command) {
      case "remote_runner_get_runner":
        return { protocolVersion: 1, runnerId: "runner", name: "Runner", capabilities };
      case "read_agent_attachment_image_source":
        return new ArrayBuffer(8);
      case "stage_agent_attachment_file_source": {
        const path = String(request.path);
        const outcome = files.get(path) ?? { bytes: 2048 };
        if ("error" in outcome) return Promise.reject(outcome.error);
        const bytes = "promise" in outcome ? await outcome.promise : outcome.bytes;
        const sourceId = `00000000-0000-4000-8000-${String(sources.size).padStart(12, "0")}`;
        sources.set(sourceId, { name: path.split("/").pop() ?? "", bytes });
        return { sourceId, name: path.split("/").pop(), bytes };
      }
      case "release_agent_attachment_file_source":
        return null;
      case "remote_runner_cancel_attachment_upload":
        return null;
      case "remote_runner_upload_attachment_file": {
        const source = sources.get(String(request.sourceId));
        expect(source).toBeDefined();
        if (uploadGate !== null) await uploadGate.promise;
        return {
          created: true,
          attachment: {
            id: request.attachmentId,
            runnerId: "runner",
            name: request.name,
            bytes: source?.bytes,
            sha256: "c".repeat(64),
            createdAt: "2026-10-13T00:00:00.000Z",
            kind: "file",
            mediaType: "application/octet-stream",
          },
        };
      }
      case "remote_runner_upload_attachment":
        return {
          created: true,
          attachment: {
            id: request.attachmentId,
            runnerId: "runner",
            name: request.name,
            bytes: atob(String(request.base64)).length,
            sha256: "d".repeat(64),
            createdAt: "2026-10-13T00:00:00.000Z",
            mediaType: request.mediaType,
          },
        };
      default:
        return Promise.reject(`Unexpected native command ${command}`);
    }
  }

  function Probe({ serverId }: { readonly serverId: string | null }) {
    remote = useRemoteAgentAttachments({
      gateway,
      imageSurface: IMAGE_SURFACE,
      attachmentEncoder: { encode: async (bytes) => btoa(String.fromCharCode(...bytes)) },
      resolveOwner: (key) => (key === PROJECT && connected ? owner() : null),
      resolveRetainedOwner: (key) => (key === PROJECT ? owner() : null),
      resolveServer: () => "server",
      reportError: (_source, error) => errors.push(error),
    });
    const scoped = remote.attachments.forDraft?.(DRAFT_KEY) ?? null;
    intake = useAgentAttachmentIntake({
      attachments: scoped,
      target: PROJECT,
      serverId,
      promptOwnerKey: DRAFT_KEY,
      dispatching: false,
      picker: async () => picked,
    });
    return null;
  }

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    let nextUrl = 0;
    vi.stubGlobal(
      "URL",
      class extends URL {
        static createObjectURL = () => `blob:remote-${(nextUrl += 1)}`;
        static revokeObjectURL = () => undefined;
      },
    );
    calls = [];
    capabilities = { taskExecution: true, eventReplay: true, fileAttachments: true };
    files = new Map();
    sources = new Map();
    generation = 1;
    connected = true;
    uploadGate = null;
    picked = [];
    errors = [];
    remote = null;
    intake = null;
    invoke.mockReset();
    invoke.mockImplementation(native);
    isTauri.mockReturnValue(true);
    gateway = new TauriRemoteRunnerGateway(invoke);
    root = createRoot(document.createElement("div"));
  });

  afterEach(() => {
    act(() => root.unmount());
    vi.unstubAllGlobals();
  });

  function show(serverId: string | null = "server"): void {
    act(() => root.render(createElement(Probe, { serverId })));
  }

  function hook(): ReturnType<typeof useAgentAttachmentIntake> {
    expect(intake).not.toBeNull();
    return intake as ReturnType<typeof useAgentAttachmentIntake>;
  }

  function draft(): AgentComposerAttachmentsSurface {
    const scoped = remote?.attachments.forDraft?.(DRAFT_KEY);
    expect(scoped).toBeDefined();
    return scoped as AgentComposerAttachmentsSurface;
  }

  function commands(name: string): ReadonlyArray<Record<string, unknown>> {
    return calls.filter((call) => call.command === name).map((call) => call.request);
  }

  async function pick(paths: ReadonlyArray<string>): Promise<void> {
    picked = paths;
    await act(() => hook().open());
  }

  it("attaches a PDF chosen in the picker without reading it into the webview", async () => {
    show();
    await pick(["/Users/dev/report.pdf"]);

    expect(draft().drafts).toMatchObject([
      {
        kind: "file",
        state: "ready",
        name: "report.pdf",
        bytes: 2048,
        mime: null,
        path: null,
        previewUrl: null,
        backing: "nativeFile",
      },
    ]);
    expect(draft().refusal).toBeNull();
    expect(commands("stage_agent_attachment_file_source")).toEqual([
      { path: "/Users/dev/report.pdf" },
    ]);
    expect(commands("read_agent_attachment_image_source")).toEqual([]);
    const exposed = JSON.stringify(draft().drafts);
    expect(exposed).not.toContain("00000000-0000-4000-8000-000000000000");
    expect(exposed).not.toContain("/Users/dev");
    expect(errors).toEqual([]);
  });

  it("uploads the staged source at send time and releases it once sent", async () => {
    show();
    await pick(["/Users/dev/report.pdf"]);
    let parts: unknown = null;
    await act(async () => {
      const turn = await draft().prepareTurn(PROJECT);
      expect(turn).not.toBeNull();
      parts = await remote?.resolve(
        { attachmentOwner: turn?.owner, attachments: turn?.intents },
        "server",
      );
      draft().markSent(turn?.draftIds ?? []);
    });

    const uploads = commands("remote_runner_upload_attachment_file");
    expect(uploads).toEqual([
      {
        serverId: "server",
        attachmentId: expect.stringMatching(/^[0-9a-f-]{36}$/),
        sourceId: "00000000-0000-4000-8000-000000000000",
        name: "report.pdf",
      },
    ]);
    expect(parts).toEqual([{ type: "attachment", attachmentId: uploads[0]?.attachmentId }]);
    expect(commands("remote_runner_upload_attachment")).toEqual([]);
    await settle(() =>
      expect(commands("release_agent_attachment_file_source")).toEqual([
        { sourceId: "00000000-0000-4000-8000-000000000000" },
      ]),
    );
    expect(draft().drafts).toEqual([]);
  });

  it("attaches a text file chosen in the picker instead of asking for an image", async () => {
    show();
    await pick(["/Users/dev/notes.txt"]);

    expect(states(draft())).toEqual(["notes.txt:ready"]);
    expect(draft().refusal).toBeNull();
    expect(commands("read_agent_attachment_image_source")).toEqual([]);
  });

  it.each([
    "/Users/dev/data.json",
    "/Users/dev/archive.zip",
    "/Users/dev/photo.heic",
    "/Users/dev/Makefile",
  ])("routes %s through the native file source", async (path) => {
    show();
    await pick([path]);

    expect(draft().drafts).toMatchObject([{ kind: "file", state: "ready", backing: "nativeFile" }]);
    expect(commands("stage_agent_attachment_file_source")).toEqual([{ path }]);
  });

  it("attaches the image and the PDF of a mixed drop and refuses the folder truthfully", async () => {
    files.set("/Users/dev/invoices", { error: "Choose a file, not a folder." });
    show();
    await act(() =>
      hook().drop(["/Users/dev/shot.png", "/Users/dev/report.pdf", "/Users/dev/invoices"]),
    );
    await settle(() => expect(states(draft())).toEqual(["shot.jpg:ready", "report.pdf:ready"]));

    expect(draft().drafts.map((entry) => entry.kind)).toEqual(["image", "file"]);
    expect(draft().refusal).toBe(AGENT_ATTACHMENT_REMOTE_FOLDER_REFUSAL);
    expect(commands("read_agent_attachment_image_source")).toEqual([
      { path: "/Users/dev/shot.png" },
    ]);
    expect(commands("stage_agent_attachment_file_source")).toEqual([
      { path: "/Users/dev/report.pdf" },
      { path: "/Users/dev/invoices" },
    ]);
  });

  it.each([
    ["an old runner without the capability", { taskExecution: true, eventReplay: true }],
    [
      "a runner that disabled it",
      { taskExecution: true, eventReplay: true, fileAttachments: false },
    ],
  ])("asks to update the server for %s and never mentions images", async (_label, announced) => {
    capabilities = announced;
    show();
    await pick(["/Users/dev/report.pdf", "/Users/dev/notes.txt"]);

    expect(draft().refusal).toBe(REMOTE_FILE_ATTACHMENTS_UNSUPPORTED_REFUSAL);
    expect(draft().refusal).not.toMatch(IMAGE_ONLY);
    expect(draft().drafts).toEqual([]);
    expect(commands("stage_agent_attachment_file_source")).toEqual([]);
  });

  it("keeps attaching images and pasted text to an old runner", async () => {
    capabilities = { taskExecution: true, eventReplay: true, textAttachments: true };
    show();
    await act(() => hook().drop(["/Users/dev/shot.png", "/Users/dev/report.pdf"]));
    await act(() => hook().pasteText("hello", "pasted-text.txt"));
    await settle(() =>
      expect(states(draft())).toEqual(["shot.jpg:ready", "pasted-text.txt:ready"]),
    );

    expect(draft().refusal).toBe(REMOTE_FILE_ATTACHMENTS_UNSUPPORTED_REFUSAL);
    expect(draft().drafts.map((entry) => entry.backing)).toEqual([undefined, undefined]);
  });

  it("reports a file above the limit with the file message", async () => {
    files.set("/Users/dev/huge.iso", { error: FILE_TOO_LARGE });
    show();
    await pick(["/Users/dev/huge.iso"]);

    expect(draft().refusal).toBe(FILE_TOO_LARGE);
    expect(draft().drafts).toEqual([]);
  });

  it("reports a symbolic link with the native message", async () => {
    files.set("/Users/dev/link.pdf", { error: REMOTE_FILE_SOURCE_SPECIAL_ERROR });
    show();
    await pick(["/Users/dev/link.pdf"]);

    expect(draft().refusal).toBe(REMOTE_FILE_SOURCE_SPECIAL_ERROR);
    expect(draft().refusal).not.toMatch(IMAGE_ONLY);
    expect(draft().drafts).toEqual([]);
  });

  it("summarises the distinct failures of one drop and still attaches the rest", async () => {
    files.set("/Users/dev/first", { error: "Choose a file, not a folder." });
    files.set("/Users/dev/second", { error: "Choose a file, not a folder." });
    files.set("/Users/dev/link.pdf", { error: REMOTE_FILE_SOURCE_SPECIAL_ERROR });
    files.set("/Users/dev/huge.iso", { error: FILE_TOO_LARGE });
    files.set("/Users/dev/empty.txt", { error: "File is empty." });
    show();
    await act(() =>
      hook().drop([
        "/Users/dev/first",
        "/Users/dev/link.pdf",
        "/Users/dev/second",
        "/Users/dev/huge.iso",
        "/Users/dev/empty.txt",
        "/Users/dev/report.pdf",
      ]),
    );

    expect(draft().refusal).toBe(
      `${AGENT_ATTACHMENT_REMOTE_FOLDER_REFUSAL} ${REMOTE_FILE_SOURCE_SPECIAL_ERROR} ${FILE_TOO_LARGE}`,
    );
    expect(states(draft())).toEqual(["report.pdf:ready"]);
  });

  it("holds 45 MiB files outside the in-memory draft budget", async () => {
    files.set("/Users/dev/one.zip", { bytes: 45 * MIB });
    files.set("/Users/dev/two.zip", { bytes: 45 * MIB });
    show();
    await act(() =>
      hook().drop(["/Users/dev/one.zip", "/Users/dev/two.zip", "/Users/dev/shot.png"]),
    );
    await settle(() =>
      expect(states(draft())).toEqual(["one.zip:ready", "two.zip:ready", "shot.jpg:ready"]),
    );

    expect(draft().refusal).toBeNull();
    expect(
      draft()
        .drafts.map((entry) => entry.bytes)
        .slice(0, 2),
    ).toEqual([45 * MIB, 45 * MIB]);
  });

  it("releases the native source when the draft is removed", async () => {
    show();
    await pick(["/Users/dev/report.pdf"]);
    const [staged] = draft().drafts;
    act(() => draft().remove(staged?.draftId ?? ""));

    await settle(() =>
      expect(commands("release_agent_attachment_file_source")).toEqual([
        { sourceId: "00000000-0000-4000-8000-000000000000" },
      ]),
    );
    expect(draft().drafts).toEqual([]);
  });

  it("publishes nothing and frees the source when the owner is replaced during staging", async () => {
    const staging = deferred<number>();
    files.set("/Users/dev/report.pdf", staging);
    show();
    let picking: Promise<void> = Promise.resolve();
    picked = ["/Users/dev/report.pdf"];
    act(() => {
      picking = hook().open();
    });
    await settle(() => expect(commands("stage_agent_attachment_file_source")).toHaveLength(1));
    expect(states(draft())).toEqual(["report.pdf:staging"]);

    generation = 2;
    show();
    await act(async () => {
      staging.resolve(2048);
      await picking;
    });

    expect(draft().drafts).toEqual([]);
    expect(draft().refusal).not.toMatch(/report|file|image/i);
    await settle(() =>
      expect(commands("release_agent_attachment_file_source")).toEqual([
        { sourceId: "00000000-0000-4000-8000-000000000000" },
      ]),
    );
    expect(commands("remote_runner_upload_attachment_file")).toEqual([]);
  });

  it("keeps a late staging failure to itself once the owner was replaced", async () => {
    const staging = deferred<number>();
    files.set("/Users/dev/report.pdf", staging);
    show();
    let picking: Promise<void> = Promise.resolve();
    picked = ["/Users/dev/report.pdf", "/Users/dev/link.pdf"];
    files.set("/Users/dev/link.pdf", { error: REMOTE_FILE_SOURCE_SPECIAL_ERROR });
    act(() => {
      picking = hook().open();
    });
    await settle(() => expect(commands("stage_agent_attachment_file_source")).toHaveLength(1));

    generation = 2;
    show();
    await act(async () => {
      staging.resolve(2048);
      await picking;
    });

    expect(draft().drafts).toEqual([]);
    expect(commands("stage_agent_attachment_file_source")).toHaveLength(1);
    expect(draft().refusal ?? "").not.toContain(REMOTE_FILE_SOURCE_SPECIAL_ERROR);
  });

  async function startSending(): Promise<{ readonly sending: Promise<unknown> }> {
    uploadGate = deferred<void>();
    let sending: Promise<unknown> = Promise.resolve(null);
    await act(async () => {
      const turn = await draft().prepareTurn(PROJECT);
      expect(turn?.intents).toHaveLength(1);
      sending = (
        remote?.resolve({ attachmentOwner: turn?.owner, attachments: turn?.intents }, "server") ??
        Promise.resolve(null)
      ).then(
        (parts) => ({ parts }),
        (error: unknown) => ({ error: error instanceof Error ? error.message : String(error) }),
      );
    });
    await settle(() => expect(commands("remote_runner_upload_attachment_file")).toHaveLength(1));
    return { sending };
  }

  it("cancels the stream and yields no part when the server disconnects mid-upload", async () => {
    show();
    await pick(["/Users/dev/report.pdf"]);
    const { sending } = await startSending();
    const [upload] = commands("remote_runner_upload_attachment_file");

    connected = false;
    show();
    expect(commands("remote_runner_cancel_attachment_upload")).toEqual([
      { serverId: "server", attachmentId: upload?.attachmentId },
    ]);
    await act(async () => {
      uploadGate?.resolve();
      await sending;
    });

    expect(await sending).toEqual({
      error: "Remote attachment owner changed. Attach the file again.",
    });
    expect(commands("remote_runner_cancel_attachment_upload")).toHaveLength(1);
  });

  it("cancels the stream, frees the source and yields no part when the owner is replaced mid-upload", async () => {
    show();
    await pick(["/Users/dev/report.pdf"]);
    const { sending } = await startSending();
    const [upload] = commands("remote_runner_upload_attachment_file");

    generation = 2;
    show();
    await act(async () => {
      uploadGate?.resolve();
      await sending;
    });

    expect(await sending).toEqual({
      error: "Remote attachment owner changed. Attach the file again.",
    });
    expect(commands("remote_runner_cancel_attachment_upload")).toEqual([
      { serverId: "server", attachmentId: upload?.attachmentId },
    ]);
    await settle(() =>
      expect(commands("release_agent_attachment_file_source")).toEqual([
        { sourceId: "00000000-0000-4000-8000-000000000000" },
      ]),
    );
    expect(draft().drafts).toEqual([]);
  });

  it("cancels the stream and frees the source when the composer unmounts mid-upload", async () => {
    show();
    await pick(["/Users/dev/report.pdf"]);
    const { sending } = await startSending();

    act(() => root.unmount());
    root = createRoot(document.createElement("div"));
    expect(commands("remote_runner_cancel_attachment_upload")).toHaveLength(1);
    expect(commands("release_agent_attachment_file_source")).toHaveLength(1);
    uploadGate?.resolve();

    expect(await sending).toEqual({
      error: "Remote attachment owner changed. Attach the file again.",
    });
  });

  it("refuses pasted binary content with the paste message, not an image message", async () => {
    show();
    const binary = new File([new Uint8Array([0xff, 0xfe, 0x00, 0x01])], "report.pdf", {
      type: "application/pdf",
    });
    await act(() => hook().paste([binary]));

    await settle(() => expect(draft().refusal).toBe(REMOTE_PASTED_FILE_REFUSAL));
    expect(draft().drafts).toEqual([]);
    expect(commands("stage_agent_attachment_file_source")).toEqual([]);
  });
});

describe("file attachments on a local thread", () => {
  const LOCAL_ROOT = "/workspace/app";
  let machine: Machine;
  let root: Root;
  let intake: ReturnType<typeof useAgentAttachmentIntake> | null;

  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    invoke.mockReset();
    isTauri.mockReturnValue(true);
    machine = mountMachine("local", LOCAL_ROOT);
    root = createRoot(document.createElement("div"));
    intake = null;
  });

  afterEach(() => {
    act(() => root.unmount());
    machine.unmount();
  });

  it("keeps attaching picked paths as local references without any native file source", async () => {
    function Probe() {
      intake = useAgentAttachmentIntake({
        attachments: machine.scope("thread-a"),
        target: LOCAL_ROOT,
        serverId: null,
        promptOwnerKey: "thread-a",
        dispatching: false,
        picker: async () => ["/Users/dev/report.pdf", "/Users/dev/shot.png"],
      });
      return null;
    }
    act(() => root.render(createElement(Probe)));
    await act(async () => {
      await intake?.open();
    });
    await settle(() =>
      expect(machine.scope("thread-a").drafts).toMatchObject([
        { kind: "reference", path: "/Users/dev/report.pdf", state: "ready" },
        { kind: "reference", path: "/Users/dev/shot.png", state: "ready" },
      ]),
    );

    expect(invoke).not.toHaveBeenCalled();
    expect(machine.scope("thread-a").drafts.map((entry) => entry.backing)).toEqual([
      undefined,
      undefined,
    ]);
  });
});
