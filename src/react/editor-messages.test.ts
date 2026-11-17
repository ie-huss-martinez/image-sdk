import { createMessages, sdkCoreMessages } from "@hussmartinez/sdk-core";
import { uiMessages } from "@hussmartinez/ui";
import { describe, expect, it } from "vitest";
import { imageEditorText } from "../messages/editor-en.js";
import { imageMessages } from "../messages/en.js";
import { imageEditorMessages } from "./editor-messages.js";

const keys = (catalogue: object) => new Set(Object.keys(catalogue));
/** The SDK's own keys: its errors and warnings, and its interface text. */
const own = [
  ...[...keys(imageMessages)].filter((key) => !keys(sdkCoreMessages).has(key)),
  ...keys(imageEditorText),
];

describe("the components' message catalogue (sdk-core ADR 0046, docs/adr/0012)", () => {
  it("has no key of the SDK's own that sdk-core or ui also defines", () => {
    // Spreading catalogues lets a later key silently replace an earlier one,
    // so a bump of sdk-core or ui that would take one of ours fails here.
    expect(own.filter((key) => keys(sdkCoreMessages).has(key))).toEqual([]);
    expect(own.filter((key) => keys(uiMessages).has(key))).toEqual([]);
    expect(own).toHaveLength(new Set(own).size);
  });

  it("shares only sdk-core's keys with ui's catalogue, with the same text", () => {
    const shared = [...keys(imageMessages)].filter((key) => keys(uiMessages).has(key));
    for (const key of shared) {
      expect(keys(sdkCoreMessages).has(key), key).toBe(true);
      expect(uiMessages[key as keyof typeof uiMessages], key).toEqual(
        imageMessages[key as keyof typeof imageMessages],
      );
    }
  });

  it("keeps errors and warnings in the server-safe catalogue, and interface text out of it", () => {
    expect(keys(imageEditorText).size).toBeGreaterThan(0);
    for (const key of keys(imageEditorText)) {
      expect(key.startsWith("errors.") || key.startsWith("warnings."), key).toBe(false);
      expect(keys(imageMessages).has(key), key).toBe(false);
    }
  });

  it("names its interface keys by surface, never by one of ui's component prefixes", () => {
    const uiPrefixes = new Set(Object.keys(uiMessages).map((key) => key.split(".")[0]));
    uiPrefixes.delete("errors");
    for (const key of keys(imageEditorText)) {
      expect(uiPrefixes.has(key.split(".")[0]), key).toBe(false);
    }
  });

  it("holds every text of the three catalogues, unchanged, and is valid", () => {
    expect(keys(imageEditorMessages)).toEqual(
      new Set([...keys(imageMessages), ...keys(uiMessages), ...keys(imageEditorText)]),
    );
    for (const [key, value] of [
      ...Object.entries(imageMessages),
      ...Object.entries(uiMessages),
      ...Object.entries(imageEditorText),
    ]) {
      expect(imageEditorMessages[key as keyof typeof imageEditorMessages], key).toEqual(value);
    }
    expect(() => createMessages(imageEditorMessages)).not.toThrow();
  });

  it("gives the components the text of an error, a warning, a ui control and a tool", () => {
    const messages = createMessages(imageEditorMessages);
    expect(messages.t("errors.INVALID_IMAGE")).toContain("valid image");
    expect(messages.t("warnings.maxLayers", { actual: 1 })).toBe("This image has 1 layer.");
    expect(messages.t("dialog.close")).toBe("Close");
    expect(messages.t("tools.crop")).toBe("Crop");
  });
});
