interface TextEncoder {
  encode(input: string): Uint8Array;
}
declare const TextEncoder: { new (): TextEncoder };

interface TextDecoder {
  decode(input: Uint8Array): string;
}
declare const TextDecoder: { new (label?: string): TextDecoder };
