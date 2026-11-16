import { type ReactNode, useEffect, useMemo, useRef, useSyncExternalStore } from "react";
import { engineInternals } from "../adapters/image-engine.js";
import { useImageInternals } from "./hooks.js";

const usable = () => false;
const unchanged = () => () => {};

/** Private binding: custom adapters do not acquire a built-in lifecycle contract. */
export function EngineBoundary({ children }: { readonly children: ReactNode }): ReactNode {
  const { engine, messages } = useImageInternals();
  const lifecycle = engineInternals(engine);
  const surface = useRef<HTMLDivElement>(null);
  const notice = useRef<HTMLParagraphElement>(null);
  const ownedFocus = useRef<Element | null>(null);
  const subscribe = useMemo(
    () =>
      lifecycle
        ? (changed: () => void) =>
            lifecycle.subscribe(() => {
              const active = document.activeElement;
              ownedFocus.current = active && surface.current?.contains(active) ? active : null;
              changed();
            })
        : unchanged,
    [lifecycle],
  );
  const terminal = useSyncExternalStore(subscribe, lifecycle?.getSnapshot ?? usable, usable);

  useEffect(() => {
    if (!terminal || !ownedFocus.current) return;
    const active = document.activeElement;
    // A dialog may restore an external opener on unmount; never steal it.
    if (active === document.body || active === ownedFocus.current) notice.current?.focus();
    ownedFocus.current = null;
  }, [terminal]);

  return (
    <div ref={surface} className="hm-image-engine-boundary">
      {terminal ? (
        <p ref={notice} role="alert" tabIndex={-1} className="hm-image-engine-unavailable">
          {messages.t("editor.engineUnavailable")}
        </p>
      ) : (
        children
      )}
    </div>
  );
}
