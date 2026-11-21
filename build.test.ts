import { readdirSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { build as esbuild } from "esbuild";
import { build, type Rolldown } from "vite";
import { afterAll, describe, expect, it } from "vitest";
import { externalPackages } from "./vite.config.js";

/**
 * Builds the package in memory with its real Vite config, so these checks see
 * exactly what dist/ would contain without writing to it.
 */
async function buildInMemory(): Promise<Array<Rolldown.OutputChunk | Rolldown.OutputAsset>> {
  const result = await build({
    configFile: new URL("vite.config.ts", import.meta.url).pathname,
    logLevel: "silent",
    build: { write: false },
  });
  const outputs = Array.isArray(result) ? result : [result];
  return outputs.flatMap((output) => ("output" in output ? output.output : []));
}

const files = await buildInMemory();

function chunk(fileName: string): Rolldown.OutputChunk {
  const found = files.find((file) => file.fileName === fileName);
  if (found?.type !== "chunk") {
    throw new Error(`${fileName} wasn't built as a JavaScript chunk`);
  }
  return found;
}

/**
 * An entry and every chunk it loads statically: what a page that imports the
 * entry downloads, since shared code moves into shared/ chunks.
 */
function loadedBy(entry: string): Rolldown.OutputChunk[] {
  const seen = new Map<string, Rolldown.OutputChunk>();
  const visit = (fileName: string) => {
    if (seen.has(fileName)) return;
    const found = chunk(fileName);
    seen.set(fileName, found);
    for (const imported of found.imports) {
      if (files.some((file) => file.fileName === imported)) visit(imported);
    }
  };
  visit(entry);
  return [...seen.values()];
}

describe("the built package", () => {
  it('starts the React entry with "use client" (ADR 0007)', () => {
    expect(chunk("react.js").code).toMatch(/^"use client";\n/);
  });

  it('keeps "use client" out of the core and element entries (ADR 0004)', () => {
    expect(chunk("index.js").code).not.toContain("use client");
    expect(chunk("element.js").code).not.toContain("use client");
  });

  it("emits the stylesheet as its own file", () => {
    const styles = files.find((file) => file.fileName === "styles.css");
    expect(styles?.type).toBe("asset");
  });

  it("imports sdk-core and React instead of bundling them", () => {
    expect(externalPackages).toEqual(
      expect.arrayContaining(["@hussmartinez/sdk-core", "react", "react-dom"]),
    );
    expect(
      loadedBy("index.js")
        .map((loaded) => loaded.code)
        .join("\n"),
    ).toContain('from "@hussmartinez/sdk-core"');
    for (const file of files) {
      if (file.type === "chunk") {
        // Bundled React or sdk-core would bring their own copies of these, and
        // a page with several SDKs would load sdk-core more than once.
        expect(file.code, file.fileName).not.toContain("react.transitional.element");
        expect(file.code, file.fileName).not.toContain("class SdkError");
      }
    }
  });

  it("uses the production JSX runtime and leaks no local paths", () => {
    const code = files.flatMap((file) => (file.type === "chunk" ? [file.code] : [])).join("\n");
    expect(code).not.toContain("jsx-dev-runtime");
    expect(code).not.toContain(process.cwd());
  });

  it("never imports CSS from JavaScript (ADR 0004)", () => {
    const javascript = files.filter((file) => file.type === "chunk");
    expect(javascript.length).toBeGreaterThan(0);
    for (const file of javascript) {
      expect(file.imports.filter((name) => name.endsWith(".css"))).toEqual([]);
      expect(file.code).not.toMatch(/import\s*["'][^"']+\.css["']/);
    }
  });
});

/**
 * Builds the package to a temporary folder inside the repository, so the
 * built files resolve their external imports from its node_modules, as they
 * would in an application.
 */
const temporaryBuild = (async () => {
  const parent = join(process.cwd(), "temp");
  await mkdir(parent, { recursive: true });
  const directory = await mkdtemp(join(parent, "build-test-"));
  await build({
    configFile: new URL("vite.config.ts", import.meta.url).pathname,
    logLevel: "silent",
    build: { outDir: directory, emptyOutDir: true },
  });
  return directory;
})();

afterAll(async () => {
  await rm(await temporaryBuild, { recursive: true, force: true });
});

/**
 * One import from a built entry, bundled and minified as an application's
 * bundler would, with the packages left out: what that import ships.
 */
async function bundledAlone(entry: string, name: string): Promise<string> {
  const directory = await temporaryBuild;
  const file = join(directory, `only-${name}.js`);
  await writeFile(file, `export { ${name} } from "./${entry}";\n`);
  const result = await build({
    configFile: false,
    logLevel: "silent",
    build: {
      write: false,
      minify: true,
      lib: { entry: file, formats: ["es"], fileName: "only" },
      rolldownOptions: {
        external: (id) =>
          externalPackages.some((package_) => id === package_ || id.startsWith(`${package_}/`)) ||
          id.includes("/lazy/") ||
          id.startsWith("#hm-image-"),
      },
    },
  });
  const outputs = (Array.isArray(result) ? result : [result]).flatMap((output) =>
    "output" in output ? output.output : [],
  );
  return outputs.map((output) => (output.type === "chunk" ? output.code : "")).join("");
}

describe("the React entry comes apart (sdk-core ADR 0056)", () => {
  // Top-level code a bundler can't prove free of side effects keeps whatever
  // it references in every bundle: a call without `/* @__PURE__ */`, a spread
  // in a module-level literal. Once, importing the message catalogue alone
  // shipped the whole editor, 40 kB of the entry's 41. This bundles with
  // Rolldown, as Vite does; esbuild, which the family measures with, also
  // keeps a spread inside a marked call's argument, which Rolldown drops, so
  // that case is left to the per-import budgets of sdk-core ADR 0056.
  it("ships the message catalogue alone without the editor", async () => {
    const code = await bundledAlone("react.js", "imageEditorMessages");
    expect(code).toContain("errors.INVALID_IMAGE");
    // The tools' definitions, React's contexts and refs, a tool's id, and the
    // limit definitions' objects (a message key only names them).
    for (const kept of [
      /\bdefineTool\b/,
      /\bcreateContext\b/,
      /\bforwardRef\b/,
      /"image\.export"/,
      /\bmaxImagePixels\s*:\s*\{/,
    ]) {
      expect(code, String(kept)).not.toMatch(kept);
    }
  });
});

describe("importing on a server", () => {
  // The unit project runs in Node, without a DOM, as a server would.
  it.each(["index.js", "element.js"])(
    "imports %s without touching browser APIs (ADR 0004, ADR 0007)",
    async (entry) => {
      expect(globalThis).not.toHaveProperty("window");
      expect(globalThis).not.toHaveProperty("customElements");
      const url = pathToFileURL(join(await temporaryBuild, entry)).href;
      await expect(import(url)).resolves.toBeTypeOf("object");
    },
  );
});
/**
 * Code generation from strings: `eval(…)`, `new Function(…)` and
 * `Function(…)`, as whole words, so `evaluate(` doesn't match (ADR 0028).
 */
const CODE_GENERATION = /(?<![\w$.])eval\s*\(|(?<![\w$.])(?:new\s+)?Function\s*\(/;

const jobWorker = () => {
  const found = files.find((file) => file.fileName === "lazy/inline-job-worker.js");
  if (found?.type !== "chunk") throw new Error("the inlined job worker chunk wasn't built");
  return found;
};

describe("the job worker (docs/adr/0011)", () => {
  it("is inlined in a lazy chunk that only import() loads, never the entries", () => {
    expect(jobWorker().code).toContain("hm-image-job");
    for (const entry of ["index.js", "react.js", "element.js"]) {
      expect(chunk(entry).imports, entry).not.toContain(jobWorker().fileName);
    }
  });

  it("bundles the GIF encoder, and nothing else bundles it", () => {
    // An error message of gifenc's own: the decoder's code names NETSCAPE2.0 too.
    const encoder = (code: string) =>
      code.includes("First frame must include a { palette } option");
    expect(encoder(jobWorker().code)).toBe(true);
    for (const file of files) {
      if (file.type === "chunk" && file !== jobWorker()) {
        expect(encoder(file.code), file.fileName).toBe(false);
      }
    }
  });

  it("generates no code from strings, and makes no requests of its own", () => {
    expect(jobWorker().code).not.toMatch(CODE_GENERATION);
    expect(jobWorker().code).not.toMatch(/\bfetch\s*\(|XMLHttpRequest|importScripts|WebSocket/);
  });

  it("is written to dist/assets/image/job.worker.js too, one module with no imports and the version", async () => {
    const found = files.find((file) => file.fileName === "assets/image/job.worker.js");
    if (found?.type !== "asset") throw new Error("dist/assets/image/job.worker.js wasn't built");
    const code = String(found.source);
    expect(code).not.toMatch(/^\s*import\s|\bimport\s*\(/m);
    expect(code).toContain("hm-rpc");
    expect(code).not.toMatch(CODE_GENERATION);
    expect(code).not.toMatch(/\bfetch\s*\(|XMLHttpRequest|importScripts|WebSocket/);
    const { version } = JSON.parse(await readFile("package.json", "utf8")) as { version: string };
    expect(code).toMatch(
      new RegExp(`packageVersion:[\`"']${version.replaceAll(".", "\\.")}[\`"']`),
    );
  });

  it("ships NOTICE, which credits the encoder it bundles", async () => {
    const manifest = JSON.parse(await readFile("package.json", "utf8")) as { files: string[] };
    expect(manifest.files).toContain("NOTICE");
    const notice = await readFile("NOTICE", "utf8");
    expect(notice).toContain("gifenc 1.0.3");
    expect(notice).toContain("Copyright (c) 2017 Matt DesLauriers");
    expect(notice).toContain("The MIT License (MIT)");
  });
});

describe("the render worker (docs/adr/0002)", () => {
  const worker = () => {
    const found = files.find((file) => file.fileName === "lazy/inline-worker.js");
    if (found?.type !== "chunk") throw new Error("the inlined worker chunk wasn't built");
    return found;
  };

  it("recognises code generation, and nothing that merely looks like it", () => {
    for (const code of ['eval("1")', 'new Function("a", "return a")', "x = Function ('y')"]) {
      expect(code).toMatch(CODE_GENERATION);
    }
    for (const code of ["evaluate(x)", "a.eval(x)", "isFunction(x)"]) {
      expect(code).not.toMatch(CODE_GENERATION);
    }
  });

  it("is inlined in a lazy chunk that only import() loads, never the entries", () => {
    expect(worker().code).toContain("hm-image-render");
    for (const entry of ["index.js", "react.js", "element.js"]) {
      expect(
        chunk(entry).imports.filter((name) => name.startsWith("lazy/")),
        entry,
      ).toEqual([]);
    }
    // Something the core entry loads imports it, lazily, as it does the job
    // worker (docs/adr/0011), and nothing else. Both load through
    // package.json's imports, which the host's bundler resolves (sdk-core
    // ADR 0060).
    expect(
      loadedBy("index.js")
        .flatMap((loaded) => loaded.dynamicImports)
        .sort(),
    ).toEqual(["#hm-image-job-worker", "#hm-image-render-worker"]);
  });

  it("generates no code from strings, in any chunk, including the inlined worker", () => {
    for (const file of files) {
      if (file.type === "chunk") expect(file.code, file.fileName).not.toMatch(CODE_GENERATION);
    }
  });

  it("makes no requests of its own", () => {
    // The worker's only inputs are the Blobs the page sends it.
    expect(worker().code).not.toMatch(/\bfetch\s*\(|XMLHttpRequest|importScripts|WebSocket/);
  });

  it("ships no worker source maps", () => {
    expect(files.filter((file) => /\.worker-[\w-]+\.js\.map$/.test(file.fileName))).toEqual([]);
    expect(worker().code).not.toMatch(/sourceMappingURL=data:/);
  });
});

/**
 * Writes this build into `dir` as an installed package would hold it: its
 * JavaScript under dist/, and a package.json with its exports and imports,
 * so `#hm-image-render-worker` and `#hm-image-job-worker` resolve as they do
 * for a host.
 */
async function writePackage(dir: string): Promise<void> {
  for (const file of files) {
    if (file.type !== "chunk") continue;
    await mkdir(dirname(join(dir, "dist", file.fileName)), { recursive: true });
    await writeFile(join(dir, "dist", file.fileName), file.code);
  }
  const manifest = JSON.parse(await readFile(new URL("package.json", import.meta.url), "utf8"));
  const { name, type, exports, imports } = manifest;
  await writeFile(join(dir, "package.json"), JSON.stringify({ name, type, exports, imports }));
}

describe("the hm-self-hosted condition (sdk-core ADR 0060)", () => {
  /**
   * Bundles an application that passes assetsUrl against this build, laid
   * out as an installed package, with esbuild and `conditions`. Returns the
   * code of every output file.
   */
  async function bundle(conditions: string[]): Promise<string[]> {
    const dir = await mkdtemp(join(tmpdir(), "hm-image-sdk-condition-"));
    try {
      await writePackage(join(dir, "node_modules/@hussmartinez/image-sdk"));
      await writeFile(
        join(dir, "app.js"),
        [
          'import { createImageEngine, createImageProcessor } from "@hussmartinez/image-sdk";',
          'export const engine = createImageEngine({ assetsUrl: "/image-sdk/" });',
          "export const processor = createImageProcessor(engine);",
        ].join("\n"),
      );
      const result = await esbuild({
        absWorkingDir: dir,
        entryPoints: ["app.js"],
        bundle: true,
        format: "esm",
        splitting: true,
        outdir: "out",
        write: false,
        logLevel: "silent",
        conditions,
        external: externalPackages,
      });
      return result.outputFiles.map((output) => output.text);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }

  /** An inlined worker: Vite turns it into a blob that revokes its own URL. */
  const inlinedWorker = (code: string) => code.includes("URL.revokeObjectURL(import.meta.url);");

  it("leaves both inlined workers out of a build that sets it", async () => {
    const outputs = await bundle(["hm-self-hosted"]);
    expect(outputs.filter(inlinedWorker)).toEqual([]);
    expect(outputs.join("\n")).toContain("left the image SDK's inlined workers out");
  });

  it("keeps them in a build that doesn't, as before", async () => {
    const outputs = await bundle([]);
    expect(outputs.filter(inlinedWorker)).toHaveLength(2);
    expect(outputs.join("\n")).not.toContain("left the image SDK's inlined workers out");
  });
});

describe("the self-hosted worker (docs/adr/0002)", () => {
  const selfHosted = () => {
    const found = files.find((file) => file.fileName === "assets/image/render.worker.js");
    if (found?.type !== "asset") throw new Error("dist/assets/image/render.worker.js wasn't built");
    return String(found.source);
  };

  it("is written to dist/assets/image/render.worker.js, as one module with no imports", () => {
    const code = selfHosted();
    expect(code).not.toMatch(/^\s*import\s|\bimport\s*\(/m);
    expect(code).toContain("hm-rpc");
  });

  it("carries this package's version, which the engine checks", async () => {
    const { version } = JSON.parse(await readFile("package.json", "utf8")) as { version: string };
    // In any quotes: the minifier may write it as a template literal.
    const escaped = version.replaceAll(".", "\\.");
    expect(selfHosted()).toMatch(new RegExp(`packageVersion:[\`"']${escaped}[\`"']`));
  });

  it("generates no code from strings, and makes no requests", () => {
    const code = selfHosted();
    expect(code).not.toMatch(CODE_GENERATION);
    expect(code).not.toMatch(/\bfetch\s*\(|XMLHttpRequest|importScripts|WebSocket/);
  });
});

describe("the format schemas (sdk-core ADR 0045)", () => {
  it("ship with the package, each by its path under ./formats/, and the vectors don't", async () => {
    const manifest = JSON.parse(await readFile(new URL("package.json", import.meta.url), "utf8"));
    expect(manifest.files).toContain("formats");
    expect(manifest.files).not.toContain("conformance");
    expect(manifest.exports["./formats/*"]).toBe("./formats/*");
    // The package resolves itself by name, as a host's import would.
    const require = createRequire(import.meta.url);
    const formats = readdirSync(new URL("formats", import.meta.url));
    expect(formats.sort()).toEqual(["hm-image-command", "hm-image-plan"]);
    for (const format of formats) {
      const path = require.resolve(`@hussmartinez/image-sdk/formats/${format}/v1.schema.json`);
      const schema = JSON.parse(await readFile(path, "utf8"));
      expect(schema.$id).toBe(
        `https://github.com/ie-huss-martinez/image-sdk/blob/main/formats/${format}/v1.schema.json`,
      );
    }
  });
});
