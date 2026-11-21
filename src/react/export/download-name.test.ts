import { MAX_FILE_NAME_LENGTH } from "@hussmartinez/sdk-core";
import { describe, expect, it } from "vitest";
import { downloadName } from "./download-name.js";

describe("a download's name (sdk-core ADR 0051)", () => {
  it("keeps a plain name, and adds the format's extension", () => {
    expect(downloadName("holiday", "png")).toBe("holiday.png");
    expect(downloadName("image", "jpg")).toBe("image.jpg");
  });

  it("cleans a name taken from a file: its path, a hidden direction change, a reserved character", () => {
    expect(downloadName("C:\\Users\\me\\holiday", "png")).toBe("holiday.png");
    expect(downloadName("../invoice\u202Efdp.exe", "webp")).toBe("invoicefdp.exe.webp");
    expect(downloadName('a<b>:"c|?*', "jpg")).toBe("abc.jpg");
  });

  it("falls back to image when nothing usable is left", () => {
    expect(downloadName("..", "png")).toBe("image.png");
    expect(downloadName("   ", "gif")).toBe("image.gif");
    expect(downloadName("\u202E", "png")).toBe("image.png");
  });

  it("shortens a long name so the extension stays", () => {
    const name = downloadName("a".repeat(500), "webp");
    expect(name.endsWith(".webp")).toBe(true);
    expect([...name]).toHaveLength(MAX_FILE_NAME_LENGTH);
  });
});
