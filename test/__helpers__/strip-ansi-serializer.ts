import { expect } from "vitest";

const ansiRegex = /\u001b\[[0-9;]*[A-Za-z]/g;

expect.addSnapshotSerializer({
  test: (val) => typeof val === "string" && ansiRegex.test(val),
  serialize: (val: string) => val.replace(ansiRegex, ""),
});
