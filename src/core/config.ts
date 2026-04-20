import path from "node:path";
import { configSchema, type PitConfig } from "../shared/schema.js";
import { loadJsonFile, writeJsonAtomic } from "../shared/utils.js";

const CONFIG_SUBPATH = ".promptpit/config.json";

function configPath(home: string): string {
  return path.join(home, CONFIG_SUBPATH);
}

export async function loadConfig(
  home: string,
  opts: { silent?: boolean } = {},
): Promise<PitConfig> {
  return loadJsonFile(configPath(home), configSchema, { version: 1 }, {
    silent: opts.silent,
    label: `Config at ${configPath(home)}`,
  });
}

export async function saveConfig(home: string, cfg: PitConfig): Promise<void> {
  await writeJsonAtomic(configPath(home), configSchema.parse(cfg));
}

export function addRecentTarget(cfg: PitConfig, target: string): PitConfig {
  const filtered = cfg.recents.targetPaths.filter((p) => p !== target);
  return {
    ...cfg,
    recents: { ...cfg.recents, targetPaths: [target, ...filtered].slice(0, 20) },
  };
}

export function addRecentSource(cfg: PitConfig, source: string): PitConfig {
  const filtered = cfg.recents.sources.filter((s) => s !== source);
  return {
    ...cfg,
    recents: { ...cfg.recents, sources: [source, ...filtered].slice(0, 20) },
  };
}
