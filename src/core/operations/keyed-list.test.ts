import { describe, expect, it } from "vitest";
import { Invalid } from "./checks.js";
import {
  checkKey,
  insertItems,
  type KeyedListNames,
  moveItems,
  orderItems,
  removeItems,
  restoreItems,
  updateItems,
} from "./keyed-list.js";

const NAMES: KeyedListNames = { unknown: "unknown-item", item: "item" };
const list = (...keys: string[]) => keys.map((key) => ({ key }));
const keys = (items: readonly { key: string }[]) => items.map((item) => item.key).join("");

/** The reason a call is refused with. */
function reason(run: () => unknown): string | undefined {
  try {
    run();
  } catch (error) {
    if (error instanceof Invalid) return error.reason;
    throw error;
  }
  return undefined;
}

describe("the keyed-list edits (ADR 0009)", () => {
  it("inserts at an index, and is undone by removing what it inserted", () => {
    const start = list("a", "b");
    const inserted = insertItems(start, 1, list("x", "y"), new Set(["a", "b"]));
    expect(keys(inserted.list)).toBe("axyb");
    expect(keys(removeItems(inserted.list, inserted.keys, NAMES).list)).toBe("ab");
    expect(keys(insertItems(start, 2, list("x"), new Set()).list)).toBe("abx");
  });

  it("refuses an index outside the list, and a key that's taken or repeated", () => {
    expect(reason(() => insertItems(list("a"), 2, list("x"), new Set()))).toBe("invalid-index");
    expect(reason(() => insertItems(list("a"), -1, list("x"), new Set()))).toBe(
      "malformed-command",
    );
    expect(reason(() => insertItems(list("a"), 0.5, list("x"), new Set()))).toBe(
      "malformed-command",
    );
    expect(reason(() => insertItems(list("a"), 0, list("a"), new Set(["a"])))).toBe(
      "duplicate-key",
    );
    // A key another list of the plan uses is taken too.
    expect(reason(() => insertItems([], 0, list("layer"), new Set(["layer"])))).toBe(
      "duplicate-key",
    );
    expect(reason(() => insertItems([], 0, list("x", "x"), new Set()))).toBe("duplicate-key");
  });

  it("removes items in any order, and puts each back where it was", () => {
    const start = list("a", "b", "c", "d", "e");
    const removed = removeItems(start, ["d", "a", "c"], NAMES);
    expect(keys(removed.list)).toBe("be");
    expect(removed.entries.map(({ at, item }) => `${at}${item.key}`)).toEqual(["0a", "2c", "3d"]);
    expect(keys(restoreItems(removed.list, removed.entries, new Set(["b", "e"])).list)).toBe(
      "abcde",
    );
  });

  it("refuses to remove a key the list doesn't have, a repeated key and no keys", () => {
    expect(reason(() => removeItems(list("a"), ["b"], NAMES))).toBe("unknown-item");
    expect(reason(() => removeItems(list("a"), ["toString"], NAMES))).toBe("unknown-item");
    expect(reason(() => removeItems(list("a"), ["a", "a"], NAMES))).toBe("malformed-command");
    expect(reason(() => removeItems(list("a"), [], NAMES))).toBe("malformed-command");
    expect(reason(() => removeItems(list("a"), "a", NAMES))).toBe("malformed-command");
  });

  it("refuses to restore past the end, out of order, or over a key in use", () => {
    const entry = (at: number, key: string) => ({ at, item: { key } });
    expect(reason(() => restoreItems(list("a"), [entry(2, "x")], new Set(["a"])))).toBe(
      "invalid-index",
    );
    expect(
      reason(() => restoreItems(list("a"), [entry(1, "x"), entry(0, "y")], new Set(["a"]))),
    ).toBe("invalid-index");
    expect(reason(() => restoreItems(list("a"), [entry(0, "a")], new Set(["a"])))).toBe(
      "duplicate-key",
    );
  });

  it("moves items to an index of the rest, in the order they had", () => {
    const start = list("a", "b", "c", "d");
    // Listed as d then b: they still land as b then d.
    const moved = moveItems(start, ["d", "b"], 0, NAMES);
    expect(keys(moved.list)).toBe("bdac");
    expect(moved.order).toEqual(["a", "b", "c", "d"]);
    expect(keys(orderItems(moved.list, moved.order, NAMES).list)).toBe("abcd");
    expect(keys(moveItems(start, ["a"], 3, NAMES).list)).toBe("bcda");
    // Moving everything changes nothing.
    expect(keys(moveItems(start, ["d", "c", "b", "a"], 0, NAMES).list)).toBe("abcd");
  });

  it("refuses to move past the rest's end, and an order that isn't every key once", () => {
    expect(reason(() => moveItems(list("a", "b"), ["a"], 2, NAMES))).toBe("invalid-index");
    expect(reason(() => moveItems(list("a", "b"), ["x"], 0, NAMES))).toBe("unknown-item");
    expect(reason(() => orderItems(list("a", "b"), ["a"], NAMES))).toBe("invalid-order");
    expect(reason(() => orderItems(list("a", "b"), ["a", "c"], NAMES))).toBe("unknown-item");
  });

  it("updates some items, and gives what undoes each", () => {
    const start = [
      { key: "a", n: 1 },
      { key: "b", n: 2 },
    ];
    const patch = (item: { key: string; n: number }, props: unknown) => ({
      item: { ...item, n: props as number },
      previous: item.n,
    });
    const updated = updateItems(start, [{ key: "b", props: 20 }], NAMES, patch);
    expect(updated.list).toEqual([
      { key: "a", n: 1 },
      { key: "b", n: 20 },
    ]);
    expect(updated.previous).toEqual([{ key: "b", props: 2 }]);
    expect(updateItems(updated.list, updated.previous, NAMES, patch).list).toEqual(start);
    expect(
      reason(() =>
        updateItems(
          start,
          [
            { key: "a", props: 1 },
            { key: "a", props: 2 },
          ],
          NAMES,
          patch,
        ),
      ),
    ).toBe("duplicate-key");
    expect(reason(() => updateItems(start, [{ key: "z", props: 1 }], NAMES, patch))).toBe(
      "unknown-item",
    );
    expect(reason(() => updateItems(start, [{ key: "a" }], NAMES, patch))).toBe(
      "malformed-command",
    );
    expect(reason(() => updateItems(start, [], NAMES, patch))).toBe("malformed-command");
  });

  it("never changes the list it's given", () => {
    const start = Object.freeze(list("a", "b", "c"));
    insertItems(start, 1, list("x"), new Set());
    removeItems(start, ["b"], NAMES);
    moveItems(start, ["c"], 0, NAMES);
    orderItems(start, ["c", "b", "a"], NAMES);
    expect(keys(start)).toBe("abc");
  });

  it("counts a key's length in code points, and takes any text as a key", () => {
    expect(checkKey("𝄞".repeat(64))).toHaveLength(128);
    expect(reason(() => checkKey("𝄞".repeat(65)))).toBe("invalid-key");
    expect(reason(() => checkKey(""))).toBe("invalid-key");
    expect(reason(() => checkKey(1))).toBe("malformed-command");
    expect(checkKey("__proto__")).toBe("__proto__");
  });
});
