"use client";

import { useEffect, type ComponentProps, type MutableRefObject } from "react";
import ForceGraph2D, { type ForceGraphMethods } from "react-force-graph-2d";

type Props = ComponentProps<typeof ForceGraph2D> & {
  graphRef: MutableRefObject<ForceGraphMethods | undefined>;
};

/**
 * Loaded through next/dynamic (canvas needs the browser). Lives in its own module because
 * next/dynamic does not forward refs; the parent passes `graphRef` instead.
 */
export default function ForceGraphCanvas({ graphRef, ...props }: Props) {
  useEffect(() => {
    const graph = graphRef.current;
    if (!graph) return;
    // Spread nodes out so labels don't collide.
    graph.d3Force("charge")?.strength(-420);
    graph.d3Force("link")?.distance(92);
    graph.d3ReheatSimulation();
  }, [graphRef]);

  return <ForceGraph2D ref={graphRef} {...props} />;
}
