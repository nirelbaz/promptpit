import { describe, it, expect, vi } from "vitest";
import { render } from "ink-testing-library";
import { ConfirmDestructive } from "../../../src/tui/components/confirm-destructive.js";

async function tick(): Promise<void> {
  await new Promise((r) => setImmediate(r));
  await new Promise((r) => setImmediate(r));
}

describe("ConfirmDestructive", () => {
  it("renders the prompt and the expected name in the hint", async () => {
    const { lastFrame } = render(
      <ConfirmDestructive
        expected="my-stack"
        prompt="Confirm by typing the stack name"
        onConfirm={() => {}}
        onCancel={() => {}}
      />,
    );
    await tick();
    const frame = lastFrame() ?? "";
    expect(frame).toContain("Confirm by typing the stack name");
    expect(frame).toContain('type "my-stack" to confirm');
  });

  it("ignores Enter until the typed value matches", async () => {
    const onConfirm = vi.fn();
    const { stdin, lastFrame } = render(
      <ConfirmDestructive
        expected="my-stack"
        prompt="Confirm"
        onConfirm={onConfirm}
        onCancel={() => {}}
      />,
    );
    await tick();
    stdin.write("\r"); // Enter on empty
    await tick();
    expect(onConfirm).not.toHaveBeenCalled();

    stdin.write("wrong");
    await tick();
    stdin.write("\r");
    await tick();
    expect(onConfirm).not.toHaveBeenCalled();
    expect(lastFrame()).toContain('does not match "my-stack"');
  });

  it("fires onConfirm when typed value matches and Enter is pressed", async () => {
    const onConfirm = vi.fn();
    const { stdin, lastFrame } = render(
      <ConfirmDestructive
        expected="my-stack"
        prompt="Confirm"
        onConfirm={onConfirm}
        onCancel={() => {}}
      />,
    );
    await tick();
    stdin.write("my-stack");
    await tick();
    expect(lastFrame()).toContain("matches");
    stdin.write("\r");
    await tick();
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it("backspace removes the last character", async () => {
    const onConfirm = vi.fn();
    const DEL = "";
    const { stdin, lastFrame } = render(
      <ConfirmDestructive
        expected="abc"
        prompt="Confirm"
        onConfirm={onConfirm}
        onCancel={() => {}}
      />,
    );
    await tick();
    stdin.write("abx");
    await tick();
    expect(lastFrame()).toContain("does not match");
    stdin.write(DEL);
    await tick();
    stdin.write("c");
    await tick();
    expect(lastFrame()).toContain("matches");
    stdin.write("\r");
    await tick();
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it("does not fire onConfirm on partial match even when Enter is spammed", async () => {
    const onConfirm = vi.fn();
    const { stdin } = render(
      <ConfirmDestructive
        expected="my-stack"
        prompt="Confirm"
        onConfirm={onConfirm}
        onCancel={() => {}}
      />,
    );
    await tick();
    stdin.write("my-stac"); // one char short
    await tick();
    stdin.write("\r");
    stdin.write("\r");
    stdin.write("\r");
    await tick();
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("renders the optional description line", async () => {
    const { lastFrame } = render(
      <ConfirmDestructive
        expected="x"
        prompt="Confirm"
        description="This will permanently delete the bundle."
        onConfirm={() => {}}
        onCancel={() => {}}
      />,
    );
    await tick();
    expect(lastFrame()).toContain("This will permanently delete the bundle.");
  });
});
