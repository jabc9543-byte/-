import { useEffect, useState } from "react";

/**
 * Track whether the given CSS media query currently matches. Re-renders
 * when the match state changes. Safe for SSR/test environments (falls
 * back to `false` if `window.matchMedia` is unavailable).
 */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => {
    if (typeof window === "undefined" || !window.matchMedia) return false;
    return window.matchMedia(query).matches;
  });
  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mql = window.matchMedia(query);
    const handler = (e: MediaQueryListEvent) => setMatches(e.matches);
    setMatches(mql.matches);
    // addEventListener is widely supported; fall back just in case.
    if (mql.addEventListener) {
      mql.addEventListener("change", handler);
      return () => mql.removeEventListener("change", handler);
    }
    mql.addListener(handler);
    return () => {
      mql.removeListener(handler);
    };
  }, [query]);
  return matches;
}

/** Convenience: true when viewport is narrow enough to use the mobile layout. */
export function useIsMobile(): boolean {
  return useMediaQuery("(max-width: 900px)");
}

/** True when the primary pointer is coarse (finger / stylus) — i.e. touch. */
export function useIsTouch(): boolean {
  return useMediaQuery("(pointer: coarse)");
}

