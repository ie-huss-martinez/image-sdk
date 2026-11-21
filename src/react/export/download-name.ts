import { cleanFileName, MAX_FILE_NAME_LENGTH } from "@hussmartinez/sdk-core";

/**
 * A download's name: the host's base name cleaned as sdk-core's
 * `cleanFileName` cleans a file's name (sdk-core ADR 0051), or `image` when
 * nothing usable is left, then the format's extension. The base is shortened
 * so the whole name fits in `MAX_FILE_NAME_LENGTH` code points with its
 * extension: cleaning the whole name would cut the extension off a long one.
 */
export function downloadName(base: string, extension: string): string {
  const cleaned = cleanFileName(base) ?? "image";
  const room = MAX_FILE_NAME_LENGTH - extension.length - 1;
  const fitted = [...cleaned].slice(0, room).join("").trimEnd();
  return `${fitted === "" ? "image" : fitted}.${extension}`;
}
