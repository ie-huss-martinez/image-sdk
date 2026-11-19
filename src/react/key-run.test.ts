import { describe, expect, it } from "vitest";
import { createKeyRun } from "./key-run.js";

describe("a frame's run of arrow keys (docs/adr/0007)", () => {
  it("ends when the last key held is let go: one step per press, and per key held down", () => {
    const run = createKeyRun();
    expect(run.press("ArrowLeft")).toBe(true);
    expect(run.release("ArrowLeft")).toBe(true);
    // Repeats of a held key, then a second key with it: one run.
    expect(run.press("ArrowLeft")).toBe(true);
    expect(run.press("ArrowLeft")).toBe(true);
    expect(run.press("ArrowUp")).toBe(true);
    expect(run.release("ArrowLeft")).toBe(false);
    expect(run.release("ArrowUp")).toBe(true);
    // A key let go that wasn't pressed here ends nothing.
    expect(run.release("ArrowDown")).toBe(false);
  });

  it("ignores the rest of a run cancelled with Escape, until its keys are let go", () => {
    const run = createKeyRun();
    expect(run.cancel()).toBe(false);
    run.press("ArrowRight");
    expect(run.cancel()).toBe(true);
    expect(run.press("ArrowRight")).toBe(false);
    expect(run.release("ArrowRight")).toBe(false);
    // The next press starts afresh.
    expect(run.press("ArrowRight")).toBe(true);
    expect(run.release("ArrowRight")).toBe(true);
  });

  it("hands a run to a pointer: committed first, or still ignored after Escape until let go", () => {
    const run = createKeyRun();
    expect(run.handOff()).toBe(false);
    run.press("ArrowRight");
    expect(run.handOff()).toBe(true);
    expect(run.release("ArrowRight")).toBe(false);
    // Cancelled, then handed over: the held key's repeats stay ignored.
    run.press("ArrowRight");
    run.cancel();
    expect(run.handOff()).toBe(false);
    expect(run.press("ArrowRight")).toBe(false);
    expect(run.release("ArrowRight")).toBe(false);
    expect(run.press("ArrowRight")).toBe(true);
  });

  it("ends a run when focus leaves, since its keys are let go elsewhere", () => {
    const run = createKeyRun();
    expect(run.leave()).toBe(false);
    run.press("ArrowDown");
    expect(run.leave()).toBe(true);
    expect(run.release("ArrowDown")).toBe(false);
    run.press("ArrowDown");
    run.cancel();
    expect(run.leave()).toBe(false);
  });
});
