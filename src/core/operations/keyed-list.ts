import { MAX_KEY_LENGTH } from "../model/plan.js";
import { longerThan } from "../model/source.js";
import { allFields, invalid, isRecord, isWhole } from "./checks.js";

/**
 * Edits to a list of keyed items, each with what undoes it exactly (ADR
 * 0009). The plan's layers, redactions and frames are such lists, and their
 * commands are these functions under their own names.
 *
 * Every function is pure, takes untrusted input, and refuses what it can't
 * apply by throwing through `invalid`, never by correcting it.
 */

/** An item with an identity. @internal */
export interface Keyed {
  readonly key: string;
}

/** An item and the index it's put back at. @internal */
export interface KeyedEntry<T> {
  readonly at: number;
  readonly item: T;
}

/** What a list calls its items in refusals, such as `unknown-redaction`. @internal */
export interface KeyedListNames {
  /** The reason for a key the list doesn't have. */
  readonly unknown: string;
  /** What one item is called in messages, such as "redaction". */
  readonly item: string;
}

/**
 * A key: text of 1 to `MAX_KEY_LENGTH` code points. Keys are data, so
 * `__proto__` is as good as any (sdk-core ADR 0045).
 *
 * @internal
 */
export function checkKey(value: unknown): string {
  if (typeof value !== "string") invalid("malformed-command", "a key is text");
  if (value === "" || longerThan(value, MAX_KEY_LENGTH)) {
    invalid("invalid-key", `a key has 1 to ${MAX_KEY_LENGTH} code points`);
  }
  return value;
}

/** A list with at least one item. */
function checkList(value: unknown, what: string): readonly unknown[] {
  if (!Array.isArray(value)) invalid("malformed-command", `${what} is a list`);
  if (value.length === 0) invalid("malformed-command", `${what} has at least one item`);
  return value;
}

/** At least one key, none repeated. @internal */
export function checkKeys(value: unknown): readonly string[] {
  const keys = checkList(value, "keys").map(checkKey);
  // The schema's uniqueItems refuses it too, so it's malformed, not a clash
  // with the plan.
  if (new Set(keys).size !== keys.length) invalid("malformed-command", "a key is listed twice");
  return keys;
}

/** An index from 0 to `max`. */
function checkIndex(value: unknown, max: number): number {
  if (!isWhole(value, 0)) invalid("malformed-command", "an index is a whole number from 0");
  if (value > max) invalid("invalid-index", `an index is from 0 to ${max}`);
  return value;
}

/** Each key's index in the list, refusing a key it doesn't have. */
function indexes<T extends Keyed>(
  list: readonly T[],
  keys: readonly string[],
  names: KeyedListNames,
): number[] {
  return keys.map((key) => {
    const index = list.findIndex((item) => item.key === key);
    if (index < 0) invalid(names.unknown, `there's no ${names.item} "${key}"`);
    return index;
  });
}

/** Refuses a new key that another item already has. */
function checkUnused(keys: readonly string[], taken: ReadonlySet<string>): void {
  const seen = new Set(taken);
  for (const key of keys) {
    if (seen.has(key)) invalid("duplicate-key", `the key "${key}" is already used`);
    seen.add(key);
  }
}

/**
 * Inserts items at an index. Undone by removing them.
 *
 * @param list - The list.
 * @param at - The index, from 0 to the list's length.
 * @param items - The items, already checked.
 * @param taken - Every key the plan already uses.
 * @internal
 */
export function insertItems<T extends Keyed>(
  list: readonly T[],
  at: unknown,
  items: readonly T[],
  taken: ReadonlySet<string>,
): { readonly list: readonly T[]; readonly keys: readonly string[] } {
  const index = checkIndex(at, list.length);
  const keys = items.map((item) => item.key);
  checkUnused(keys, taken);
  return { list: [...list.slice(0, index), ...items, ...list.slice(index)], keys };
}

