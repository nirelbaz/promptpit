import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, readFile, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { writeWithMarkers, readAgentsFromDir, readSkillsFromDir, readRulesFromDir, readMcpFromSettings, formatAgentsInlineSection, buildInlineContent, readCommandsFromDir, detectCommandParamSyntax } from "../../src/adapters/adapter-utils.js";
import type { AgentEntry } from "../../src/shared/schema.js";

describe("writeWithMarkers", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(path.join(tmpdir(), "pit-markers-"));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("creates file with markers when no existing file", async () => {
    const filePath = path.join(tmpDir, "CLAUDE.md");
    const result = await writeWithMarkers(
      filePath,
      "New instructions",
      "my-stack",
      "1.0.0",
      "claude-code",
    );
    expect(result.written).toBe(filePath);
    expect(result.existed).toBe(false);
    expect(result.content).toContain("promptpit:start:my-stack:1.0.0:claude-code");
    expect(result.content).toContain("New instructions");
    const content = await readFile(filePath, "utf-8");
    expect(content).toContain("promptpit:start:my-stack:1.0.0:claude-code");
    expect(content).toContain("New instructions");
    expect(content).toContain("promptpit:end:my-stack");
  });

  it("inserts markers when existing file has no markers", async () => {
    const filePath = path.join(tmpDir, "CLAUDE.md");
    await writeFile(filePath, "# Existing content\n\nKeep this.\n");
    const result = await writeWithMarkers(
      filePath,
      "Stack instructions",
      "my-stack",
      "1.0.0",
      "claude-code",
    );
    expect(result.written).toBe(filePath);
    expect(result.existed).toBe(true);
    expect(result.content).toContain("# Existing content");
    expect(result.content).toContain("Stack instructions");
    const content = await readFile(filePath, "utf-8");
    expect(content).toContain("# Existing content");
    expect(content).toContain("Keep this.");
    expect(content).toContain("promptpit:start:my-stack:1.0.0:claude-code");
    expect(content).toContain("Stack instructions");
  });

  it("replaces marker content when existing file has markers", async () => {
    const filePath = path.join(tmpDir, "CLAUDE.md");
    await writeFile(
      filePath,
      "# Header\n\n<!-- promptpit:start:my-stack:0.9.0:claude-code -->\nOld content\n<!-- promptpit:end:my-stack -->\n",
    );
    const result = await writeWithMarkers(
      filePath,
      "Updated content",
      "my-stack",
      "1.0.0",
      "claude-code",
    );
    expect(result.written).toBe(filePath);
    expect(result.existed).toBe(true);
    expect(result.oldContent).toContain("Old content");
    expect(result.content).toContain("Updated content");
    expect(result.content).not.toContain("Old content");
  });

  it("skips write when dryRun is true", async () => {
    const filePath = path.join(tmpDir, "CLAUDE.md");
    const result = await writeWithMarkers(
      filePath,
      "Content",
      "my-stack",
      "1.0.0",
      "claude-code",
      true,
    );
    expect(result.written).toBeNull();
    expect(result.existed).toBe(false);
    expect(result.content).toContain("promptpit:start:my-stack");
    await expect(readFile(filePath, "utf-8")).rejects.toThrow();
  });

  it("returns oldContent for verbose dry-run diffs", async () => {
    const filePath = path.join(tmpDir, "CLAUDE.md");
    await writeFile(filePath, "# Old\n");
    const result = await writeWithMarkers(
      filePath,
      "new content",
      "s",
      "1.0",
      "a",
      true,
    );
    expect(result.written).toBeNull();
    expect(result.existed).toBe(true);
    expect(result.oldContent).toBe("# Old\n");
    expect(result.content).toContain("new content");
    // File should not be modified
    const onDisk = await readFile(filePath, "utf-8");
    expect(onDisk).toBe("# Old\n");
  });

  it("handles empty content string", async () => {
    const filePath = path.join(tmpDir, "CLAUDE.md");
    const result = await writeWithMarkers(
      filePath,
      "",
      "my-stack",
      "1.0.0",
      "claude-code",
    );
    expect(result.written).toBe(filePath);
    const content = await readFile(filePath, "utf-8");
    expect(content).toContain("promptpit:start:my-stack");
    expect(content).toContain("promptpit:end:my-stack");
  });
});

