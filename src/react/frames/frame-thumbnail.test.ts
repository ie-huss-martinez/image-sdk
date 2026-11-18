import { describe, expect, it } from "vitest";
import { createThumbnailSlots } from "./FrameThumbnail.js";
import { frameSeconds } from "./use-frames.js";

describe("the frames list's thumbnails and names (docs/adr/0011)", () => {
  it("draws at most the cap at once; the rest wait, first come first served", () => {
    const slots = createThumbnailSlots(2);
    const started: string[] = [];
    const give = ["a", "b", "c", "d"].map((name) => slots.take(() => started.push(name)));
    expect(started).toEqual(["a", "b"]);
    expect(slots.used()).toBe(2);
    // One that stops waiting never starts.
    give[2]?.();
    give[0]?.();
    expect(started).toEqual(["a", "b", "d"]);
    expect(slots.used()).toBe(2);
    // Giving one back twice frees it once.
    give[0]?.();
    give[1]?.();
    give[3]?.();
    expect(slots.used()).toBe(0);
  });

  it("shows a delay as seconds with two decimals, in the locale", () => {
    expect(frameSeconds(10, "en")).toBe("0.10");
    expect(frameSeconds(3, "en")).toBe("0.03");
    expect(frameSeconds(150, "en")).toBe("1.50");
    expect(frameSeconds(65_535, "en")).toBe("655.35");
    expect(frameSeconds(10, "de")).toBe("0,10");
  });
});
