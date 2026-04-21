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
  let stderrSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    log._resetWarnOnce();
    stderrSpy = vi
      .spyOn(process.stderr, "write")
      .mockImplementation(() => true);
  });

  afterEach(() => {
    stderrSpy.mockRestore();
    log._resetWarnOnce();
  });

  it("emits the warning on the first call for a key", () => {
    log.warnOnce("abc", "first warning");
    expect(stderrSpy).toHaveBeenCalledTimes(1);
    expect(String(stderrSpy.mock.calls[0]![0])).toContain("first warning");
  });

  it("deduplicates repeated calls with the same key", () => {
    log.warnOnce("abc", "first warning");
    log.warnOnce("abc", "first warning");
    log.warnOnce("abc", "first warning");
    expect(stderrSpy).toHaveBeenCalledTimes(1);
  });

  it("treats different keys as distinct", () => {
    log.warnOnce("one", "msg a");
    log.warnOnce("two", "msg b");
    expect(stderrSpy).toHaveBeenCalledTimes(2);
  });

  it("does not dedup across _resetWarnOnce (test helper)", () => {
    log.warnOnce("abc", "warn");
    log._resetWarnOnce();
    log.warnOnce("abc", "warn");
    expect(stderrSpy).toHaveBeenCalledTimes(2);
  });
});

/**
 * N18: every incidental notice (warnings, info banners, glyph-prefixed status)
 * must go to stderr so `pit ls --json`, `pit check --json`, etc. keep a clean
 * stdout. Regression test: if anyone re-routes these through `console.log`,
 * these assertions fail.
 */
describe("log channel routing", () => {
  let stderrSpy: ReturnType<typeof vi.spyOn>;
  let stdoutSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    stderrSpy = vi
      .spyOn(process.stderr, "write")
      .mockImplementation(() => true);
    stdoutSpy = vi
      .spyOn(process.stdout, "write")
      .mockImplementation(() => true);
  });

  afterEach(() => {
    stderrSpy.mockRestore();
    stdoutSpy.mockRestore();
  });

  it("routes log.warn to stderr, not stdout", () => {
    log.warn("boom");
    expect(stderrSpy).toHaveBeenCalled();
    expect(String(stderrSpy.mock.calls[0]![0])).toContain("boom");
    expect(stdoutSpy).not.toHaveBeenCalled();
  });

  it("routes log.info to stderr, not stdout", () => {
    log.info("heads up");
    expect(stderrSpy).toHaveBeenCalled();
    expect(String(stderrSpy.mock.calls[0]![0])).toContain("heads up");
    expect(stdoutSpy).not.toHaveBeenCalled();
  });

  it("routes log.success to stderr, not stdout", () => {
    log.success("done");
    expect(stderrSpy).toHaveBeenCalled();
    expect(stdoutSpy).not.toHaveBeenCalled();
  });

  it("routes log.error to stderr, not stdout", () => {
    log.error("nope");
    expect(stderrSpy).toHaveBeenCalled();
    expect(stdoutSpy).not.toHaveBeenCalled();
  });
});

/**
 * N17: `ora` emits ANSI escapes via `log-symbols` even with `chalk.level = 0`,
 * corrupting piped output. Non-TTY callers get a plain-text stub spinner.
 * We assert no escape sequences slip through `start` → `succeed`/`fail`/`warn`.
 */
describe("spinner (non-TTY)", () => {
  let stderrSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    stderrSpy = vi
      .spyOn(process.stderr, "write")
      .mockImplementation(() => true);
  });

  afterEach(() => {
    stderrSpy.mockRestore();
  });

  function collected(): string {
    return stderrSpy.mock.calls.map((c) => String(c[0])).join("");
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

  it("emits no ANSI escapes on info and routes to stderr", () => {
    const s = spinner("working");
    s.info("still going");
    const out = collected();
    expect(out).toContain("still going");
    expect(ANSI_RE.test(out)).toBe(false);
  });

  it("supports chaining through start() → succeed() without ANSI", () => {
    const s = spinner("phase one");
    const result = s.start("phase two").succeed("phase two done");
    // Chain should return the stub itself so further calls are valid.
    expect(result).toBeDefined();
    const out = collected();
    expect(out).toContain("phase one");
    expect(out).toContain("phase two done");
    expect(ANSI_RE.test(out)).toBe(false);
  });

  it("honors mutated .text as the default message for succeed()", () => {
    const s = spinner("initial");
    s.text = "mutated message";
    s.succeed(); // no arg → falls back to current text
    const out = collected();
    expect(out).toContain("mutated message");
    expect(ANSI_RE.test(out)).toBe(false);
  });
});

describe("log.withMutedWarnings", () => {
  let stderrBuf: string;
  let originalWrite: typeof process.stderr.write;

  beforeEach(() => {
    log._resetWarnOnce();
    stderrBuf = "";
    originalWrite = process.stderr.write.bind(process.stderr);
    process.stderr.write = ((chunk: string | Uint8Array) => {
      stderrBuf += typeof chunk === "string" ? chunk : Buffer.from(chunk).toString();
      return true;
    }) as typeof process.stderr.write;
  });

  afterEach(() => {
    process.stderr.write = originalWrite;
    log._resetWarnOnce();
  });

  it("suppresses log.warn inside the scope and returns the count", async () => {
    const { result, suppressed } = await log.withMutedWarnings(async () => {
      log.warn("one");
      log.warn("two");
      log.warn("three");
      return "ok";
    });
    expect(result).toBe("ok");
    expect(suppressed).toBe(3);
    expect(stderrBuf).toBe("");
  });

  it("dedupes warnOnce keys within a muted scope (counts unique keys only)", async () => {
    const { suppressed } = await log.withMutedWarnings(async () => {
      for (let i = 0; i < 500; i++) log.warnOnce("dup", "same key");
      log.warnOnce("unique", "different");
      return null;
    });
    expect(suppressed).toBe(2);
  });

  it("does not pollute the process-wide warnOnce dedup set when muted", async () => {
    await log.withMutedWarnings(async () => {
      log.warnOnce("later", "muted first");
      return null;
    });
    // The same key, now unmuted, should still emit once — mute should not
    // count as "already emitted" for future unmuted calls.
    log.warnOnce("later", "first unmuted emission");
    expect(stderrBuf).toContain("first unmuted emission");
  });

  it("attributes warnings to the innermost scope only (no cross-count)", async () => {
    let innerSuppressed = 0;
    const outer = await log.withMutedWarnings(async () => {
      const inner = await log.withMutedWarnings(async () => {
        log.warn("inside inner");
        return null;
      });
      innerSuppressed = inner.suppressed;
      // A warn here fires while only outer is active.
      log.warn("inside outer");
      return null;
    });
    expect(innerSuppressed).toBe(1);
    expect(outer.suppressed).toBe(1);
  });

  it("releases the scope even when fn throws", async () => {
    await expect(
      log.withMutedWarnings(async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    // After the throw, a post-scope warn must emit normally.
    log.warn("after throw");
    expect(stderrBuf).toContain("after throw");
  });
});
