import { describe, it, expect, afterEach, vi, beforeEach } from "vitest";
import { printDryRunReport, log, spinner } from "../../src/shared/io.js";

const ANSI_RE = /\u001b\[[0-9;]*[A-Za-z]/;

describe("printDryRunReport", () => {
  const originalLog = console.log;
  let output: string[];

  afterEach(() => {
    console.log = originalLog;
  });

  function captureOutput() {
    output = [];
    console.log = (...args: unknown[]) => {
      output.push(args.map(String).join(" "));
    };
  }

  it("prints summary with create and modify entries", () => {
    captureOutput();
    const sections = [
      {
        label: "Claude Code",
        entries: [
          { file: "CLAUDE.md", action: "create" as const },
          { file: ".claude/settings.json", action: "modify" as const, detail: "add 1 MCP server" },
        ],
      },
    ];

    printDryRunReport("Dry run — would install test@1.0:", sections, false);

    const joined = output.join("\n");
    expect(joined).toContain("Dry run");
    expect(joined).toContain("CLAUDE.md");
    expect(joined).toContain("create");
    expect(joined).toContain("modify");
    expect(joined).toContain("add 1 MCP server");
  });

  it("prints unified diff when verbose and oldContent/newContent provided", () => {
    captureOutput();
    const sections = [
      {
        label: "Claude Code",
        entries: [
          {
            file: "CLAUDE.md",
            action: "modify" as const,
            detail: "update marker block",
            oldContent: "# Project\n\nOld content\n",
            newContent: "# Project\n\nNew content\n",
          },
        ],
      },
    ];

    printDryRunReport("Dry run:", sections, true);

    const joined = output.join("\n");
    expect(joined).toContain("Old content");
    expect(joined).toContain("New content");
  });

  it("skips diff output when verbose=false even with content provided", () => {
    captureOutput();
    const sections = [
      {
        label: "Test",
        entries: [
          {
            file: "A.md",
            action: "modify" as const,
            oldContent: "old",
            newContent: "new",
          },
        ],
      },
    ];

    printDryRunReport("Dry run:", sections, false);

    const joined = output.join("\n");
    expect(joined).not.toContain("---");
    expect(joined).not.toContain("+++");
  });

  it("handles empty sections gracefully", () => {
    captureOutput();
    printDryRunReport("Dry run:", [], false);
    const joined = output.join("\n");
    expect(joined).toContain("Dry run");
  });
});

describe("log.warnOnce", () => {
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    log._resetWarnOnce();
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    logSpy.mockRestore();
    log._resetWarnOnce();
  });

  it("emits the warning on the first call for a key", () => {
    log.warnOnce("abc", "first warning");
    expect(logSpy).toHaveBeenCalledTimes(1);
    expect(logSpy.mock.calls[0]!.join(" ")).toContain("first warning");
  });

  it("deduplicates repeated calls with the same key", () => {
    log.warnOnce("abc", "first warning");
    log.warnOnce("abc", "first warning");
    log.warnOnce("abc", "first warning");
    expect(logSpy).toHaveBeenCalledTimes(1);
  });

  it("treats different keys as distinct", () => {
    log.warnOnce("one", "msg a");
    log.warnOnce("two", "msg b");
    expect(logSpy).toHaveBeenCalledTimes(2);
  });

  it("does not dedup across _resetWarnOnce (test helper)", () => {
    log.warnOnce("abc", "warn");
    log._resetWarnOnce();
    log.warnOnce("abc", "warn");
    expect(logSpy).toHaveBeenCalledTimes(2);
  });
});

/**
 * N17: `ora` emits ANSI escapes via `log-symbols` even with `chalk.level = 0`,
 * corrupting piped output. Non-TTY callers get a plain-text stub spinner.
 * We assert no escape sequences slip through `start` → `succeed`/`fail`/`warn`.
 */
describe("spinner (non-TTY)", () => {
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    logSpy.mockRestore();
  });

  function collected(): string {
    return logSpy.mock.calls.map((c) => c.map(String).join(" ")).join("\n");
  }

  it("emits no ANSI escapes on start + succeed", () => {
    const s = spinner("working");
    s.succeed("working done");
    const out = collected();
    expect(out).toContain("working done");
    expect(ANSI_RE.test(out)).toBe(false);
  });

  it("emits no ANSI escapes on fail", () => {
    const s = spinner("working");
    s.fail("working failed");
    const out = collected();
    expect(out).toContain("working failed");
    expect(ANSI_RE.test(out)).toBe(false);
  });

  it("emits no ANSI escapes on warn", () => {
    const s = spinner("working");
    s.warn("half-done");
    const out = collected();
    expect(out).toContain("half-done");
    expect(ANSI_RE.test(out)).toBe(false);
  });
});
