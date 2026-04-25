import type { TaskMarker } from "../types";
import { usePageStore } from "../stores/page";

interface Props {
  blockId: string;
  marker: TaskMarker | null;
}

/**
 * Compact, clickable pill showing a block's current TODO/DOING/DONE state.
 * Clicking rotates to the next state via the backend `cycle_task` command.
 */
export function TaskMarkerPill({ blockId, marker }: Props) {
  const cycle = usePageStore((s) => s.cycleTask);
  if (!marker) return null;
  const onClick = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    cycle(blockId);
  };
  return (
    <button
      className={`task-pill task-${marker.toLowerCase()}`}
      onClick={onClick}
      title="切换任务状态"
    >
      {marker}
    </button>
  );
}
