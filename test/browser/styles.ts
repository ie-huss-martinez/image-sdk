import stylesUrl from "../../src/styles.css?url";

/**
 * ui's stylesheet, as the test server serves the installed package: a URL,
 * not an import, which the dependency check can't resolve with a query.
 */
const uiStylesUrl = new URL("../../node_modules/@hussmartinez/ui/dist/styles.css", import.meta.url)
  .href;

async function link(href: string): Promise<HTMLLinkElement> {
  const element = document.createElement("link");
  element.rel = "stylesheet";
  element.href = href;
  await new Promise((resolve, reject) => {
    element.addEventListener("load", resolve, { once: true });
    element.addEventListener("error", reject, { once: true });
    document.head.append(element);
  });
  return element;
}

/**
 * Loads ui's stylesheet, then the package's, as hosts do (sdk-core ADR
 * 0036), so the editor lays out as it does for them: the canvas positioned
 * over the stage and the stage at its minimum size, rather than sized by
 * whatever intrinsic size each engine gives the canvas. Returns a function
 * that removes them.
 */
export async function loadStyles(): Promise<() => void> {
  const added = [await link(uiStylesUrl), await link(stylesUrl)];
  return () => {
    for (const element of added) element.remove();
  };
}
