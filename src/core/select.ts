import { chooseMany } from "../shared/interactive.js";
import type { StackBundle } from "../shared/schema.js";

/**
 * Prompt the user to pick which artifacts to include, across all six
 * artifact categories. Returns the `excluded` list in the canonical
 * `"type:name"` form (same shape used by `applyExcluded` and the
 * `installed.json` `excluded` field).
 *
 * Preselected state starts from `initiallyExcluded` — anything already
 * excluded starts unchecked, anything else starts checked. This keeps
 * re-running `--select` consistent with what the user picked last time.
 */
export async function pickExclusions(
  bundle: StackBundle,
  initiallyExcluded: string[] = [],
): Promise<string[]> {
  const excludedSet = new Set(initiallyExcluded);

  type Category = { type: string; label: string; names: string[] };
  const categories: Category[] = [
    { type: "skill", label: "Skills", names: bundle.skills.map((s) => s.name) },
    { type: "agent", label: "Agents", names: bundle.agents.map((a) => a.name) },
    { type: "rule", label: "Rules", names: bundle.rules.map((r) => r.name) },
    {
      type: "command",
      label: "Commands",
      names: bundle.commands.map((c) => c.name),
    },
    {
      type: "mcp",
      label: "MCP servers",
      names: Object.keys(bundle.mcpServers),
    },
    {
      type: "env",
      label: "Env vars",
      names: Object.keys(bundle.envExample),
    },
  ];

  const next = new Set<string>(excludedSet);

  for (const cat of categories) {
    if (cat.names.length === 0) continue;

    const preselectedIncluded = cat.names.filter(
      (n) => !excludedSet.has(`${cat.type}:${n}`),
    );

    const picked = await chooseMany<string>(
      `${cat.label} to include`,
      cat.names.map((n) => ({ value: n, label: n })),
      preselectedIncluded,
    );

    const pickedSet = new Set(picked);
    for (const name of cat.names) {
      const key = `${cat.type}:${name}`;
      if (pickedSet.has(name)) next.delete(key);
      else next.add(key);
    }
  }

  return Array.from(next).sort();
}