describe("skillFrontmatterSchema validation", () => {
  // Import the schema directly for unit-level validation tests
  let skillFrontmatterSchema: typeof import("../../src/shared/schema.js").skillFrontmatterSchema;

  beforeEach(async () => {
    skillFrontmatterSchema = (await import("../../src/shared/schema.js")).skillFrontmatterSchema;
  });

  it("accepts valid lowercase-hyphenated name", () => {
    const result = skillFrontmatterSchema.safeParse({ name: "my-skill", description: "A skill" });
    expect(result.success).toBe(true);
  });

  it("accepts single-char name", () => {
    const result = skillFrontmatterSchema.safeParse({ name: "a", description: "A skill" });
    expect(result.success).toBe(true);
  });

  it("rejects name with uppercase letters", () => {
    const result = skillFrontmatterSchema.safeParse({ name: "MySkill", description: "A skill" });
    expect(result.success).toBe(false);
  });

  it("rejects name longer than 64 chars", () => {
    const result = skillFrontmatterSchema.safeParse({ name: "a".repeat(65), description: "A skill" });
    expect(result.success).toBe(false);
  });

  it("rejects name with underscores", () => {
    const result = skillFrontmatterSchema.safeParse({ name: "my_skill", description: "A skill" });
    expect(result.success).toBe(false);
  });

  it("rejects name with spaces", () => {
    const result = skillFrontmatterSchema.safeParse({ name: "my skill", description: "A skill" });
    expect(result.success).toBe(false);
  });

  it("rejects name starting with hyphen", () => {
    const result = skillFrontmatterSchema.safeParse({ name: "-my-skill", description: "A skill" });
    expect(result.success).toBe(false);
  });

  it("rejects description longer than 1024 chars", () => {
    const result = skillFrontmatterSchema.safeParse({ name: "ok", description: "x".repeat(1025) });
    expect(result.success).toBe(false);
  });

  it("accepts description at exactly 1024 chars", () => {
    const result = skillFrontmatterSchema.safeParse({ name: "ok", description: "x".repeat(1024) });
    expect(result.success).toBe(true);
  });
});

