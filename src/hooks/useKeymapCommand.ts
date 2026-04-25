import { useEffect } from "react";
import { useKeymapStore, type KeymapCommand } from "../stores/keymap";

/**
 * Register a command for the lifetime of a component. The `cmd` object is
 * re-read on every render, but the registration is only recreated when
 * `deps` change — mimicking `useEffect`'s dependency contract. This keeps
 * the handler closure up-to-date without churning the commands Map.
 */
export function useKeymapCommand(
  cmd: KeymapCommand,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  deps: readonly any[] = [],
): void {
  const register = useKeymapStore((s) => s.registerCommand);
  useEffect(() => {
    const unregister = register(cmd);
    return unregister;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}
