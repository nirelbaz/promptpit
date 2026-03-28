import type { McpConfig } from "../shared/schema.js";
import { isDangerousEnvName } from "../shared/schema.js";

const SECRET_PATTERNS: RegExp[] = [
  /^[a-z+]+:\/\/[^:]+:[^@]+@/i,
  /^sk-[a-zA-Z0-9]{20,}/,
  /^key-[a-zA-Z0-9]{20,}/,
  /^ghp_[a-zA-Z0-9]{36,}/,
  /^ghs_[a-zA-Z0-9]{36,}/,
  /^gho_[a-zA-Z0-9]{36,}/,
  /^github_pat_[a-zA-Z0-9_]{20,}/,
  /^xoxb-[a-zA-Z0-9-]+/,
  /^xoxp-[a-zA-Z0-9-]+/,
  /^AKIA[A-Z0-9]{16}/,
  /^Bearer\s+[a-zA-Z0-9._\-]+/i,
  /^[a-zA-Z0-9+/=_\-]{30,}$/,
];

function looksLikeSecret(value: string): boolean {
  if (value.length < 10) return false;
  if (
    /^(true|false|yes|no|on|off|debug|info|warn|error|production|development|test|staging)$/i.test(
      value,
    )
  ) {
    return false;
  }
  if (/^\d+$/.test(value)) return false;
  if (value.startsWith("/") && !value.includes("@") && !value.includes(":")) {
    return false;
  }

  return SECRET_PATTERNS.some((pattern) => pattern.test(value));
}

export interface StripResult {
  stripped: McpConfig;
  envExample: Record<string, string>;
}

export function stripSecrets(mcpConfig: McpConfig): StripResult {
  const stripped: McpConfig = {};
  const envExample: Record<string, string> = {};

  for (const [serverName, server] of Object.entries(mcpConfig)) {
    stripped[serverName] = { ...server };

    if (server.env) {
      const newEnv: Record<string, string> = {};
      for (const [key, value] of Object.entries(server.env)) {
        if (looksLikeSecret(value)) {
          newEnv[key] = `\${${key}}`;
          envExample[key] = `# Secret detected in MCP server "${serverName}"`;
        } else {
          newEnv[key] = value;
        }
      }
      stripped[serverName] = { ...server, env: newEnv };
    }
  }

  return { stripped, envExample };
}

export function validateEnvNames(
  envVars: Record<string, string>,
): string[] {
  return Object.keys(envVars).filter((name) => isDangerousEnvName(name));
}
