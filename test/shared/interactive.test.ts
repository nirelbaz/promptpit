import { describe, it, expect } from "vitest";
import process from "node:process";
import {
  isInteractive,
  requireInteractive,
  PromptCancelledError,
} from "../../src/shared/interactive.js";

describe("isInteractive", () => {
  it("returns a boolean reflecting process tty state", () => {
    // Don't assert the specific value — in CI it's false, locally it can be
    // true. Just confirm the function returns without throwing and yields a
    // boolean. The requireInteractive tests below exercise both branches
    // deterministically via manual stubbing.
    const result = isInteractive();
    expect(typeof result).toBe("boolean");
  });
});

describe("requireInteractive", () => {
  it("throws an actionable error when stdout is not a TTY", () => {
    const origOut = process.stdout.isTTY;
    const origIn = process.stdin.isTTY;
    try {
      (process.stdout as unknown as { isTTY: boolean }).isTTY = false;
      (process.stdin as unknown as { isTTY: boolean }).isTTY = false;
      expect(() => requireInteractive("--interactive")).toThrow(
        /--interactive requires an interactive terminal/,
      );
    } finally {
      (process.stdout as unknown as { isTTY: boolean | undefined }).isTTY = origOut;
      (process.stdin as unknown as { isTTY: boolean | undefined }).isTTY = origIn;
    }
  });

  it("passes when both stdout and stdin are TTYs", () => {
    const origOut = process.stdout.isTTY;
    const origIn = process.stdin.isTTY;
    try {
      (process.stdout as unknown as { isTTY: boolean }).isTTY = true;
      (process.stdin as unknown as { isTTY: boolean }).isTTY = true;
      expect(() => requireInteractive("--select")).not.toThrow();
    } finally {
      (process.stdout as unknown as { isTTY: boolean | undefined }).isTTY = origOut;
      (process.stdin as unknown as { isTTY: boolean | undefined }).isTTY = origIn;
    }
  });

  it("includes the flag name in the error message", () => {
    const origOut = process.stdout.isTTY;
    const origIn = process.stdin.isTTY;
    try {
      (process.stdout as unknown as { isTTY: boolean }).isTTY = false;
      (process.stdin as unknown as { isTTY: boolean }).isTTY = false;
      expect(() => requireInteractive("--reset-exclusions")).toThrow(
        /--reset-exclusions/,
      );
    } finally {
      (process.stdout as unknown as { isTTY: boolean | undefined }).isTTY = origOut;
      (process.stdin as unknown as { isTTY: boolean | undefined }).isTTY = origIn;
    }
  });
});

describe("PromptCancelledError", () => {
  it("is an Error subclass with a stable name", () => {
    const err = new PromptCancelledError();
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe("PromptCancelledError");
    expect(err.message).toBe("prompt cancelled");
  });
});
