import { describe, expect, it } from "vitest";
import {
  isUsableLaravelStorageDiskName,
  phpLaravelStorageDiskCompletionInsertText,
  phpLaravelStorageDiskConfigKey,
  phpLaravelStorageDiskNameFromConfigKey,
  phpLaravelStorageDiskReferenceContextAt,
} from "./phpLaravelStorage";

describe("phpLaravelStorage", () => {
  it("detects supported Laravel Storage disk strings", () => {
    const samples = [
      ["Storage::disk('s3')", "Storage::disk"],
      ["Storage::drive('s3')", "Storage::drive"],
      ["Storage::fake('s3')", "Storage::fake"],
      ["Storage::persistentFake('s3')", "Storage::persistentFake"],
      ["Storage::disk(name: 's3')", "Storage::disk"],
      ["Storage::persistentFake(disk: 's3')", "Storage::persistentFake"],
    ] as const;

    for (const [expression, call] of samples) {
      const source = `<?php\n\nreturn ${expression};\n`;

      expect(
        phpLaravelStorageDiskReferenceContextAt(
          source,
          positionAfter(source, "s3"),
        ),
      ).toMatchObject({
        call,
        diskName: "s3",
        prefix: "s3",
      });
    }
  });

  it("ignores unsupported arguments, interpolation, invalid names, and non-storage calls", () => {
    const secondArgument = `<?php\n\nStorage::disk(null, 's3');\n`;
    const interpolated = `<?php\n\nStorage::disk("s$name");\n`;
    const invalid = `<?php\n\nStorage::disk('s3/backup');\n`;
    const wrongCall = `<?php\n\nConfig::get('s3');\n`;

    expect(
      phpLaravelStorageDiskReferenceContextAt(
        secondArgument,
        positionAfter(secondArgument, "s3"),
      ),
    ).toBeNull();
    expect(
      phpLaravelStorageDiskReferenceContextAt(
        interpolated,
        positionAfter(interpolated, "s"),
      ),
    ).toBeNull();
    expect(
      phpLaravelStorageDiskReferenceContextAt(invalid, positionAfter(invalid, "s3")),
    ).toBeNull();
    expect(
      phpLaravelStorageDiskReferenceContextAt(wrongCall, positionAfter(wrongCall, "s3")),
    ).toBeNull();
  });

  it("maps storage disk names to filesystem config keys", () => {
    expect(phpLaravelStorageDiskConfigKey("s3")).toBe("filesystems.disks.s3");
    expect(
      phpLaravelStorageDiskNameFromConfigKey("filesystems.disks.public"),
    ).toBe("public");
    expect(
      phpLaravelStorageDiskNameFromConfigKey("filesystems.disks.s3.driver"),
    ).toBe(null);
    expect(phpLaravelStorageDiskNameFromConfigKey("filesystems.default")).toBe(
      null,
    );
    expect(isUsableLaravelStorageDiskName("backup-s3")).toBe(true);
    expect(isUsableLaravelStorageDiskName("s3/backup")).toBe(false);
  });

  it("uses whole disk-name insert text", () => {
    expect(phpLaravelStorageDiskCompletionInsertText("s3")).toBe("s3");
  });
});

function positionAfter(source: string, token: string) {
  const offset = source.indexOf(token);

  if (offset < 0) {
    throw new Error(`Token not found: ${token}`);
  }

  let lineNumber = 1;
  let column = 1;

  for (let index = 0; index < offset + token.length; index += 1) {
    if (source[index] === "\n") {
      lineNumber += 1;
      column = 1;
      continue;
    }

    column += 1;
  }

  return { column, lineNumber };
}
