import { describe, it, expect, afterEach } from "vitest";
import { printDryRunReport } from "../../src/shared/io.js";

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
