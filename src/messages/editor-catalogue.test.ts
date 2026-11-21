import { sdkCoreMessages } from "@hussmartinez/sdk-core";
import { uiMessages } from "@hussmartinez/ui";
import { describe, expect, it } from "vitest";
import { imageEditorText } from "./editor-en.js";
import { imageMessages } from "./en.js";

/**
 * The interface text, which only the React entry's catalogue holds
 * (sdk-core ADR 0059). That `.`'s catalogue holds nothing else is tested
 * in `en.test.ts`.
 */

/** The prefixes of the keys that `.`'s catalogue holds. */
const SERVER_SAFE_PREFIXES = ["errors.", "warnings."];

const interfaceKeys = Object.keys(imageEditorText);

describe("the interface text (sdk-core ADR 0059)", () => {
  it("stays out of the server-safe catalogue's prefixes", () => {
    expect(interfaceKeys.length).toBeGreaterThan(0);
    for (const key of interfaceKeys) {
      const prefix = SERVER_SAFE_PREFIXES.find((start) => key.startsWith(start));
      expect(prefix, key).toBeUndefined();
    }
  });

  it("shares no key with `.`'s catalogue, sdk-core's or ui's (sdk-core ADR 0046)", () => {
    for (const key of interfaceKeys) {
      expect(Object.hasOwn(imageMessages, key), `${key} in imageMessages`).toBe(false);
      expect(Object.hasOwn(sdkCoreMessages, key), `${key} in sdkCoreMessages`).toBe(false);
      expect(Object.hasOwn(uiMessages, key), `${key} in uiMessages`).toBe(false);
    }
  });

  it("keeps its keys, which hosts' typed overrides name", () => {
    // The API reports name the catalogue's type without listing its keys, so
    // this snapshot is where a renamed or removed key shows in review: it
    // breaks a host's MessageOverrides<ImageEditorMessageCatalogue>.
    expect([...interfaceKeys].sort()).toMatchSnapshot();
  });
});
