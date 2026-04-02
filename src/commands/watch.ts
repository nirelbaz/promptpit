import path from "node:path";
import { watch } from "node:fs";
import { writeFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { detectAdapters } from "../adapters/registry.js";
import { readManifest, writeManifest, computeHash } from "../core/manifest.js";
import { exists } from "../shared/utils.js";
import { readSkillsFromDir } from "../adapters/adapter-utils.js";
import type { PlatformAdapter } from "../adapters/types.js";
import { log } from "../shared/io.js";
import chalk from "chalk";

export async function watchCommand(root: string): Promise<void> {
  const skillsDir = path.join(root, ".agents", "skills");

  if (!(await exists(skillsDir))) {
    throw new Error(
      `No .agents/skills/ directory found at ${root}.\n` +
        `Run \`pit install\` first to set up canonical skills.`,
    );
  }

  // Verify recursive watch support BEFORE starting the watcher
  // Uses a temp dir OUTSIDE the watched directory to avoid self-triggering
  const supported = await verifyRecursiveWatch();
  if (!supported) {
    log.warn(
      "Recursive watch not supported on this system. " +
        "Changes in subdirectories may not be detected. " +
        "Use `pit install` manually after changes, or upgrade to Node 22+.",
    );
  }

  // Detect which adapters need re-translation
  const detected = await detectAdapters(root);
  const translateAdapters = detected
    .filter((d) => d.adapter.capabilities.skillLinkStrategy === "translate-copy")
    .map((d) => d.adapter);

  if (translateAdapters.length === 0) {
    log.info(
      "All detected adapters use symlinks — no translation needed. " +
        "Skills are already live-synced.",
    );
    log.info("Watching for manifest hash updates only...");
  }

  log.info(
    `Watching ${chalk.bold(".agents/skills/")} for changes... (Ctrl+C to stop)`,
  );

  // Debounce: batch rapid events into a single pass
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;
  const pendingChanges = new Set<string>();

  const watcher = watch(skillsDir, { recursive: true }, (_event, filename) => {
    if (!filename) return;
    if (!filename.endsWith("SKILL.md")) return;

    pendingChanges.add(filename);

    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      void handleChanges(root, skillsDir, [...pendingChanges], translateAdapters);
      pendingChanges.clear();
    }, 200);
  });

  watcher.on("error", (err) => {
    log.error(`Watch error: ${err.message}. Restarting may help.`);
  });

  process.on("SIGINT", () => {
    watcher.close();
    if (debounceTimer) clearTimeout(debounceTimer);
    console.log();
    log.info("Watch stopped.");
    process.exit(0);
  });
}

async function handleChanges(
  root: string,
  skillsDir: string,
  changedFiles: string[],
  translateAdapters: PlatformAdapter[],
): Promise<void> {
  const skillNames = [...new Set(
    changedFiles
      .map((f) => f.split(path.sep)[0])
      .filter((name): name is string => !!name),
  )];

  const timestamp = chalk.dim(new Date().toLocaleTimeString());

  // Read skills once for the whole batch, read manifest once
  const allSkills = await readSkillsFromDir(skillsDir);
  const manifest = await readManifest(root);

  for (const skillName of skillNames) {
    const skill = allSkills.find((s) => s.name === skillName);

    if (!skill) {
      console.log(`${timestamp} ${chalk.red("✗")} ${skillName} — deleted or invalid`);
      continue;
    }

    // Re-translate for copy/translate adapters
    // Use the real stack name from the manifest so markers match
    const stackEntry = manifest.installs.find((e) =>
      Object.values(e.adapters).some((a) => a.skills?.[skillName]),
    );
    for (const adapter of translateAdapters) {
      const miniBundle = {
        manifest: {
          name: stackEntry?.stack ?? "unknown",
          version: stackEntry?.stackVersion ?? "0.0.0",
        },
        agentInstructions: "",
        skills: [skill],
        rules: [],
        mcpServers: {},
        envExample: {},
      };
      try {
        await adapter.write(root, miniBundle, {});
        console.log(
          `${timestamp} ${chalk.green("↻")} ${skillName} → re-translated for ${adapter.displayName}`,
        );
      } catch (err) {
        const msg = err instanceof Error ? err.message : "unknown error";
        console.log(
          `${timestamp} ${chalk.red("✗")} ${skillName} → failed for ${adapter.displayName}: ${msg}`,
        );
      }
    }

    // Update manifest hashes
    let manifestChanged = false;
    for (const entry of manifest.installs) {
      for (const record of Object.values(entry.adapters)) {
        if (record.skills?.[skillName]) {
          record.skills[skillName] = { hash: computeHash(skill.content) };
          manifestChanged = true;
        }
      }
    }

    if (manifestChanged) {
      await writeManifest(root, manifest);
      console.log(`${timestamp} ${chalk.dim("manifest hashes updated")}`);
    }
  }
}

// Verify fs.watch recursive support using a temp dir OUTSIDE the watched path
async function verifyRecursiveWatch(): Promise<boolean> {
  const testDir = await mkdtemp(path.join(tmpdir(), "pit-watch-verify-"));
  const subDir = path.join(testDir, "sub");
  const testFile = path.join(subDir, "test.txt");

  return new Promise<boolean>((resolve) => {
    const timeout = setTimeout(() => {
      watcher.close();
      void cleanup();
      resolve(false);
    }, 1000);

    const watcher = watch(testDir, { recursive: true }, (_event, filename) => {
      if (filename) {
        clearTimeout(timeout);
        watcher.close();
        void cleanup();
        resolve(true);
      }
    });

    async function cleanup() {
      try {
        await rm(testDir, { recursive: true, force: true });
      } catch {
        // ignore
      }
    }

    setTimeout(async () => {
      const { mkdir } = await import("node:fs/promises");
      await mkdir(subDir, { recursive: true });
      await writeFile(testFile, "test").catch(() => {});
    }, 50);
  });
}