describe("readSkillsFromDir", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(path.join(tmpdir(), "pit-skills-"));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("reads */SKILL.md directory-based skills", async () => {
    await mkdir(path.join(tmpDir, "my-skill"), { recursive: true });
    await writeFile(
      path.join(tmpDir, "my-skill", "SKILL.md"),
      "---\nname: my-skill\ndescription: A skill\n---\n\nDo things.\n",
    );
    const skills = await readSkillsFromDir(tmpDir);
    expect(skills).toHaveLength(1);
    expect(skills[0]!.name).toBe("my-skill");
  });

  it("does NOT read standalone .md files by default", async () => {
    await writeFile(
      path.join(tmpDir, "review-upstream-merge.md"),
      "---\nname: review-upstream-merge\ndescription: Review upstream merges\n---\n\nReview upstream merge PRs.\n",
    );
    const skills = await readSkillsFromDir(tmpDir);
    expect(skills).toHaveLength(0);
  });

  it("reads standalone .md skill files when includeStandalone is true", async () => {
    await writeFile(
      path.join(tmpDir, "review-upstream-merge.md"),
      "---\nname: review-upstream-merge\ndescription: Review upstream merges\n---\n\nReview upstream merge PRs.\n",
    );
    const skills = await readSkillsFromDir(tmpDir, { includeStandalone: true });
    expect(skills).toHaveLength(1);
    expect(skills[0]!.name).toBe("review-upstream-merge");
    expect(skills[0]!.content).toContain("Review upstream merge PRs.");
  });

  it("reads both directory-based and standalone skills when includeStandalone is true", async () => {
    await mkdir(path.join(tmpDir, "qa"), { recursive: true });
    await writeFile(
      path.join(tmpDir, "qa", "SKILL.md"),
      "---\nname: qa\ndescription: QA skill\n---\n\nRun QA.\n",
    );
    await writeFile(
      path.join(tmpDir, "review-merge.md"),
      "---\nname: review-merge\ndescription: Review merges\n---\n\nReview.\n",
    );
    const skills = await readSkillsFromDir(tmpDir, { includeStandalone: true });
    expect(skills).toHaveLength(2);
    const names = skills.map((s) => s.name).sort();
    expect(names).toEqual(["qa", "review-merge"]);
  });

  it("prefers directory-based SKILL.md over standalone .md with same name", async () => {
    await mkdir(path.join(tmpDir, "qa"), { recursive: true });
    await writeFile(
      path.join(tmpDir, "qa", "SKILL.md"),
      "---\nname: qa\ndescription: QA directory skill\n---\n\nDirectory version.\n",
    );
    await writeFile(
      path.join(tmpDir, "qa.md"),
      "---\nname: qa\ndescription: QA standalone skill\n---\n\nStandalone version.\n",
    );
    const skills = await readSkillsFromDir(tmpDir, { includeStandalone: true });
    expect(skills).toHaveLength(1);
    expect(skills[0]!.content).toContain("Directory version.");
  });

  it("returns empty array for missing directory", async () => {
    const skills = await readSkillsFromDir("/tmp/nonexistent-skills-" + Date.now());
    expect(skills).toEqual([]);
  });

  it("collects supporting files from skill directories", async () => {
    await mkdir(path.join(tmpDir, "my-skill", "scripts"), { recursive: true });
    await mkdir(path.join(tmpDir, "my-skill", "references"), { recursive: true });
    await writeFile(
      path.join(tmpDir, "my-skill", "SKILL.md"),
      "---\nname: my-skill\ndescription: A skill\n---\n\nDo things.\n",
    );
    await writeFile(
      path.join(tmpDir, "my-skill", "scripts", "setup.sh"),
      "#!/bin/sh\necho hello\n",
    );
    await writeFile(
      path.join(tmpDir, "my-skill", "references", "api.md"),
      "# API\nEndpoints.\n",
    );
    const skills = await readSkillsFromDir(tmpDir);
    expect(skills).toHaveLength(1);
    expect(skills[0]!.supportingFiles).toBeDefined();
    expect(skills[0]!.supportingFiles).toHaveLength(2);
    const paths = skills[0]!.supportingFiles!.map((f) => f.relativePath).sort();
    expect(paths).toEqual(["references/api.md", "scripts/setup.sh"]);
    // Content should be Buffers
    for (const f of skills[0]!.supportingFiles!) {
      expect(Buffer.isBuffer(f.content)).toBe(true);
    }
  });

  it("does not include SKILL.md in supporting files", async () => {
    await mkdir(path.join(tmpDir, "my-skill"), { recursive: true });
    await writeFile(
      path.join(tmpDir, "my-skill", "SKILL.md"),
      "---\nname: my-skill\ndescription: A skill\n---\n\nDo things.\n",
    );
    const skills = await readSkillsFromDir(tmpDir);
    expect(skills).toHaveLength(1);
    const hasSKILLmd = skills[0]!.supportingFiles?.some((f) => f.relativePath === "SKILL.md");
    expect(hasSKILLmd ?? false).toBe(false);
  });

  it("standalone skills have no supportingFiles", async () => {
    await writeFile(
      path.join(tmpDir, "review.md"),
      "---\nname: review\ndescription: Review things\n---\n\nReview.\n",
    );
    const skills = await readSkillsFromDir(tmpDir, { includeStandalone: true });
    expect(skills).toHaveLength(1);
    expect(skills[0]!.supportingFiles).toBeUndefined();
  });
});

