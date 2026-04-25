import type { Block } from "../types";
import { BlockRow } from "./BlockRow";

interface Props {
  blocks: Block[];
  parentId: string | null;
}

export function BlockTree({ blocks, parentId }: Props) {
  const siblings = blocks
    .filter((b) => b.parent_id === parentId)
    .sort((a, b) => a.order - b.order);

  return (
    <>
      {siblings.map((b) => (
        <div key={b.id} data-block-id={b.id}>
          <BlockRow block={b} />
          {b.children.length > 0 && (
            <div className="block-children">
              <BlockTree blocks={blocks} parentId={b.id} />
            </div>
          )}
        </div>
      ))}
    </>
  );
}
