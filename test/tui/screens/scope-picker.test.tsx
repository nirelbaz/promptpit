import { describe, it, expect } from "vitest";
import { render } from "ink-testing-library";
import { NavProvider } from "../../../src/tui/nav.js";
import { ScopePicker } from "../../../src/tui/screens/scope-picker.js";

async function tick(): Promise<void> {
  await new Promise((r) => setImmediate(r));
  await new Promise((r) => setImmediate(r));
}

describe("ScopePicker", () => {
  it("renders all four scope options with 'A specific path…' disabled", async () => {
    const { lastFrame } = render(
      <NavProvider initial={() => <ScopePicker />} />,
    );
    await tick();
    const frame = lastFrame() ?? "";
    expect(frame).toContain("Current tree + global");
    expect(frame).toContain("Global only");
    expect(frame).toContain("A specific path");
    expect(frame).toContain("coming soon");
    expect(frame).toContain("Everywhere (deep)");
  });
});
