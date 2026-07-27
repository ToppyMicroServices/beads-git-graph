export interface GraphPoint {
  x: number;
  y: number;
}

export interface GraphSize {
  width: number;
  height: number;
}

export function computeAnchoredGraphPan(
  currentPan: GraphPoint,
  previousZoom: number,
  nextZoom: number,
  anchor: GraphPoint
): GraphPoint {
  const contentX = (anchor.x - currentPan.x) / previousZoom;
  const contentY = (anchor.y - currentPan.y) / previousZoom;
  return {
    x: anchor.x - contentX * nextZoom,
    y: anchor.y - contentY * nextZoom
  };
}

export function computeCenteredGraphPan(viewport: GraphSize, scaledContent: GraphSize): GraphPoint {
  return {
    x: (viewport.width - scaledContent.width) / 2,
    y: (viewport.height - scaledContent.height) / 2
  };
}

export function clampGraphPanForVisibility(
  pan: GraphPoint,
  viewport: GraphSize,
  scaledContent: GraphSize,
  minimumVisibleSize: number
): GraphPoint {
  const clampAxis = (position: number, viewportSize: number, contentSize: number) => {
    const visibleSize = Math.min(minimumVisibleSize, viewportSize, contentSize);
    const minimum = visibleSize - contentSize;
    const maximum = viewportSize - visibleSize;
    return Math.min(maximum, Math.max(minimum, position));
  };

  return {
    x: clampAxis(pan.x, viewport.width, scaledContent.width),
    y: clampAxis(pan.y, viewport.height, scaledContent.height)
  };
}