describe("readAgentsFromDir", () => {
  it("reads agent files from a directory", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "pit-agents-"));
    await writeFile(
      path.join(dir, "reviewer.md"),
      "---\nname: reviewer\ndescription: Code review agent\ntools:\n  - Read\n  - Grep\n---\n\nReview code carefully.\n",
    );
    const agents = await readAgentsFromDir(dir);
    expect(agents).toHaveLength(1);
    expect(agents[0]!.name).toBe("reviewer");
    expect(agents[0]!.path).toBe("agents/reviewer");
    expect(agents[0]!.frontmatter.description).toBe("Code review agent");
    expect(agents[0]!.frontmatter.tools).toEqual(["Read", "Grep"]);
    expect(agents[0]!.content).toContain("Review code carefully.");
    await rm(dir, { recursive: true });
  });

  it("preserves adapter-specific fields via passthrough (e.g., handoffs)", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "pit-agents-passthrough-"));
    await writeFile(
      path.join(dir, "router.md"),
      "---\nname: router\ndescription: Routes tasks\ntools:\n  - read\nhandoffs:\n  - coder\n  - reviewer\ndisable-model-invocation: true\n---\n\nRoute tasks to agents.\n",
    );
    const agents = await readAgentsFromDir(dir);
    expect(agents).toHaveLength(1);
    const fm = agents[0]!.frontmatter as Record<string, unknown>;
    expect(fm.handoffs).toEqual(["coder", "reviewer"]);
    expect(fm["disable-model-invocation"]).toBe(true);
    await rm(dir, { recursive: true });
  });

  it("returns empty array for missing directory", async () => {
    const agents = await readAgentsFromDir("/tmp/nonexistent-agents-dir-" + Date.now());
    expect(agents).toEqual([]);
  });

  it("infers description from body when missing in frontmatter", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "pit-agents-"));
    await writeFile(path.join(dir, "bad.md"), "---\nname: bad\n---\n\nNo description.\n");
    const agents = await readAgentsFromDir(dir);
    expect(agents).toHaveLength(1);
    expect(agents[0]!.name).toBe("bad");
    expect(agents[0]!.frontmatter.description).toBe("No description.");
    await rm(dir, { recursive: true });
  });

  it("infers name from filename and rebuilds content when both name and description missing", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "pit-agents-infer-"));
    await writeFile(path.join(dir, "my-agent.md"), "---\ntools:\n  - Read\n---\n\nDoes things.\n");
    const agents = await readAgentsFromDir(dir);
    expect(agents).toHaveLength(1);
    expect(agents[0]!.name).toBe("my-agent");
    expect(agents[0]!.frontmatter.name).toBe("my-agent");
    expect(agents[0]!.frontmatter.description).toBe("Does things.");
    // Content should be rebuilt with inferred frontmatter
    expect(agents[0]!.content).toContain("name: my-agent");
    expect(agents[0]!.content).toContain("description: Does things.");
    await rm(dir, { recursive: true });
  });

  it("skips heading lines when inferring description", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "pit-agents-heading-"));
    await writeFile(path.join(dir, "reviewer.md"), "---\ntools:\n  - Read\n---\n\n# Reviewer Agent\n\nReviews code carefully.\n");
    const agents = await readAgentsFromDir(dir);
    expect(agents).toHaveLength(1);
    expect(agents[0]!.frontmatter.description).toBe("Reviews code carefully.");
    await rm(dir, { recursive: true });
  });

  it("reads multiple agent files from a directory", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "pit-agents-multi-"));
    await writeFile(
      path.join(dir, "reviewer.md"),
      "---\nname: reviewer\ndescription: Code reviewer\ntools:\n  - Read\n---\n\nReview code.\n",
    );
    await writeFile(
      path.join(dir, "helper.md"),
      "---\nname: helper\ndescription: General helper\n---\n\nHelp with tasks.\n",
    );
    const agents = await readAgentsFromDir(dir);
    expect(agents).toHaveLength(2);
    const names = agents.map((a) => a.name).sort();
    expect(names).toEqual(["helper", "reviewer"]);
    await rm(dir, { recursive: true });
  });

  it("reads agent file with no frontmatter as plain markdown (stripFrontmatter else branch)", async () => {
    // An agent that has valid frontmatter but whose body has no fences —
    // formatAgentsInlineSection calls stripFrontmatter which hits the else branch
    // when there is no leading --- block in the body content.
    const agents: AgentEntry[] = [
      {
        name: "plain",
        path: "agents/plain",
        frontmatter: { name: "plain", description: "Plain agent" },
        // content has no frontmatter fences — stripFrontmatter gets raw.trim() fallback
        content: "Just plain markdown with no frontmatter block.",
      },
    ];
    const result = formatAgentsInlineSection(agents);
    expect(result).toContain("### plain");
    expect(result).toContain("Plain agent");
    expect(result).toContain("Just plain markdown with no frontmatter block.");
  });
});

describe("buildInlineContent", () => {
  const sampleAgent: AgentEntry = {
    name: "helper",
    path: "agents/helper",
    frontmatter: { name: "helper", description: "General helper" },
    content: "---\nname: helper\ndescription: General helper\n---\n\nHelp with tasks.\n",
  };

  it("returns null when both instructions and agents are empty", () => {
    expect(buildInlineContent("", [])).toBeNull();
  });

  it("returns instructions-only content when agents array is empty", () => {
    const result = buildInlineContent("Use TypeScript.", []);
    expect(result).toBe("Use TypeScript.");
  });

  it("returns agents-only section when agentInstructions is empty string (else branch)", () => {
    // This exercises the else branch: agentInstructions is falsy, so content starts as ""
    // then gets replaced by the agentSection alone.
    const result = buildInlineContent("", [sampleAgent]);
    expect(result).not.toBeNull();
    expect(result).toContain("## Custom Agents");
    expect(result).toContain("### helper");
    // Must not start with a newline separator since there were no instructions
    expect(result!.startsWith("## Custom Agents")).toBe(true);
  });

  it("concatenates instructions and agents section when both are present", () => {
    const result = buildInlineContent("Use TypeScript.", [sampleAgent]);
    expect(result).toContain("Use TypeScript.");
    expect(result).toContain("## Custom Agents");
    // Instructions come before agents
    expect(result!.indexOf("Use TypeScript.")).toBeLessThan(result!.indexOf("## Custom Agents"));
  });
});

