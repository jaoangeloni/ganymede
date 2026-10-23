import { useEffect, useState } from "react";
import { DragGhost } from "../../components/DragGhost";
import { followDrag } from "../../lib/drag";
import type { Point, Reference } from "../../types";

export function CarryGhost({ refs }: { refs: Reference[] }) {
  const [at, setAt] = useState<Point | null>(null);
  useEffect(
    () =>
      followDrag(
        (event) => setAt({ x: event.clientX, y: event.clientY }),
        () => setAt(null),
      ),
    [],
  );
  return at && <DragGhost refs={refs} x={at.x} y={at.y} />;
}
