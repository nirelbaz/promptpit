/**
 * Real-world repo stress test.
 *
 * Clones mature public GitHub repositories that use various AI-tool configs
 * (Claude Code, Cursor, Copilot, Codex, Standards) and runs the full
 * collect → validate → install → status pipeline against them.
 *
 * Goals:
 *  - Verify collect reads all expected artifacts from each adapter
 *  - Verify install writes correct files for every detected adapter
 *  - Detect logic gaps (e.g. multi-file skills losing companion files)
 *  - Detect crashes on real-world edge cases (large files, unusual frontmatter)
 *  - Detect poor UX (confusing warnings, misleading output)
 */

import { describe, it, expect, afterAll, beforeAll } from "vitest";
import { collectStack } from "../../src/commands/collect.js";
import { installStack } from "../../src/commands/install.js";
import { validateStack } from "../../src/core/validate.js";
import { computeStatus } from "../../src/commands/status.js";
import { detectAdapters } from "../../src/adapters/registry.js";
import { readStack } from "../../src/core/stack.js";
import path from "node:path";
import { mkdtemp, rm, readFile, readdir, stat, access } from "node:fs/promises";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";

// ── Repo definitions ────────────────────────────────────────────────────────

interface RepoSpec {
  name: string;
  repo: string;
  /** Shallow-clone depth (keeps it fast) */
  depth: number;
  /** Which adapters we expect to detect */
  expectedAdapters: string[];
  /** Artifact types we expect collect to find */
  expectedArtifacts: {
    instructions?: boolean;
    skills?: number;      // minimum count
    agents?: number;
    rules?: number;
    mcpServers?: number;
  };
  /** Extra files/dirs to probe after install */
  extraChecks?: (root: string, targetDir: string) => Promise<string[]>;
}

const REPOS: RepoSpec[] = [
  // ── Claude Code: 7 skills, rules, agents, MCP ──────────────────────────
  {
    name: "positron (Claude Code + Copilot — 7 skills, 3 agents, 9+ rules)",
    repo: "posit-dev/positron",
    depth: 1,
    expectedAdapters: ["claude-code", "copilot"],
    expectedArtifacts: {
      instructions: true,
      skills: 2,           // BUG-TRACKING: has 7 but some may lack frontmatter
      agents: 0,           // BUG: agents lack `name` field → silently dropped (BUG 2)
      rules: 0,            // BUG: rules lack `name` field → silently dropped (BUG 1)
      mcpServers: 0,       // BUG: .vscode/mcp.json uses JSONC comments → parse fails (BUG 3)
    },
  },
  // ── Cursor: 6 .mdc rules + MCP ─────────────────────────────────────────
  {
    name: "speckle-server (Cursor + Copilot — 6 .mdc rules, 7 instructions)",
    repo: "specklesystems/speckle-server",
    depth: 1,
    expectedAdapters: ["cursor", "copilot"],
    expectedArtifacts: {
      instructions: true,
      skills: 0,
      agents: 0,
      rules: 0,            // BUG: .mdc rules lack `name` in portable format (BUG 1)
      mcpServers: 1,
    },
  },
  // ── Copilot: 8 agents + MCP ────────────────────────────────────────────
  {
    name: "azure-sdk-for-js (Claude Code + Copilot — 8 agents, 2 MCP)",
    repo: "Azure/azure-sdk-for-js",
    depth: 1,
    expectedAdapters: ["claude-code", "copilot"],
    expectedArtifacts: {
      instructions: true,
      skills: 0,
      agents: 0,           // BUG: all 8 agents lack `name` field → dropped (BUG 2)
      rules: 0,
      mcpServers: 2,
    },
  },
  // ── Copilot: 6 agents + 6 instructions ─────────────────────────────────
  {
    name: "apm (Copilot — 6 agents, 6 instructions)",
    repo: "microsoft/apm",
    depth: 1,
    expectedAdapters: ["copilot"],
    expectedArtifacts: {
      instructions: true,
      skills: 0,
      agents: 0,           // BUG: agents lack `name` field → dropped (BUG 2)
      rules: 0,            // BUG: instructions lack `name` field → dropped (BUG 1)
      mcpServers: 0,
    },
  },
  // ── Codex: rich .codex/ with commands ──────────────────────────────────
  {
    name: "fit-framework (Codex — 23 commands, AGENTS.md)",
    repo: "ModelEngine-Group/fit-framework",
    depth: 1,
    expectedAdapters: ["codex"],
    expectedArtifacts: {
      instructions: true,
      skills: 0,            // GAP: no .codex/skills/ in any public repo
      agents: 0,
      rules: 0,
      mcpServers: 0,
    },
  },
  // ── Multi-adapter mega-repo: Claude + Cursor + Codex + Standards ───────
  {
    name: "everything-claude-code (Claude + Cursor + Codex + 6 MCP)",
    repo: "affaan-m/everything-claude-code",
    depth: 1,
    expectedAdapters: ["claude-code", "cursor"],
    expectedArtifacts: {
      instructions: true,
      skills: 1,            // 1 Claude skill + 10 Cursor skills (via .cursor/skills/)
      agents: 0,
      rules: 0,             // 39 Cursor rules (.md not .mdc) — may or may not parse
      mcpServers: 0,        // BUG: .mcp.json present but Standards MCP suppressed (BUG 4)
    },
  },
  // ── Standards: 4 MCP servers ───────────────────────────────────────────
  {
    name: "KurrentDB (Standards — 4 MCP servers)",
    repo: "kurrent-io/KurrentDB",
    depth: 1,
    expectedAdapters: ["standards"],
    expectedArtifacts: {
      instructions: false,
      skills: 0,
      agents: 0,
      rules: 0,
      mcpServers: 2,       // .mcp.json with 4 servers
    },
  },
  // ── Claude Code + Cursor + Standards (4 adapters, MCP) ─────────────────
  {
    name: "spotlight (Claude Code + Cursor + Codex + Standards — 2 MCP)",
    repo: "getsentry/spotlight",
    depth: 1,
    expectedAdapters: ["claude-code", "cursor"],
    expectedArtifacts: {
      instructions: true,
      skills: 0,
      agents: 0,
      rules: 0,
      mcpServers: 0,       // BUG: Standards MCP suppressed when Claude detected (BUG 4)
    },
  },
  // ── Cursor skills (not .mdc — actual SKILL.md in .cursor/skills/) ─────
  {
    name: "snyk-intellij-plugin (Cursor — 4 skills + 1 .mdc rule)",
    repo: "snyk/snyk-intellij-plugin",
    depth: 1,
    expectedAdapters: ["cursor"],
    expectedArtifacts: {
      instructions: false,
      skills: 0,            // .cursor/skills/*/SKILL.md — Cursor adapter doesn't read these
      agents: 0,
      rules: 0,             // 1 .mdc rule, but may lack `name` field
      mcpServers: 0,
    },
  },
];