describe("formatAgentsInlineSection", () => {
  it("formats agents as markdown section", () => {
    const agents: AgentEntry[] = [
      {
        name: "reviewer",
        path: "agents/reviewer",
        frontmatter: { name: "reviewer", description: "Code review agent", tools: ["Read", "Grep"] },
        content: "---\nname: reviewer\ndescription: Code review agent\ntools:\n  - Read\n  - Grep\n---\n\nReview code carefully.\n",
      },
    ];
    const result = formatAgentsInlineSection(agents);
    expect(result).toContain("## Custom Agents");
    expect(result).toContain("### reviewer");
    expect(result).toContain("Code review agent");
    expect(result).toContain("Tools: Read, Grep");
    expect(result).toContain("Review code carefully.");
  });

  it("formats agent without tools", () => {
    const agents: AgentEntry[] = [
      {
        name: "helper",
        path: "agents/helper",
        frontmatter: { name: "helper", description: "General helper" },
        content: "---\nname: helper\ndescription: General helper\n---\n\nHelp with tasks.\n",
      },
    ];
    const result = formatAgentsInlineSection(agents);
    expect(result).toContain("### helper");
    expect(result).toContain("General helper");
    expect(result).not.toContain("Tools:");
    expect(result).toContain("Help with tasks.");
  });

  it("returns empty string for empty array", () => {
    const result = formatAgentsInlineSection([]);
    expect(result).toBe("");
  });
});

describe("readMcpFromSettings", () => {
  let dir: string;
  beforeEach(async () => { dir = await mkdtemp(path.join(tmpdir(), "pit-mcp-")); });
  afterEach(async () => { await rm(dir, { recursive: true, force: true }); });

  it("parses JSONC with line and block comments", async () => {
    const jsonc = `{
  // Line comment
  "mcpServers": {
    /* Block comment */
    "filesystem": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem"]
    }
  }
}`;
    const file = path.join(dir, "mcp.json");
    await writeFile(file, jsonc);
    const result = await readMcpFromSettings(file);
    expect(result).toHaveProperty("filesystem");
    expect((result as Record<string, Record<string, unknown>>).filesystem.command).toBe("npx");
  });

  it("returns empty object for missing file", async () => {
    const result = await readMcpFromSettings(path.join(dir, "nonexistent.json"));
    expect(result).toEqual({});
  });
});

