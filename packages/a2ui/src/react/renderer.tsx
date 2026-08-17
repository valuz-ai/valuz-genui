/* buildA2UISurfaces is a registry-backed helper, exported beside the component on purpose. */
/* eslint-disable react-refresh/only-export-components */
/**
 * `<A2UIRenderer>` — draw a (possibly still streaming) A2UI JSONL body.
 *
 * Subscribes to the component registry so extension components registered
 * after mount are picked up, sanitizes the body through the streaming
 * pipeline, and keeps the last good surface on screen while a newer chunk is
 * temporarily unparseable.
 */
import type { ReactComponentImplementation } from "@a2ui/react/v0_9";
import type { ActionListener, SurfaceModel } from "@a2ui/web_core/v0_9";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";

import { hasRenderableComponents, sanitizeA2UIStream, type RejectedComponent } from "../stream";
import { createValuzMessageProcessor } from "./catalog";
import {
  effectiveA2UIComponents,
  getA2UIRegistryVersion,
  subscribeA2UIComponents,
} from "./registry";
import { ValuzA2UISurface } from "./surface";

export interface A2UIRendererProps {
  /** Raw model output — JSONL, possibly cut mid-line while streaming. */
  body: string;
  status?: "running" | "success";
  theme?: "light" | "dark";
  className?: string;
  /** Called with the components dropped by schema validation (dev diagnostics). */
  onRejected?: (rejected: RejectedComponent[]) => void;
  /**
   * Receives every user action the surface dispatches (button `action`, form
   * `submit`, follow-up items, …) as an A2UI client action. Without it the
   * surface renders read-only: actions are dropped.
   */
  onAction?: ActionListener;
  /** Log skipped components and unrenderable payloads to the console. Off by default. */
  debug?: boolean;
}

interface BuiltSurfaces {
  surfaces: SurfaceModel<ReactComponentImplementation>[];
  rejected: RejectedComponent[];
}

export interface BuildA2UISurfacesOptions {
  /** Suppress console diagnostics for this build (a stream still in flight). */
  suppressWarnings?: boolean;
  /** Log diagnostics at all; off by default so hosts opt in explicitly. */
  debug?: boolean;
  /** Action listener installed on the message processor. */
  onAction?: ActionListener;
}

export function buildA2UISurfaces(body: string, options: BuildA2UISurfacesOptions | boolean = {}): BuiltSurfaces {
  const { suppressWarnings = false, debug = false, onAction } =
    typeof options === "boolean" ? { suppressWarnings: options } : options;
  const sanitized = sanitizeA2UIStream(body, effectiveA2UIComponents());
  const { messages, rejected } = sanitized;
  if (!messages.length || !hasRenderableComponents(messages)) return { surfaces: [], rejected };
  if (debug && rejected.length && !suppressWarnings) {
    console.warn("[a2ui] skipped invalid component(s)", JSON.stringify(rejected));
  }
  const processor = createValuzMessageProcessor(onAction);
  try {
    processor.processMessages(messages as never);
  } catch (error) {
    // Streaming JSON is completed best-effort before all required fields have
    // arrived; keep the last good surface instead of reporting expected
    // intermediate validation failures.
    if (debug && !suppressWarnings) {
      console.warn("[a2ui] failed to render payload", error);
    }
    return { surfaces: [], rejected };
  }
  return { surfaces: Array.from(processor.model.surfacesMap.values()), rejected };
}

function GenerationSkeleton() {
  return (
    <div className="va2-generation-skeleton" data-slot="a2ui-generation-skeleton" aria-hidden>
      <div className="va2-generation-skeleton__title" />
      <div className="va2-generation-skeleton__subtitle" />
      <div className="va2-generation-skeleton__grid">
        {[0, 1, 2].map((index) => (
          <div key={index} className="va2-generation-skeleton__card">
            <div className="va2-generation-skeleton__line va2-generation-skeleton__line--short" />
            <div className="va2-generation-skeleton__line" />
            <div className="va2-generation-skeleton__line va2-generation-skeleton__line--medium" />
          </div>
        ))}
      </div>
    </div>
  );
}

function GenerationTail() {
  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    let parent = element.parentElement;
    while (parent) {
      const overflow = getComputedStyle(parent).overflowY;
      if ((overflow === "auto" || overflow === "scroll") && parent.scrollHeight > parent.clientHeight) {
        if (parent.scrollHeight - parent.scrollTop - parent.clientHeight > 240) return;
        break;
      }
      parent = parent.parentElement;
    }
    element.scrollIntoView({ block: "end", behavior: "smooth" });
  });
  return (
    <div ref={ref} className="va2-generation-tail" data-slot="a2ui-generation-tail">
      <div className="va2-generation-skeleton__line va2-generation-skeleton__line--short" />
    </div>
  );
}

export function A2UIRenderer({ body, status, theme, className, onRejected, onAction, debug = false }: A2UIRendererProps) {
  const version = useSyncExternalStore(
    subscribeA2UIComponents,
    getA2UIRegistryVersion,
    getA2UIRegistryVersion,
  );

  // Surfaces are rebuilt only when the body changes; the listener installed on
  // them is a stable trampoline so a new `onAction` identity per render never
  // resets rendered state. The ref is refreshed after commit, before any user
  // event can reach the surface.
  const onActionRef = useRef<ActionListener | undefined>(onAction);
  useEffect(() => {
    onActionRef.current = onAction;
  }, [onAction]);
  const dispatchAction = useCallback<ActionListener>((action) => onActionRef.current?.(action), []);

  const built = useMemo(
    // `dispatchAction` only reads the ref when an event fires, never during render.
    // eslint-disable-next-line react-hooks/refs
    () => buildA2UISurfaces(body, { suppressWarnings: status === "running", debug, onAction: dispatchAction }),
    // `version` invalidates the memo when the registry changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [body, version, status, debug],
  );

  useEffect(() => {
    if (onRejected && status !== "running") onRejected(built.rejected);
    // Report once per finished body.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [built.rejected, status]);

  // Remember the last body that produced surfaces so a chunk that is
  // temporarily unparseable mid-stream keeps the previous frame on screen.
  // Derived state stored during render (React's "information from previous
  // renders" pattern): the guard makes the update converge in one re-render.
  const [lastGood, setLastGood] = useState<{ body: string; surfaces: SurfaceModel<ReactComponentImplementation>[] }>({
    body: "",
    surfaces: [],
  });
  if (built.surfaces.length && lastGood.body !== body) {
    setLastGood({ body, surfaces: built.surfaces });
  }
  const inherits = lastGood.surfaces.length > 0 && body.startsWith(lastGood.body);
  const surfaces = built.surfaces.length || status !== "running" || !inherits ? built.surfaces : lastGood.surfaces;

  if (!surfaces.length) return status === "running" ? <GenerationSkeleton /> : null;
  return (
    <div data-slot="a2ui-renderer" className={className}>
      {surfaces.map((surface) => (
        <ValuzA2UISurface key={surface.id} surface={surface} theme={theme} />
      ))}
      {status === "running" ? <GenerationTail /> : null}
    </div>
  );
}
