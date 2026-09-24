const HEX6 = /^#[0-9a-f]{6}$/i;
const RGBA = /^rgba\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(0|1|0?\.\d+)\s*\)$/i;

export function cssColorToHex(value: string): string {
  const trimmed = value.trim();
  if (HEX6.test(trimmed)) return trimmed;
  const match = RGBA.exec(trimmed);
  if (match === null) throw new Error(`Unsupported colour value: ${value}`);
  const channels = [match[1], match[2], match[3]].map((channel) => Number(channel ?? "0"));
  if (channels.some((channel) => channel > 255)) {
    throw new Error(`Unsupported colour value: ${value}`);
  }
  const alpha = Math.round(Number(match[4] ?? "1") * 255);
  return `#${[...channels, alpha].map(channelHex).join("")}`;
}

function channelHex(channel: number): string {
  return channel.toString(16).padStart(2, "0");
}
