import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Exercise the wrapper functions in src/shared/interactive.ts by mocking
 * @clack/prompts. Covers the happy-path return values + the cancel symbol
 * handling (PromptCancelledError throw).
 */

// Mutable handlers swapped per test
let selectImpl: (opts: unknown) => Promise<unknown>;
let multiselectImpl: (opts: unknown) => Promise<unknown>;
let confirmImpl: (opts: unknown) => Promise<unknown>;
let textImpl: (opts: unknown) => Promise<unknown>;

const CANCEL = Symbol("cancel");

vi.mock("@clack/prompts", () => ({
  select: (opts: unknown) => selectImpl(opts),
  multiselect: (opts: unknown) => multiselectImpl(opts),
  confirm: (opts: unknown) => confirmImpl(opts),
  text: (opts: unknown) => textImpl(opts),
  isCancel: (v: unknown) => v === CANCEL,
}));

// Import AFTER the mock so the SUT picks up the mocked module.
const {
  chooseOne,
  chooseMany,
  chooseDriftAction,
  confirm,
  text,
  PromptCancelledError,
} = await import("../../src/shared/interactive.js");

beforeEach(() => {
  selectImpl = async () => undefined;
  multiselectImpl = async () => undefined;
  confirmImpl = async () => undefined;
  textImpl = async () => undefined;
});

describe("chooseOne", () => {
  it("returns the selected value", async () => {
    selectImpl = async () => "team";
    const result = await chooseOne<string>(
      "pick one",
      [
        { value: "base", label: "base" },
        { value: "team", label: "team" },
      ],
      "base",
    );
    expect(result).toBe("team");
  });

  it("passes message, options, and initialValue through to clack", async () => {
    let captured: Record<string, unknown> = {};
    selectImpl = async (opts) => {
      captured = opts as Record<string, unknown>;
      return "x";
    };
    await chooseOne("msg", [{ value: "x", label: "x" }], "x");
    expect(captured.message).toBe("msg");
    expect(captured.initialValue).toBe("x");
    expect(Array.isArray(captured.options)).toBe(true);
  });

  it("throws PromptCancelledError when user cancels (Ctrl+C)", async () => {
    selectImpl = async () => CANCEL;
    await expect(
      chooseOne<string>("pick", [{ value: "a", label: "a" }]),
    ).rejects.toBeInstanceOf(PromptCancelledError);
  });
});

describe("chooseMany", () => {
  it("returns the selected subset", async () => {
    multiselectImpl = async () => ["a", "c"];
    const result = await chooseMany<string>(
      "pick many",
      [
        { value: "a", label: "a" },
        { value: "b", label: "b" },
        { value: "c", label: "c" },
      ],
      ["a", "b", "c"],
    );
    expect(result).toEqual(["a", "c"]);
  });

  it("passes required:false and initialValues through", async () => {
    let captured: Record<string, unknown> = {};
    multiselectImpl = async (opts) => {
      captured = opts as Record<string, unknown>;
      return [];
    };
    await chooseMany<string>("m", [{ value: "x", label: "x" }], ["x"]);
    expect(captured.required).toBe(false);
    expect(captured.initialValues).toEqual(["x"]);
  });

  it("throws PromptCancelledError when user cancels", async () => {
    multiselectImpl = async () => CANCEL;
    await expect(
      chooseMany<string>("m", [{ value: "x", label: "x" }]),
    ).rejects.toBeInstanceOf(PromptCancelledError);
  });
});

describe("chooseDriftAction", () => {
  it("returns the chosen drift action", async () => {
    selectImpl = async () => "keep";
    const result = await chooseDriftAction("deploy drifted");
    expect(result).toBe("keep");
  });

  it("offers all four actions with skip as default", async () => {
    let captured: Record<string, unknown> = {};
    selectImpl = async (opts) => {
      captured = opts as Record<string, unknown>;
      return "skip";
    };
    await chooseDriftAction("skill X changed");
    const options = captured.options as Array<{ value: string }>;
    const values = options.map((o) => o.value).sort();
    expect(values).toEqual(["diff", "keep", "skip", "upstream"]);
    expect(captured.initialValue).toBe("skip");
  });
});

describe("confirm", () => {
  it("returns the boolean answer", async () => {
    confirmImpl = async () => true;
    expect(await confirm("ok?")).toBe(true);
  });

  it("passes initialValue through", async () => {
    let captured: Record<string, unknown> = {};
    confirmImpl = async (opts) => {
      captured = opts as Record<string, unknown>;
      return false;
    };
    await confirm("ok?", true);
    expect(captured.initialValue).toBe(true);
  });

  it("throws PromptCancelledError on cancel", async () => {
    confirmImpl = async () => CANCEL;
    await expect(confirm("ok?")).rejects.toBeInstanceOf(PromptCancelledError);
  });
});

describe("text", () => {
  it("returns the entered text", async () => {
    textImpl = async () => "hello";
    expect(await text("name")).toBe("hello");
  });

  it("passes placeholder and defaultValue through", async () => {
    let captured: Record<string, unknown> = {};
    textImpl = async (opts) => {
      captured = opts as Record<string, unknown>;
      return "";
    };
    await text("name", { placeholder: "Jane", defaultValue: "Default" });
    expect(captured.placeholder).toBe("Jane");
    expect(captured.defaultValue).toBe("Default");
  });

  it("throws PromptCancelledError on cancel", async () => {
    textImpl = async () => CANCEL;
    await expect(text("name")).rejects.toBeInstanceOf(PromptCancelledError);
  });
});
