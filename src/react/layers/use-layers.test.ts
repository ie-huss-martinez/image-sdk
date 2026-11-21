import { describe, expect, it } from "vitest";
import { fitLayerName, fitLayerText } from "./use-layers.js";

describe("text as the plan takes it (ADR 0009)", () => {
  it("makes every line break a line feed, wherever the text came from", () => {
    expect(fitLayerText("one\r\ntwo\rthree\nfour")).toBe("one\ntwo\nthree\nfour");
    expect(fitLayerText("a\r\n\r\nb")).toBe("a\n\nb");
  });

  it("makes a tab a space, and drops what text can't hold", () => {
    expect(fitLayerText("a\tb")).toBe("a b");
    expect(fitLayerText("a\u0000b\u0007c\u007fd")).toBe("abcd");
    // Bidirectional overrides and isolates.
    expect(fitLayerText("safe\u202Egnp.exe\u2066x\u2069")).toBe("safegnp.exex");
  });

  it("keeps spaces at the ends, and limits the length in code points", () => {
    expect(fitLayerText("  a  ")).toBe("  a  ");
    expect([...fitLayerText("😀".repeat(1_200))]).toHaveLength(1_000);
    expect(fitLayerText("😀".repeat(1_200)).endsWith("😀")).toBe(true);
  });

  it("gives a name no line of its own to break, within 100 code points", () => {
    expect(fitLayerName("  Stamp\u202E 2  ")).toBe("Stamp 2");
    expect([...fitLayerName("é".repeat(150))]).toHaveLength(100);
  });
});