/**
 * Removes items. Undone by putting each back at its index, in rising order.
 *
 * @internal
 */
export function removeItems<T extends Keyed>(
  list: readonly T[],
  keys: unknown,
  names: KeyedListNames,
): { readonly list: readonly T[]; readonly entries: readonly KeyedEntry<T>[] } {
  const removed = new Set(indexes(list, checkKeys(keys), names));
  const entries: KeyedEntry<T>[] = [];
  list.forEach((item, at) => {
    if (removed.has(at)) entries.push({ at, item });
  });
  return { list: list.filter((_, at) => !removed.has(at)), entries };
}

/**
 * Puts items back, each at its index in the list as it then is, so the
 * indexes rise. Undone by removing them.
 *
 * @param entries - The entries, with their items already checked.
 * @internal
 */
export function restoreItems<T extends Keyed>(
  list: readonly T[],
  entries: readonly KeyedEntry<T>[],
  taken: ReadonlySet<string>,
): { readonly list: readonly T[]; readonly keys: readonly string[] } {
  const keys = entries.map(({ item }) => item.key);
  checkUnused(keys, taken);
  const next = [...list];
  let last = -1;
  for (const { at, item } of entries) {
    const index = checkIndex(at, next.length);
    if (index <= last) invalid("invalid-index", "restored items are listed by rising index");
    last = index;
    next.splice(index, 0, item);
  }
  return { list: next, keys };
}

/**
 * Moves items to an index of the list without them, keeping the order they
 * had. Undone by setting the whole previous order.
 *
 * @internal
 */
export function moveItems<T extends Keyed>(
  list: readonly T[],
  keys: unknown,
  to: unknown,
  names: KeyedListNames,
): { readonly list: readonly T[]; readonly order: readonly string[] } {
  const moving = new Set(indexes(list, checkKeys(keys), names));
  const moved = list.filter((_, at) => moving.has(at));
  const rest = list.filter((_, at) => !moving.has(at));
  const index = checkIndex(to, rest.length);
  return {
    list: [...rest.slice(0, index), ...moved, ...rest.slice(index)],
    order: list.map((item) => item.key),
  };
}

/**
 * Sets the list's whole order: every key it has, once. Undone by the same,
 * with the previous order.
 *
 * @internal
 */
export function orderItems<T extends Keyed>(
  list: readonly T[],
  keys: unknown,
  names: KeyedListNames,
): { readonly list: readonly T[]; readonly order: readonly string[] } {
  const order = indexes(list, checkKeys(keys), names);
  if (order.length !== list.length) invalid("invalid-order", "an order lists every key once");
  return { list: order.map((at) => list[at] as T), order: list.map((item) => item.key) };
}

/**
 * Sets some fields of some items. Undone by the same, with what `patch`
 * says restores each.
 *
 * @param patch - Applies one item's changes, and returns the item and the
 *   changes that undo them.
 * @internal
 */
export function updateItems<T extends Keyed, Props>(
  list: readonly T[],
  updates: unknown,
  names: KeyedListNames,
  patch: (item: T, props: unknown) => { readonly item: T; readonly previous: Props },
): {
  readonly list: readonly T[];
  readonly previous: readonly { readonly key: string; readonly props: Props }[];
} {
  const entries = checkList(updates, "updates").map((update) => {
    if (!isRecord<{ key: unknown; props: unknown }>(update)) {
      invalid("malformed-command", "an update is an object");
    }
    allFields(update, ["key", "props"], "an update");
    return { key: checkKey(update.key), props: update.props };
  });
  const keys = entries.map(({ key }) => key);
  if (new Set(keys).size !== keys.length) invalid("duplicate-key", "a key is updated twice");
  const at = indexes(list, keys, names);
  const next = [...list];
  const previous = entries.map(({ key, props }, i) => {
    const index = at[i] as number;
    const patched = patch(next[index] as T, props);
    next[index] = patched.item;
    return { key, props: patched.previous };
  });
  return { list: next, previous };
}
