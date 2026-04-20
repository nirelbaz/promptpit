import path from "node:path";
import { mkdir, rename } from "node:fs/promises";
import { configSchema, type PitConfig } from "../shared/schema.js";
import { readFileOrNull, writeFileEnsureDir } from "../shared/utils.js";
import { log } from "../shared/io.js";

const CONFIG_SUBPATH = ".promptpit/config.json";

function configPath(home: string): string {
  return path.join(home, CONFIG_SUBPATH);
}

export async function loadConfig(
  home: string,
  opts: { silent?: boolean } = {},
): Promise<PitConfig> {
  const raw = await readFileOrNull(configPath(home));
  if (!raw) return configSchema.parse({ version: 1 });

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    if (!opts.silent) {
      log.warn(
        `Config at ${configPath(home)} is invalid JSON. Using in-memory defaults. Run \`pit config reset\` to overwrite.`,
      );
    }
    return configSchema.parse({ version: 1 });
  }

  const result = configSchema.safeParse(parsed);
  if (!result.success) {
    if (!opts.silent) {
      log.warn(`Config at ${configPath(home)} failed schema validation. Using defaults.`);
    }
    return configSchema.parse({ version: 1 });
  }
  return result.data;
}

export async function saveConfig(home: string, cfg: PitConfig): Promise<void> {
  const validated = configSchema.parse(cfg);
  const dest = configPath(home);
  const tmp = dest + ".tmp";
  await mkdir(path.dirname(dest), { recursive: true });
  await writeFileEnsureDir(tmp, JSON.stringify(validated, null, 2) + "\n");
  await rename(tmp, dest);
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
