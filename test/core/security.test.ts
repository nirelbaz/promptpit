import { describe, it, expect } from "vitest";
import { stripSecrets, validateEnvNames } from "../../src/core/security.js";

describe("stripSecrets", () => {
  it("strips URL credentials from MCP config", () => {
    const mcp = {
      postgres: {
        command: "npx",
        args: ["-y", "server-postgres"],
        env: { DATABASE_URL: "postgres://admin:secret123@localhost:5432/db" },
      },
    };
    const { stripped, envExample } = stripSecrets(mcp);
    expect(stripped.postgres.env!.DATABASE_URL).toBe("${DATABASE_URL}");
    expect(envExample).toHaveProperty("DATABASE_URL");
  });

  it("strips API key patterns", () => {
    const mcp = {
      api: {
        command: "node",
        env: {
          OPENAI_KEY: "sk-abc123def456ghi789jkl012mno345pqr678stu901",
          GITHUB_TOKEN: "ghp_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
          AWS_KEY: "AKIAIOSFODNN7EXAMPLE",
        },
      },
    };
    const { stripped, envExample } = stripSecrets(mcp);
    expect(stripped.api.env!.OPENAI_KEY).toBe("${OPENAI_KEY}");
    expect(stripped.api.env!.GITHUB_TOKEN).toBe("${GITHUB_TOKEN}");
    expect(stripped.api.env!.AWS_KEY).toBe("${AWS_KEY}");
    expect(Object.keys(envExample)).toHaveLength(3);
  });

  it("does NOT strip normal config values", () => {
    const mcp = {
      server: {
        command: "node",
        env: {
          NODE_ENV: "production",
          PORT: "3000",
          LOG_LEVEL: "info",
          API_VERSION: "v2",
        },
      },
    };
    const { stripped } = stripSecrets(mcp);
    expect(stripped.server.env!.NODE_ENV).toBe("production");
    expect(stripped.server.env!.PORT).toBe("3000");
    expect(stripped.server.env!.LOG_LEVEL).toBe("info");
  });

  it("handles MCP config with no env vars", () => {
    const mcp = {
      tool: { command: "npx", args: ["-y", "tool"] },
    };
    const { stripped, envExample } = stripSecrets(mcp);
    expect(stripped.tool.command).toBe("npx");
    expect(Object.keys(envExample)).toHaveLength(0);
  });
});

describe("validateEnvNames", () => {
  it("flags dangerous env var names", () => {
    const dangerous = validateEnvNames({
      PATH: "/usr/bin",
      NODE_OPTIONS: "--require=evil.js",
      LD_PRELOAD: "/lib/evil.so",
      SAFE_VAR: "ok",
    });
    expect(dangerous).toContain("PATH");
    expect(dangerous).toContain("NODE_OPTIONS");
    expect(dangerous).toContain("LD_PRELOAD");
    expect(dangerous).not.toContain("SAFE_VAR");
  });

  it("returns empty array for safe env vars", () => {
    const dangerous = validateEnvNames({
      DATABASE_URL: "value",
      API_KEY: "value",
    });
    expect(dangerous).toHaveLength(0);
  });
});