describe("readCommandsFromDir", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(path.join(tmpdir(), "pit-commands-"));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("reads flat .md files", async () => {
    await writeFile(path.join(tmpDir, "review.md"), "Review this code: $ARGUMENTS");
    await writeFile(path.join(tmpDir, "deploy.md"), "Deploy to production");
    const commands = await readCommandsFromDir(tmpDir);
    expect(commands).toHaveLength(2);
    const names = commands.map((c) => c.name).sort();
    expect(names).toEqual(["deploy", "review"]);
  });

  it("reads nested directories preserving path", async () => {
    await mkdir(path.join(tmpDir, "dev"), { recursive: true });
    await writeFile(path.join(tmpDir, "dev", "start.md"), "Start dev server");
    await writeFile(path.join(tmpDir, "dev", "test.md"), "Run tests");
    const commands = await readCommandsFromDir(tmpDir);
    expect(commands).toHaveLength(2);
    const names = commands.map((c) => c.name).sort();
    expect(names).toEqual(["dev/start", "dev/test"]);
  });

  it("reads deeply nested directories", async () => {
    await mkdir(path.join(tmpDir, "team", "backend"), { recursive: true });
    await writeFile(path.join(tmpDir, "team", "backend", "deploy.md"), "Deploy backend");
    const commands = await readCommandsFromDir(tmpDir);
    expect(commands).toHaveLength(1);
    expect(commands[0]!.name).toBe("team/backend/deploy");
    expect(commands[0]!.path).toBe("commands/team/backend/deploy");
  });

  it("returns empty array for missing directory", async () => {
    const commands = await readCommandsFromDir(path.join(tmpDir, "nonexistent"));
    expect(commands).toEqual([]);
  });

  it("returns empty array for empty directory", async () => {
    const commands = await readCommandsFromDir(tmpDir);
    expect(commands).toEqual([]);
  });

  it("reads .prompt.md files when ext option is provided", async () => {
    await writeFile(path.join(tmpDir, "review.prompt.md"), "---\ndescription: Review code\n---\nReview this");
    const commands = await readCommandsFromDir(tmpDir, { glob: "**/*.prompt.md", ext: ".prompt.md" });
    expect(commands).toHaveLength(1);
    expect(commands[0]!.name).toBe("review");
  });

  it("falls back to path.extname when file extension does not match the provided ext", async () => {
    // glob pattern matches .md but ext option is .prompt.md — the file does NOT end with .prompt.md
    // so the code falls back to relPath.slice(0, -path.extname(relPath).length)
    await writeFile(path.join(tmpDir, "deploy.md"), "Deploy the app");
    // Use a glob that matches .md but ext that does NOT match — exercises the else branch
    const commands = await readCommandsFromDir(tmpDir, { glob: "**/*.md", ext: ".prompt.md" });
    expect(commands).toHaveLength(1);
    // Name should be stripped of the actual extension (.md), not the provided ext
    expect(commands[0]!.name).toBe("deploy");
  });
});

describe("malformed YAML frontmatter handling", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(path.join(tmpdir(), "pit-malformed-yaml-"));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("readAgentsFromDir skips agents with unparseable YAML instead of crashing", async () => {
    // Real-world case: description with unescaped colons on a single line
    await writeFile(
      path.join(tmpDir, "bad-agent.md"),
      '---\nname: bad\ndescription: Use this agent when:\\nuser: "hello"\\nassistant: "hi"\nmodel: opus\ncolor: yellow\n---\n\nBody.\n',
    );
    await writeFile(
      path.join(tmpDir, "good-agent.md"),
      "---\nname: good\ndescription: A valid agent\n---\n\nWorks fine.\n",
    );
    const agents = await readAgentsFromDir(tmpDir);
    expect(agents).toHaveLength(1);
    expect(agents[0]!.name).toBe("good-agent");
  });

  it("readSkillsFromDir skips skills with unparseable YAML instead of crashing", async () => {
    await mkdir(path.join(tmpDir, "bad-skill"), { recursive: true });
    await writeFile(
      path.join(tmpDir, "bad-skill", "SKILL.md"),
      '---\nname: bad\ndescription: example:\\nuser: "test"\n---\n\nBody.\n',
    );
    await mkdir(path.join(tmpDir, "good-skill"), { recursive: true });
    await writeFile(
      path.join(tmpDir, "good-skill", "SKILL.md"),
      "---\nname: good-skill\ndescription: A valid skill\n---\n\nWorks.\n",
    );
    const skills = await readSkillsFromDir(tmpDir);
    expect(skills).toHaveLength(1);
    expect(skills[0]!.name).toBe("good-skill");
  });

  it("readRulesFromDir skips rules with unparseable YAML instead of crashing", async () => {
    await writeFile(
      path.join(tmpDir, "bad-rule.md"),
      '---\nname: bad\nglobs: pattern:\\nuser: "test"\n---\n\nBody.\n',
    );
    await writeFile(
      path.join(tmpDir, "good-rule.md"),
      "---\nname: good\ndescription: A valid rule\n---\n\nWorks.\n",
    );
    const rules = await readRulesFromDir(tmpDir);
    expect(rules).toHaveLength(1);
    expect(rules[0]!.name).toBe("good-rule");
  });
});

describe("detectCommandParamSyntax", () => {
  it("detects Claude Code $ARGUMENTS", () => {
    expect(detectCommandParamSyntax("Review: $ARGUMENTS")).toBe("claude-code");
  });

  it("detects Cursor positional $1", () => {
    expect(detectCommandParamSyntax("Deploy $1 to $2")).toBe("cursor");
  });

  it("detects Copilot ${input:x}", () => {
    expect(detectCommandParamSyntax("Review ${input:file}")).toBe("copilot");
  });

  it("returns null for no params", () => {
    expect(detectCommandParamSyntax("Just do the thing")).toBeNull();
  });
});
