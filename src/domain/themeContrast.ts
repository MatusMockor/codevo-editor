interface RgbColor {
  blue: number;
  green: number;
  red: number;
}

export function contrastRatio(foreground: string, background: string): number {
  const foregroundLuminance = relativeLuminance(parseHexColor(foreground));
  const backgroundLuminance = relativeLuminance(parseHexColor(background));
  const lighter = Math.max(foregroundLuminance, backgroundLuminance);
  const darker = Math.min(foregroundLuminance, backgroundLuminance);

  return (lighter + 0.05) / (darker + 0.05);
}

function parseHexColor(value: string): RgbColor {
  const normalized = value.trim();

  if (!/^#[0-9a-f]{6}$/i.test(normalized)) {
    throw new Error(`Expected a six-digit hex color, received ${value}`);
  }

  return {
    blue: Number.parseInt(normalized.slice(5, 7), 16),
    green: Number.parseInt(normalized.slice(3, 5), 16),
    red: Number.parseInt(normalized.slice(1, 3), 16),
  };
}

function relativeLuminance({ blue, green, red }: RgbColor): number {
  return 0.2126 * linearChannel(red)
    + 0.7152 * linearChannel(green)
    + 0.0722 * linearChannel(blue);
}

function linearChannel(channel: number): number {
  const normalized = channel / 255;

  if (normalized <= 0.03928) {
    return normalized / 12.92;
  }

  return ((normalized + 0.055) / 1.055) ** 2.4;
}