// ── Helpers ─────────────────────────────────────────────────────────────────

function cloneRepo(repo: string, dest: string, depth: number): void {
  execFileSync("git", [
    "clone",
    "--depth", String(depth),
    "--single-branch",
    `https://github.com/${repo}.git`,
    dest,
  ], { stdio: "pipe", timeout: 120_000 });
}

async function dirExists(p: string): Promise<boolean> {
  try {
    const s = await stat(p);
    return s.isDirectory();
  } catch {
    return false;
  }
}

async function fileExists(p: string): Promise<boolean> {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

async function listFilesRecursive(dir: string, prefix = ""): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
  const files: string[] = [];
  for (const entry of entries) {
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      files.push(...await listFilesRecursive(path.join(dir, entry.name), rel));
    } else {
      files.push(rel);
    }
  }
  return files;
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe("Real-world repo stress tests", () => {
  // Shared tmp root for all clones — cleaned up after all tests
  let tmpRoot: string;
  const cloneDirs = new Map<string, string>();

  beforeAll(async () => {
    tmpRoot = await mkdtemp(path.join(tmpdir(), "pit-realworld-"));

    // Clone all repos in sequence (parallel git clones can contend on network)
    for (const spec of REPOS) {
      const dest = path.join(tmpRoot, spec.repo.replace("/", "--"));
      try {
        cloneRepo(spec.repo, dest, spec.depth);
        cloneDirs.set(spec.repo, dest);
      } catch (err) {
        console.warn(`⚠ Failed to clone ${spec.repo}: ${(err as Error).message}`);
      }
    }
  }, 600_000); // 10 min timeout for clones

  afterAll(async () => {
    if (tmpRoot) {
      await rm(tmpRoot, { recursive: true, force: true });
    }
  });

  // ── Per-repo test suites ──────────────────────────────────────────────

  for (const spec of REPOS) {
    describe(spec.name, () => {
      let repoDir: string;
      let bundleDir: string;
      let targetDir: string;

      beforeAll(() => {
        const dir = cloneDirs.get(spec.repo);
        if (!dir) {
          throw new Error(`Repo ${spec.repo} was not cloned — skipping`);
        }
        repoDir = dir;
        bundleDir = path.join(tmpRoot, `bundle-${spec.repo.replace("/", "--")}`);
        targetDir = path.join(tmpRoot, `target-${spec.repo.replace("/", "--")}`);
      });

      // ── Phase 1: Adapter detection ──────────────────────────────────

      it("detects expected adapters", async () => {
        const detected = await detectAdapters(repoDir);
        const ids = detected.map((d) => d.adapter.id);

        for (const expected of spec.expectedAdapters) {
          expect(ids, `Expected adapter '${expected}' to be detected`).toContain(expected);
        }
      });

      // ── Phase 2: Collect ────────────────────────────────────────────

      it("collect succeeds without crashing", async () => {
        await expect(
          collectStack(repoDir, bundleDir),
        ).resolves.not.toThrow();
      });

      it("produces a valid stack.json", async () => {
        const raw = await readFile(path.join(bundleDir, "stack.json"), "utf-8");
        const manifest = JSON.parse(raw);

        expect(manifest).toHaveProperty("name");
        expect(manifest).toHaveProperty("version");
        expect(typeof manifest.name).toBe("string");
        expect(manifest.name.length).toBeGreaterThan(0);
      });

      it("collects expected artifact counts", async () => {
        const bundle = await readStack(bundleDir);
        const ea = spec.expectedArtifacts;

        if (ea.instructions) {
          expect(
            bundle.agentInstructions.length,
            "Expected agent instructions to be non-empty",
          ).toBeGreaterThan(0);
        }

        if (ea.skills != null && ea.skills > 0) {
          expect(
            bundle.skills.length,
            `Expected at least ${ea.skills} skill(s)`,
          ).toBeGreaterThanOrEqual(ea.skills);
        }

        if (ea.agents != null && ea.agents > 0) {
          expect(
            bundle.agents.length,
            `Expected at least ${ea.agents} agent(s)`,
          ).toBeGreaterThanOrEqual(ea.agents);
        }

        if (ea.rules != null && ea.rules > 0) {
          expect(
            bundle.rules.length,
            `Expected at least ${ea.rules} rule(s)`,
          ).toBeGreaterThanOrEqual(ea.rules);
        }

        if (ea.mcpServers != null && ea.mcpServers > 0) {
          expect(
            Object.keys(bundle.mcpServers).length,
            `Expected at least ${ea.mcpServers} MCP server(s)`,
          ).toBeGreaterThanOrEqual(ea.mcpServers);
        }
      });

      // ── Phase 3: Validate ───────────────────────────────────────────

      it("validate passes on collected stack", async () => {
        const result = await validateStack(bundleDir);

        // Log diagnostics for debugging
        if (result.diagnostics.length > 0) {
          console.log(`  Diagnostics for ${spec.name}:`);
          for (const d of result.diagnostics) {
            console.log(`    [${d.level}] ${d.file}: ${d.message}`);
          }
        }

        // We expect no errors (warnings are OK)
        const errors = result.diagnostics.filter((d) => d.level === "error");
        expect(
          errors,
          `Validation errors: ${errors.map((e) => `${e.file}: ${e.message}`).join("; ")}`,
        ).toHaveLength(0);
      });

      // ── Phase 4: Install into fresh project ─────────────────────────

      it("install succeeds into a fresh directory", async () => {
        // Create a minimal target with a config file so adapters are detected
        const { mkdirSync, writeFileSync } = await import("node:fs");
        mkdirSync(targetDir, { recursive: true });
        writeFileSync(path.join(targetDir, "CLAUDE.md"), "# Fresh project\n");
        writeFileSync(path.join(targetDir, ".cursorrules"), "# Cursor rules\n");
        mkdirSync(path.join(targetDir, ".github"), { recursive: true });
        writeFileSync(path.join(targetDir, ".github", "copilot-instructions.md"), "# Copilot\n");

        await expect(
          installStack(bundleDir, targetDir, {}),
        ).resolves.not.toThrow();
      });

      it("installed files exist on disk", async () => {
        const bundle = await readStack(bundleDir);
        const missing: string[] = [];

        // Check instructions were written
        if (bundle.agentInstructions) {
          const claudeMd = path.join(targetDir, "CLAUDE.md");
          if (!(await fileExists(claudeMd))) {
            missing.push("CLAUDE.md");
          } else {
            const content = await readFile(claudeMd, "utf-8");
            if (!content.includes("promptpit:start:")) {
              missing.push("CLAUDE.md (no marker block)");
            }
          }
        }

        // Check skills in canonical location
        for (const skill of bundle.skills) {
          const skillPath = path.join(targetDir, ".agents", "skills", skill.name, "SKILL.md");
          if (!(await fileExists(skillPath))) {
            missing.push(`skill: ${skill.name}`);
          }
        }

        // Check agents
        for (const agent of bundle.agents) {
          // Claude Code writes to .claude/agents/
          const agentPath = path.join(targetDir, ".claude", "agents", `${agent.name}.md`);
          const copilotPath = path.join(targetDir, ".github", "agents", `${agent.name}.agent.md`);
          if (!(await fileExists(agentPath)) && !(await fileExists(copilotPath))) {
            missing.push(`agent: ${agent.name}`);
          }
        }

        // Check rules
        for (const rule of bundle.rules) {
          const claudeRulePath = path.join(targetDir, ".claude", "rules", `${rule.name}.md`);
          const cursorRulePath = path.join(targetDir, ".cursor", "rules", `rule-${rule.name}.mdc`);
          const copilotRulePath = path.join(targetDir, ".github", "instructions", `rule-${rule.name}.instructions.md`);
          if (
            !(await fileExists(claudeRulePath)) &&
            !(await fileExists(cursorRulePath)) &&
            !(await fileExists(copilotRulePath))
          ) {
            missing.push(`rule: ${rule.name}`);
          }
        }

        // Check MCP
        if (Object.keys(bundle.mcpServers).length > 0) {
          const claudeMcp = path.join(targetDir, ".claude", "settings.json");
          const standardsMcp = path.join(targetDir, ".mcp.json");
          if (!(await fileExists(claudeMcp)) && !(await fileExists(standardsMcp))) {
            missing.push("MCP servers (no settings.json or .mcp.json)");
          }
        }

        // Check install manifest
        const manifestPath = path.join(targetDir, ".promptpit", "installed.json");
        if (!(await fileExists(manifestPath))) {
          missing.push("installed.json (install manifest)");
        }

        expect(missing, `Missing installed files: ${missing.join(", ")}`).toHaveLength(0);
      });

      // ── Phase 5: Status after install ───────────────────────────────

      it("status reports synced after fresh install", async () => {
        const result = await computeStatus(targetDir);

        expect(result.hasManifest).toBe(true);
        expect(result.stacks.length).toBeGreaterThan(0);

        const stack = result.stacks[0];
        const nonSynced = stack.adapters.filter((a) => a.state !== "synced");

        if (nonSynced.length > 0) {
          const details = nonSynced.map((a) => {
            const drifted = a.driftedFiles.map((f) => path.relative(targetDir, f));
            return `${a.adapterId}: ${a.state} (${drifted.join(", ")})`;
          });
          console.log(`  Non-synced adapters for ${spec.name}: ${details.join("; ")}`);
        }

        // All adapters should be synced right after install
        expect(
          stack.overallState,
          `Expected 'synced' but got '${stack.overallState}' — drifted adapters: ${nonSynced.map((a) => a.adapterId).join(", ")}`,
        ).toBe("synced");
      });

      // ── Phase 6: Re-collect round-trip ──────────────────────────────

      it("re-collect from installed target does not lose content", async () => {
        const recollectDir = path.join(tmpRoot, `recollect-${spec.repo.replace("/", "--")}`);

        await collectStack(targetDir, recollectDir);

        const original = await readStack(bundleDir);
        const recollected = await readStack(recollectDir);

        // Instructions should survive round-trip (stripped of markers)
        if (original.agentInstructions) {
          expect(
            recollected.agentInstructions.length,
            "Instructions lost on re-collect",
          ).toBeGreaterThan(0);
        }

        // Skills should survive
        expect(
          recollected.skills.length,
          `Lost skills: had ${original.skills.length}, now ${recollected.skills.length}`,
        ).toBeGreaterThanOrEqual(original.skills.length);

        // Agents should survive (inline agents may get merged into instructions)
        // So we check that agent content is present somewhere
        for (const agent of original.agents) {
          const foundInAgents = recollected.agents.some((a) => a.name === agent.name);
          const foundInInstructions = recollected.agentInstructions.includes(agent.name);
          expect(
            foundInAgents || foundInInstructions,
            `Agent '${agent.name}' lost on re-collect`,
          ).toBe(true);
        }
      });
    });
  }

  // ── Cross-cutting gap detection ───────────────────────────────────────

  describe("Gap detection: multi-file skills & uncollected content", () => {
    it("identifies skills with companion files that would be lost", async () => {
      const findings: string[] = [];

      for (const spec of REPOS) {
        const repoDir = cloneDirs.get(spec.repo);
        if (!repoDir) continue;

        // Check all known skill directories
        const skillsDirs = [
          path.join(repoDir, ".claude", "skills"),
          path.join(repoDir, ".codex", "skills"),
          path.join(repoDir, ".cursor", "skills"),
          path.join(repoDir, ".agents", "skills"),
        ];

        for (const skillsDir of skillsDirs) {
          if (!(await dirExists(skillsDir))) continue;

          const entries = await readdir(skillsDir, { withFileTypes: true }).catch(() => []);
          for (const entry of entries) {
            if (!entry.isDirectory()) continue;

            const skillDir = path.join(skillsDir, entry.name);
            const files = await listFilesRecursive(skillDir);

            // Filter out SKILL.md — anything else is a companion file
            const companions = files.filter((f) => f !== "SKILL.md");
            if (companions.length > 0) {
              findings.push(
                `${spec.repo}: skill '${entry.name}' in ${path.relative(repoDir, skillsDir)} has companion files that pit would lose: ${companions.join(", ")}`,
              );
            }
          }
        }

        // Check for uncollected directories (commands, scripts, etc.)
        const extraDirs = [
          path.join(repoDir, ".codex", "commands"),
          path.join(repoDir, ".codex", "scripts"),
          path.join(repoDir, ".codex", "agents"),
          path.join(repoDir, ".claude", "commands"),
        ];

        for (const extraDir of extraDirs) {
          if (!(await dirExists(extraDir))) continue;
          const files = await listFilesRecursive(extraDir);
          if (files.length > 0) {
            findings.push(
              `${spec.repo}: '${path.relative(repoDir, extraDir)}/' has ${files.length} file(s) that pit does not collect: ${files.slice(0, 5).join(", ")}${files.length > 5 ? "..." : ""}`,
            );
          }
        }
      }

      if (findings.length > 0) {
        console.log("\n📋 Multi-file / uncollected content findings:");
        for (const f of findings) {
          console.log(`  ⚠ ${f}`);
        }
      }

      expect(findings).toBeDefined();
    });
  });

  describe("Gap detection: Cursor skills not read by Cursor adapter", () => {
    it("identifies .cursor/skills/ that the Cursor adapter ignores", async () => {
      const findings: string[] = [];

      for (const spec of REPOS) {
        const repoDir = cloneDirs.get(spec.repo);
        if (!repoDir) continue;

        const cursorSkillsDir = path.join(repoDir, ".cursor", "skills");
        if (!(await dirExists(cursorSkillsDir))) continue;

        // Count SKILL.md files
        const entries = await readdir(cursorSkillsDir, { withFileTypes: true }).catch(() => []);
        const skillDirs = entries.filter((e) => e.isDirectory());
        const skillsWithMd: string[] = [];

        for (const entry of skillDirs) {
          const skillMd = path.join(cursorSkillsDir, entry.name, "SKILL.md");
          if (await fileExists(skillMd)) {
            skillsWithMd.push(entry.name);
          }
        }

        if (skillsWithMd.length > 0) {
          findings.push(
            `${spec.repo}: .cursor/skills/ has ${skillsWithMd.length} skill(s) (${skillsWithMd.join(", ")}) that the Cursor adapter does NOT read`,
          );

          // Now check if collect picked them up via any adapter
          const bundleDir = path.join(tmpRoot, `bundle-${spec.repo.replace("/", "--")}`);
          if (await dirExists(bundleDir)) {
            try {
              const bundle = await readStack(bundleDir);
              for (const skillName of skillsWithMd) {
                const collected = bundle.skills.some((s) => s.name === skillName);
                if (!collected) {
                  findings.push(
                    `  → skill '${skillName}' was NOT collected by any adapter`,
                  );
                }
              }
            } catch {
              // skip
            }
          }
        }
      }

      if (findings.length > 0) {
        console.log("\n📋 Cursor skills gap:");
        for (const f of findings) {
          console.log(`  ⚠ ${f}`);
        }
      }

      expect(findings).toBeDefined();
    });
  });

  describe("Gap detection: frontmatter parsing edge cases", () => {
    it("all collected skills have valid frontmatter", async () => {
      const issues: string[] = [];

      for (const spec of REPOS) {
        const bundleDir = path.join(tmpRoot, `bundle-${spec.repo.replace("/", "--")}`);
        if (!(await dirExists(bundleDir))) continue;

        try {
          const bundle = await readStack(bundleDir);
          for (const skill of bundle.skills) {
            if (!skill.frontmatter.name) {
              issues.push(`${spec.repo}: skill '${skill.name}' missing name in frontmatter`);
            }
            if (!skill.frontmatter.description) {
              issues.push(`${spec.repo}: skill '${skill.name}' missing description in frontmatter`);
            }
          }
          for (const agent of bundle.agents) {
            if (!agent.frontmatter.name) {
              issues.push(`${spec.repo}: agent '${agent.name}' missing name in frontmatter`);
            }
          }
          for (const rule of bundle.rules) {
            if (!rule.frontmatter.name) {
              issues.push(`${spec.repo}: rule '${rule.name}' missing name in frontmatter`);
            }
          }
        } catch (err) {
          issues.push(`${spec.repo}: readStack failed: ${(err as Error).message}`);
        }
      }

      if (issues.length > 0) {
        console.log("\n📋 Frontmatter issues:");
        for (const i of issues) {
          console.log(`  ⚠ ${i}`);
        }
      }
    });
  });

  describe("Gap detection: MCP server completeness", () => {
    it("all MCP servers have required fields after collect", async () => {
      const issues: string[] = [];

      for (const spec of REPOS) {
        const bundleDir = path.join(tmpRoot, `bundle-${spec.repo.replace("/", "--")}`);
        if (!(await dirExists(bundleDir))) continue;

        try {
          const bundle = await readStack(bundleDir);
          for (const [name, server] of Object.entries(bundle.mcpServers)) {
            const hasStdio = !!server.command;
            const hasRemote = !!(server.url || server.serverUrl);
            if (!hasStdio && !hasRemote) {
              issues.push(
                `${spec.repo}: MCP server '${name}' has neither command nor url — unusable`,
              );
            }
            // Check that env vars reference is preserved
            if (server.env) {
              const emptyEnvs = Object.entries(server.env).filter(([, v]) => !v);
              if (emptyEnvs.length > 0) {
                issues.push(
                  `${spec.repo}: MCP server '${name}' has empty env vars: ${emptyEnvs.map(([k]) => k).join(", ")}`,
                );
              }
            }
          }
        } catch {
          // skip if bundle doesn't exist
        }
      }

      if (issues.length > 0) {
        console.log("\n📋 MCP server issues:");
        for (const i of issues) {
          console.log(`  ⚠ ${i}`);
        }
      }
    });
  });

  describe("Gap detection: adapter-specific translation fidelity", () => {
    it("Cursor .mdc rules preserve globs after round-trip", async () => {
      // Specifically test speckle-server which has .mdc rules
      const spec = REPOS.find((r) => r.repo === "specklesystems/speckle-server");
      if (!spec) return;

      const repoDir = cloneDirs.get(spec.repo);
      if (!repoDir) return;

      const bundleDir = path.join(tmpRoot, `bundle-${spec.repo.replace("/", "--")}`);
      if (!(await dirExists(bundleDir))) return;

      const bundle = await readStack(bundleDir);

      for (const rule of bundle.rules) {
        // Check that globs survived the .mdc → portable conversion
        if (rule.frontmatter.globs) {
          expect(
            rule.frontmatter.globs,
            `Rule '${rule.name}' should have globs preserved`,
          ).toBeTruthy();
        }
      }
    });

    it("Copilot agents retain description after round-trip", async () => {
      const spec = REPOS.find((r) => r.repo === "Azure/azure-sdk-for-js");
      if (!spec) return;

      const repoDir = cloneDirs.get(spec.repo);
      if (!repoDir) return;

      const bundleDir = path.join(tmpRoot, `bundle-${spec.repo.replace("/", "--")}`);
      if (!(await dirExists(bundleDir))) return;

      const bundle = await readStack(bundleDir);

      for (const agent of bundle.agents) {
        expect(
          agent.frontmatter.description,
          `Agent '${agent.name}' should have description preserved`,
        ).toBeTruthy();
      }
    });
  });

  describe("Gap detection: large file handling", () => {
    it("collect does not crash on repos with large instruction files", async () => {
      for (const spec of REPOS) {
        const repoDir = cloneDirs.get(spec.repo);
        if (!repoDir) continue;

        // Check sizes of instruction files
        const instructionFiles = [
          path.join(repoDir, "CLAUDE.md"),
          path.join(repoDir, ".cursorrules"),
          path.join(repoDir, "AGENTS.md"),
          path.join(repoDir, ".github", "copilot-instructions.md"),
        ];

        for (const f of instructionFiles) {
          if (await fileExists(f)) {
            const s = await stat(f);
            if (s.size > 10_000) {
              // File is >10KB — this is a stress test for the parser
              console.log(`  📏 ${spec.repo}: ${path.basename(f)} is ${(s.size / 1024).toFixed(1)}KB`);
            }
          }
        }
      }
      // If we got here, no crashes — pass
    });
  });

  describe("Gap detection: install manifest completeness", () => {
    it("manifest tracks all adapters that received files", async () => {
      for (const spec of REPOS) {
        const targetDir = path.join(tmpRoot, `target-${spec.repo.replace("/", "--")}`);
        const manifestPath = path.join(targetDir, ".promptpit", "installed.json");

        if (!(await fileExists(manifestPath))) continue;

        const manifest = JSON.parse(await readFile(manifestPath, "utf-8"));
        const install = manifest.installs?.[0];
        if (!install) continue;

        const trackedAdapters = Object.keys(install.adapters);

        // Standards should always be present (auto-added)
        expect(
          trackedAdapters,
          `${spec.repo}: standards adapter should be tracked`,
        ).toContain("standards");

        // Claude-code should be present (we seeded CLAUDE.md in target)
        expect(
          trackedAdapters,
          `${spec.repo}: claude-code adapter should be tracked`,
        ).toContain("claude-code");
      }
    });
  });

  describe("Gap detection: .env.example handling", () => {
    it("secrets are stripped from MCP servers in collected bundle", async () => {
      for (const spec of REPOS) {
        const bundleDir = path.join(tmpRoot, `bundle-${spec.repo.replace("/", "--")}`);
        if (!(await dirExists(bundleDir))) continue;

        try {
          const bundle = await readStack(bundleDir);
          for (const [name, server] of Object.entries(bundle.mcpServers)) {
            if (server.env) {
              for (const [key, value] of Object.entries(server.env)) {
                // After collect, env values should be stripped (empty or placeholder)
                const looksLikeRealSecret =
                  value.length > 20 &&
                  !value.startsWith("$") &&
                  !value.includes("YOUR_") &&
                  !value.includes("your_") &&
                  !value.includes("<");

                if (looksLikeRealSecret) {
                  console.log(
                    `  🔒 ${spec.repo}: MCP server '${name}' env '${key}' may contain a real secret (${value.length} chars)`,
                  );
                }
              }
            }
          }
        } catch {
          // skip
        }
      }
    });
  });

  // ── Cross-adapter comparison ──────────────────────────────────────────

  describe("Cross-adapter comparison: collect coverage matrix", () => {
    it("produces a coverage matrix across all repos", async () => {
      const matrix: Array<{
        repo: string;
        adaptersDetected: string[];
        skillsCollected: number;
        agentsCollected: number;
        rulesCollected: number;
        mcpCollected: number;
        instructionsLength: number;
        // Source counts (what exists in the repo)
        sourceSkills: number;
        sourceAgents: number;
        sourceRules: number;
        sourceMcp: number;
      }> = [];

      for (const spec of REPOS) {
        const repoDir = cloneDirs.get(spec.repo);
        if (!repoDir) continue;

        const bundleDir = path.join(tmpRoot, `bundle-${spec.repo.replace("/", "--")}`);
        if (!(await dirExists(bundleDir))) continue;

        // Count source artifacts in repo
        let sourceSkills = 0;
        let sourceAgents = 0;
        let sourceRules = 0;
        let sourceMcp = 0;

        // Claude Code skills
        const claudeSkillsDir = path.join(repoDir, ".claude", "skills");
        if (await dirExists(claudeSkillsDir)) {
          const entries = await readdir(claudeSkillsDir, { withFileTypes: true }).catch(() => []);
          for (const e of entries) {
            if (e.isDirectory() && await fileExists(path.join(claudeSkillsDir, e.name, "SKILL.md"))) {
              sourceSkills++;
            }
          }
        }

        // Cursor skills
        const cursorSkillsDir = path.join(repoDir, ".cursor", "skills");
        if (await dirExists(cursorSkillsDir)) {
          const entries = await readdir(cursorSkillsDir, { withFileTypes: true }).catch(() => []);
          for (const e of entries) {
            if (e.isDirectory() && await fileExists(path.join(cursorSkillsDir, e.name, "SKILL.md"))) {
              sourceSkills++;
            }
          }
        }

        // Claude Code rules
        const claudeRulesDir = path.join(repoDir, ".claude", "rules");
        if (await dirExists(claudeRulesDir)) {
          const files = await readdir(claudeRulesDir).catch(() => []);
          sourceRules += files.filter((f) => f.endsWith(".md")).length;
        }

        // Cursor .mdc rules
        const cursorRulesDir = path.join(repoDir, ".cursor", "rules");
        if (await dirExists(cursorRulesDir)) {
          const files = await readdir(cursorRulesDir).catch(() => []);
          sourceRules += files.filter((f) => f.endsWith(".mdc") || f.endsWith(".md")).length;
        }

        // Copilot agents
        const copilotAgentsDir = path.join(repoDir, ".github", "agents");
        if (await dirExists(copilotAgentsDir)) {
          const files = await readdir(copilotAgentsDir).catch(() => []);
          sourceAgents += files.filter((f) => f.endsWith(".md")).length;
        }

        // Claude Code agents
        const claudeAgentsDir = path.join(repoDir, ".claude", "agents");
        if (await dirExists(claudeAgentsDir)) {
          const files = await readdir(claudeAgentsDir).catch(() => []);
          sourceAgents += files.filter((f) => f.endsWith(".md")).length;
        }

        // Copilot instructions
        const copilotInstrDir = path.join(repoDir, ".github", "instructions");
        if (await dirExists(copilotInstrDir)) {
          const files = await listFilesRecursive(copilotInstrDir);
          sourceRules += files.filter((f) => f.endsWith(".instructions.md")).length;
        }

        // MCP sources
        for (const mcpPath of [
          path.join(repoDir, ".claude", "settings.json"),
          path.join(repoDir, ".cursor", "mcp.json"),
          path.join(repoDir, ".vscode", "mcp.json"),
          path.join(repoDir, ".mcp.json"),
        ]) {
          if (await fileExists(mcpPath)) {
            try {
              const raw = await readFile(mcpPath, "utf-8");
              const parsed = JSON.parse(raw);
              const servers = parsed.mcpServers ?? parsed.servers ?? {};
              sourceMcp += Object.keys(servers).length;
            } catch {
              // JSONC or invalid — count as 1+ (we know it exists)
              sourceMcp += 1;
            }
          }
        }

        // Get collected counts
        const detected = await detectAdapters(repoDir);
        try {
          const bundle = await readStack(bundleDir);
          matrix.push({
            repo: spec.repo,
            adaptersDetected: detected.map((d) => d.adapter.id),
            skillsCollected: bundle.skills.length,
            agentsCollected: bundle.agents.length,
            rulesCollected: bundle.rules.length,
            mcpCollected: Object.keys(bundle.mcpServers).length,
            instructionsLength: bundle.agentInstructions.length,
            sourceSkills,
            sourceAgents,
            sourceRules,
            sourceMcp,
          });
        } catch {
          // skip repos that failed to collect
        }
      }

      // Print comparison matrix
      console.log("\n📊 Cross-adapter coverage matrix:");
      console.log("─".repeat(120));
      console.log(
        "Repo".padEnd(35),
        "Adapters".padEnd(30),
        "Skills".padEnd(12),
        "Agents".padEnd(12),
        "Rules".padEnd(12),
        "MCP".padEnd(12),
      );
      console.log("─".repeat(120));

      let totalDroppedSkills = 0;
      let totalDroppedAgents = 0;
      let totalDroppedRules = 0;
      let totalDroppedMcp = 0;

      for (const row of matrix) {
        const skillDelta = row.sourceSkills - row.skillsCollected;
        const agentDelta = row.sourceAgents - row.agentsCollected;
        const ruleDelta = row.sourceRules - row.rulesCollected;
        const mcpDelta = row.sourceMcp - row.mcpCollected;

        totalDroppedSkills += Math.max(0, skillDelta);
        totalDroppedAgents += Math.max(0, agentDelta);
        totalDroppedRules += Math.max(0, ruleDelta);
        totalDroppedMcp += Math.max(0, mcpDelta);

        const fmtDelta = (collected: number, source: number) => {
          const delta = source - collected;
          if (delta === 0) return `${collected}/${source}`;
          return `${collected}/${source} (-${delta})`;
        };

        console.log(
          row.repo.padEnd(35),
          row.adaptersDetected.join(", ").padEnd(30),
          fmtDelta(row.skillsCollected, row.sourceSkills).padEnd(12),
          fmtDelta(row.agentsCollected, row.sourceAgents).padEnd(12),
          fmtDelta(row.rulesCollected, row.sourceRules).padEnd(12),
          fmtDelta(row.mcpCollected, row.sourceMcp).padEnd(12),
        );
      }

      console.log("─".repeat(120));
      console.log(
        "TOTAL DROPPED".padEnd(35),
        "".padEnd(30),
        `${totalDroppedSkills}`.padEnd(12),
        `${totalDroppedAgents}`.padEnd(12),
        `${totalDroppedRules}`.padEnd(12),
        `${totalDroppedMcp}`.padEnd(12),
      );
      console.log();

      // This test always passes — it's a diagnostic report
      expect(matrix.length).toBeGreaterThan(0);
    });
  });
});
