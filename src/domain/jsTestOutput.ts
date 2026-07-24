import {
  MAX_JS_TEST_OUTPUT_STREAM_BYTES,
  type JsTestTaskOutput,
  type JsTestTaskOutputStream,
} from "./jsTestTask";

export interface JsTestOutputOwner {
  readonly rootPath: string;
  readonly workspaceId: string;
}

export interface JsTestOutputSnapshot {
  readonly generation: number;
  readonly output: JsTestTaskOutput;
  readonly owner: JsTestOutputOwner;
}

export function jsTestOutputSnapshot(
  owner: JsTestOutputOwner,
  generation: number,
  output: JsTestTaskOutput,
): JsTestOutputSnapshot {
  if (!Number.isSafeInteger(generation) || generation < 0) {
    throw new Error("JavaScript test output generation must be a non-negative safe integer.");
  }
  return Object.freeze({
    generation,
    output: cloneJsTestTaskOutput(output),
    owner: Object.freeze({ rootPath: owner.rootPath, workspaceId: owner.workspaceId }),
  });
}

export function aggregateJsTestTaskOutputs(outputs: readonly JsTestTaskOutput[]): JsTestTaskOutput {
  return Object.freeze({
    stderr: aggregateStream(outputs.map(({ stderr }) => stderr)),
    stdout: aggregateStream(outputs.map(({ stdout }) => stdout)),
  });
}

export function formatJsTestOutput(output: JsTestTaskOutput): string {
  const sections: string[] = [];
  appendFormattedStream(sections, "stdout", output.stdout);
  appendFormattedStream(sections, "stderr", output.stderr);
  return sections.join("\n\n");
}

export function cloneJsTestTaskOutput(output: JsTestTaskOutput): JsTestTaskOutput {
  return Object.freeze({
    stderr: Object.freeze({ text: output.stderr.text, truncated: output.stderr.truncated }),
    stdout: Object.freeze({ text: output.stdout.text, truncated: output.stdout.truncated }),
  });
}

function aggregateStream(streams: readonly JsTestTaskOutputStream[]): JsTestTaskOutputStream {
  const encoder = new TextEncoder();
  const separator = "\n";
  let bytes = new Uint8Array();
  let truncated = streams.some(({ truncated: streamTruncated }) => streamTruncated);

  for (const stream of streams) {
    if (stream.text.length === 0) continue;
    const addition = encoder.encode(bytes.byteLength === 0 ? stream.text : separator + stream.text);
    const combined = new Uint8Array(bytes.byteLength + addition.byteLength);
    combined.set(bytes);
    combined.set(addition, bytes.byteLength);
    if (combined.byteLength > MAX_JS_TEST_OUTPUT_STREAM_BYTES) {
      truncated = true;
      bytes = utf8Tail(combined, MAX_JS_TEST_OUTPUT_STREAM_BYTES);
    } else {
      bytes = combined;
    }
  }

  return Object.freeze({
    text: new TextDecoder("utf-8", { fatal: true }).decode(bytes),
    truncated,
  });
}

function utf8Tail(bytes: Uint8Array, limit: number): Uint8Array {
  const decoder = new TextDecoder("utf-8", { fatal: true });
  const start = Math.max(0, bytes.byteLength - limit);
  for (let offset = start; offset < bytes.byteLength; offset += 1) {
    try {
      decoder.decode(bytes.slice(offset));
      return bytes.slice(offset);
    } catch {
      // Advance to the next UTF-8 boundary.
    }
  }
  return new Uint8Array();
}

function appendFormattedStream(
  sections: string[],
  label: "stdout" | "stderr",
  stream: JsTestTaskOutputStream,
): void {
  if (stream.text.length === 0 && !stream.truncated) return;
  const notice = stream.truncated ? "[Earlier output was truncated.]\n" : "";
  sections.push(`${label}\n${notice}${stream.text}`);
}
