export function phpDocClassStringReturnTemplate(
  docBlock: string | null,
): string | null {
  if (!docBlock) {
    return null;
  }

  const templates = new Set<string>();

  for (const match of docBlock.matchAll(
    /@template(?:-[A-Za-z]+)?\s+([A-Za-z_][A-Za-z0-9_]*)\b/g,
  )) {
    const template = match[1];

    if (template) {
      templates.add(template);
    }
  }

  if (!templates.size) {
    return null;
  }

  const returnMatch = /@return\s+([^\r\n*]+)/.exec(docBlock);
  const returnType = firstPhpDocTypeToken(returnMatch?.[1] ?? null);

  if (!returnType || !templates.has(returnType)) {
    return null;
  }

  const classStringParamPattern =
    /@param\s+class-string\s*<\s*([A-Za-z_][A-Za-z0-9_]*)\s*>/g;

  for (const match of docBlock.matchAll(classStringParamPattern)) {
    const template = match[1];

    if (template && template === returnType) {
      return template;
    }
  }

  return null;
}

export function firstPhpDocTypeToken(
  typeAndDescription: string | null,
): string | null {
  const value = typeAndDescription?.trim() ?? "";
  let genericDepth = 0;

  for (let index = 0; index < value.length; index += 1) {
    const character = value[index] || "";

    if (character === "<") {
      genericDepth += 1;
      continue;
    }

    if (character === ">") {
      genericDepth = Math.max(0, genericDepth - 1);
      continue;
    }

    if (/\s/.test(character) && genericDepth === 0) {
      return value.slice(0, index);
    }
  }

  return value || null;
}
