import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { AVIF_CALIBRATION, HEIF_CALIBRATION } from "./calibration-files.js";

describe("the embedded calibration files", () => {
  it.each([
    ["quadrants-irot1-imir0.avif", AVIF_CALIBRATION],
    ["quadrants-rotate-cw90.heic", HEIF_CALIBRATION],
  ])("match e2e/fixtures/%s, which the capability matrix decodes", (name, embedded) => {
    const fixture = readFileSync(new URL(`../../../e2e/fixtures/${name}`, import.meta.url));
    expect(embedded).toBe(fixture.toString("base64"));
  });
});
