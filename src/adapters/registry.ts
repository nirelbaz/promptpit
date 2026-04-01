import type { PlatformAdapter, DetectionResult } from "./types.js";
import { claudeCodeAdapter } from "./claude-code.js";
import { cursorAdapter } from "./cursor.js";
import { codexAdapter } from "./codex.js";
import { standardsAdapter } from "./standards.js";
import { copilotAdapter } from "./copilot.js";

const defaultAdapters: PlatformAdapter[] = [claudeCodeAdapter, cursorAdapter, codexAdapter, standardsAdapter, copilotAdapter];
let adapters: PlatformAdapter[] = [...defaultAdapters];

export function getAdapter(id: string): PlatformAdapter {
  const adapter = adapters.find((a) => a.id === id);
  if (!adapter) {
    throw new Error(
      `Unknown adapter: "${id}". Available: ${adapters.map((a) => a.id).join(", ")}`,
    );
  }
  return adapter;
}

export function listAdapters(): PlatformAdapter[] {
  return [...adapters];
}

export async function detectAdapters(
  root: string,
): Promise<{ adapter: PlatformAdapter; detection: DetectionResult }[]> {
  const results: { adapter: PlatformAdapter; detection: DetectionResult }[] = [];

  for (const adapter of adapters) {
    const detection = await adapter.detect(root);
    if (detection.detected) {
      results.push({ adapter, detection });
    }
  }
  return results;
}

export function registerAdapter(adapter: PlatformAdapter): void {
  if (adapters.some((a) => a.id === adapter.id)) {
    throw new Error(`Adapter "${adapter.id}" is already registered`);
  }
  adapters.push(adapter);
}

export function resetAdapters(): void {
  adapters = [...defaultAdapters];
}
