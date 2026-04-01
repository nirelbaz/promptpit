const MARKER_PREFIX = "promptpit";

export function createMarker(
  type: "start" | "end",
  stackName: string,
  version?: string,
  adapterId?: string,
): string {
  if (type === "end") {
    return `<!-- ${MARKER_PREFIX}:end:${stackName} -->`;
  }
  const parts = [MARKER_PREFIX, "start", stackName];
  if (version) parts.push(version);
  if (adapterId) parts.push(adapterId);
  return `<!-- ${parts.join(":")} -->`;
}

function markerStartRegex(stackName: string): RegExp {
  return new RegExp(
    `<!-- ${MARKER_PREFIX}:start:${escapeRegex(stackName)}:[^>]+ -->`,
  );
}

function markerEndRegex(stackName: string): RegExp {
  return new RegExp(`<!-- ${MARKER_PREFIX}:end:${escapeRegex(stackName)} -->`);
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function hasMarkers(content: string, stackName: string): boolean {
  return (
    markerStartRegex(stackName).test(content) &&
    markerEndRegex(stackName).test(content)
  );
}

export function extractMarkerContent(
  content: string,
  stackName: string,
): string | null {
  const startMatch = content.match(markerStartRegex(stackName));
  const endMatch = content.match(markerEndRegex(stackName));
  if (
    !startMatch ||
    !endMatch ||
    startMatch.index === undefined ||
    endMatch.index === undefined
  ) {
    return null;
  }
  const startEnd = startMatch.index + startMatch[0].length;
  const endStart = endMatch.index;
  if (endStart <= startEnd) return null;

  return content.slice(startEnd, endStart).trim();
}

export function insertMarkers(
  content: string,
  newContent: string,
  stackName: string,
  version: string,
  adapterId: string,
): string {
  const start = createMarker("start", stackName, version, adapterId);
  const end = createMarker("end", stackName);
  const block = `${start}\n${newContent}\n${end}`;

  if (content.trim() === "") {
    return block;
  }
  return `${content}\n\n${block}`;
}

// Remove an entire marker block (markers + content) for a given stack
export function stripMarkerBlock(content: string, stackName: string): string {
  if (!hasMarkers(content, stackName)) return content;

  const startMatch = content.match(markerStartRegex(stackName));
  const endMatch = content.match(markerEndRegex(stackName));
  if (
    !startMatch ||
    !endMatch ||
    startMatch.index === undefined ||
    endMatch.index === undefined
  ) {
    return content;
  }

  const before = content.slice(0, startMatch.index);
  const after = content.slice(endMatch.index + endMatch[0].length);

  // Clean up extra blank lines left by removal
  return (before.trimEnd() + "\n" + after.trimStart()).trim();
}

// Remove ALL promptpit marker blocks from content (any stack name)
export function stripAllMarkerBlocks(content: string): string {
  // Capture stack name between "start:" and the next ":" (version field)
  // Stack names may contain regex-special chars that were escaped during creation,
  // but in the raw HTML comment they appear unescaped, so [^:]+ is correct here
  const allStartRegex = new RegExp(
    `<!-- ${MARKER_PREFIX}:start:([^:]+):[^>]+ -->`,
    "g",
  );
  const stackNames = new Set<string>();
  let match: RegExpExecArray | null;
  while ((match = allStartRegex.exec(content)) !== null) {
    if (match[1]) stackNames.add(match[1]);
  }

  let result = content;
  for (const name of stackNames) {
    result = stripMarkerBlock(result, name);
  }
  return result;
}

export function replaceMarkerContent(
  content: string,
  newContent: string,
  stackName: string,
  version: string,
  adapterId: string,
): string {
  if (!hasMarkers(content, stackName)) {
    return content;
  }

  const startMatch = content.match(markerStartRegex(stackName));
  const endMatch = content.match(markerEndRegex(stackName));
  if (
    !startMatch ||
    !endMatch ||
    startMatch.index === undefined ||
    endMatch.index === undefined
  ) {
    return content;
  }

  const newStart = createMarker("start", stackName, version, adapterId);
  const end = endMatch[0];

  const before = content.slice(0, startMatch.index);
  const after = content.slice(endMatch.index + end.length);

  return `${before}${newStart}\n${newContent}\n${end}${after}`;
}
