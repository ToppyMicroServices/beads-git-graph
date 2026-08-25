export interface GraphPoint {
  x: number;
  y: number;
}

export interface GraphSize {
  width: number;
  height: number;
}

export interface GraphRect extends GraphPoint, GraphSize {}

export type GraphPointerGesture = "pan" | "select" | "none";

export function getGraphPointerGesture(
  button: number,
  altKey: boolean,
  interactiveTarget: boolean
): GraphPointerGesture {
  if (interactiveTarget) {
    return "none";
  }
  if (button === 0) {
    return altKey ? "select" : "pan";
  }
  return button === 1 ? "pan" : "none";
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

export function computeGraphPanForStableAnchor(
  currentPan: GraphPoint,
  previousAnchor: GraphPoint,
  nextAnchor: GraphPoint
): GraphPoint {
  return {
    x: currentPan.x + previousAnchor.x - nextAnchor.x,
    y: currentPan.y + previousAnchor.y - nextAnchor.y
  };
}

export function computeGraphPanToCenterRect(
  viewport: GraphSize,
  rect: GraphRect,
  zoom: number
): GraphPoint {
  return {
    x: viewport.width / 2 - (rect.x + rect.width / 2) * zoom,
    y: viewport.height / 2 - (rect.y + rect.height / 2) * zoom
  };
}

export function computeGraphFitTransformForRect(
  viewport: GraphSize,
  rect: GraphRect,
  padding: number,
  maximumZoom: number = 1
) {
  const availableWidth = Math.max(1, viewport.width - padding * 2);
  const availableHeight = Math.max(1, viewport.height - padding * 2);
  const zoom = Math.min(
    maximumZoom,
    availableWidth / Math.max(1, rect.width),
    availableHeight / Math.max(1, rect.height)
  );
  return {
    zoom,
    pan: computeGraphPanToCenterRect(viewport, rect, zoom)
  };
}

export function isGraphRectVisible(
  rect: GraphRect,
  pan: GraphPoint,
  zoom: number,
  viewport: GraphSize,
  minimumVisibleSize: number
) {
  const left = pan.x + rect.x * zoom;
  const top = pan.y + rect.y * zoom;
  const right = left + rect.width * zoom;
  const bottom = top + rect.height * zoom;
  const visibleWidth = Math.max(0, Math.min(viewport.width, right) - Math.max(0, left));
  const visibleHeight = Math.max(0, Math.min(viewport.height, bottom) - Math.max(0, top));
  const requiredWidth = Math.min(minimumVisibleSize, rect.width * zoom, viewport.width);
  const requiredHeight = Math.min(minimumVisibleSize, rect.height * zoom, viewport.height);
  return visibleWidth >= requiredWidth && visibleHeight >= requiredHeight;
}

export function computeGraphPanToRevealRect(
  rect: GraphRect,
  pan: GraphPoint,
  zoom: number,
  viewport: GraphSize,
  padding: number
): GraphPoint {
  const left = pan.x + rect.x * zoom;
  const top = pan.y + rect.y * zoom;
  const right = left + rect.width * zoom;
  const bottom = top + rect.height * zoom;
  let x = pan.x;
  let y = pan.y;

  if (left < padding) {
    x += padding - left;
  } else if (right > viewport.width - padding) {
    x -= right - (viewport.width - padding);
  }
  if (top < padding) {
    y += padding - top;
  } else if (bottom > viewport.height - padding) {
    y -= bottom - (viewport.height - padding);
  }
  return { x, y };
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
