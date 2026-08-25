import { describe, expect, it } from "vitest";

import {
  clampGraphPanForVisibility,
  computeAnchoredGraphPan,
  computeCenteredGraphPan,
  computeGraphFitTransformForRect,
  computeGraphPanForStableAnchor,
  computeGraphPanToCenterRect,
  computeGraphPanToRevealRect,
  getGraphPointerGesture,
  isGraphRectVisible
} from "../web/graphViewportTransform";

describe("graph viewport transforms", () => {
  it.each([
    { button: 0, altKey: false, interactive: false, expected: "pan" },
    { button: 0, altKey: true, interactive: false, expected: "select" },
    { button: 1, altKey: false, interactive: false, expected: "pan" },
    { button: 2, altKey: false, interactive: false, expected: "none" },
    { button: 0, altKey: false, interactive: true, expected: "none" }
  ] as const)(
    "maps button $button, alt=$altKey, interactive=$interactive to $expected",
    ({ button, altKey, interactive, expected }) => {
      expect(getGraphPointerGesture(button, altKey, interactive)).toBe(expected);
    }
  );

  it.each([
    { x: 24.25, y: 18.75 },
    { x: 312.5, y: 184.125 },
    { x: 975.75, y: 681.5 }
  ])("keeps the graph coordinate below pointer $x,$y fixed while zooming", (anchor) => {
    const currentPan = { x: 80, y: -40 };
    const previousZoom = 0.8;
    const nextZoom = 1.35;
    const graphPoint = {
      x: (anchor.x - currentPan.x) / previousZoom,
      y: (anchor.y - currentPan.y) / previousZoom
    };

    const nextPan = computeAnchoredGraphPan(currentPan, previousZoom, nextZoom, anchor);

    expect(graphPoint.x * nextZoom + nextPan.x).toBeCloseTo(anchor.x);
    expect(graphPoint.y * nextZoom + nextPan.y).toBeCloseTo(anchor.y);
  });

  it("does not accumulate anchor drift across repeated zoom round trips", () => {
    const anchor = { x: 713.375, y: 291.625 };
    const initialPan = { x: -96.25, y: 44.75 };
    let pan = initialPan;
    let zoom = 0.18;

    for (let index = 0; index < 200; index += 1) {
      const nextZoom = zoom * 1.01;
      pan = computeAnchoredGraphPan(pan, zoom, nextZoom, anchor);
      zoom = nextZoom;
    }
    for (let index = 0; index < 200; index += 1) {
      const nextZoom = zoom / 1.01;
      pan = computeAnchoredGraphPan(pan, zoom, nextZoom, anchor);
      zoom = nextZoom;
    }

    expect(zoom).toBeCloseTo(0.18, 12);
    expect(pan.x).toBeCloseTo(initialPan.x, 9);
    expect(pan.y).toBeCloseTo(initialPan.y, 9);
  });

  it("allows a pointer anchor to move the graph while keeping part of it visible", () => {
    expect(
      clampGraphPanForVisibility(
        { x: 75, y: -250 },
        { width: 1_000, height: 700 },
        { width: 1_000, height: 900 },
        48
      )
    ).toEqual({ x: 75, y: -250 });
  });

  it("prevents panning the whole graph outside the viewport", () => {
    expect(
      clampGraphPanForVisibility(
        { x: 5_000, y: -5_000 },
        { width: 1_000, height: 700 },
        { width: 1_600, height: 900 },
        48
      )
    ).toEqual({ x: 952, y: -852 });
  });

  it("centers a fitted graph in both viewport axes", () => {
    expect(
      computeCenteredGraphPan({ width: 1_000, height: 700 }, { width: 760, height: 420 })
    ).toEqual({ x: 120, y: 140 });
  });

  it("keeps the same task at the same screen position after a layout reorder", () => {
    expect(
      computeGraphPanForStableAnchor({ x: -320, y: 80 }, { x: 140, y: 120 }, { x: 460, y: 40 })
    ).toEqual({ x: -640, y: 160 });
  });

  it("fits and centers a work-focus group without zooming above 100 percent", () => {
    const focused = computeGraphFitTransformForRect(
      { width: 1_000, height: 700 },
      { x: 800, y: 300, width: 2_000, height: 500 },
      16
    );
    expect(focused.zoom).toBeCloseTo(0.484);
    expect(focused.pan.x).toBeCloseTo(-371.2);
    expect(focused.pan.y).toBeCloseTo(83.8);

    expect(
      computeGraphFitTransformForRect(
        { width: 1_000, height: 700 },
        { x: 800, y: 300, width: 252, height: 160 },
        16
      ).zoom
    ).toBe(1);
  });

  it("recenters a surviving filtered group without changing zoom", () => {
    const viewport = { width: 800, height: 500 };
    const survivingBounds = { x: 900, y: 420, width: 252, height: 240 };
    const zoom = 0.8;
    const pan = computeGraphPanToCenterRect(viewport, survivingBounds, zoom);

    expect(pan.x).toBeCloseTo(-420.8);
    expect(pan.y).toBe(-182);
    expect(isGraphRectVisible(survivingBounds, pan, zoom, viewport, 12)).toBe(true);
  });

  it("detects when a graph card has moved fully outside the viewport", () => {
    expect(
      isGraphRectVisible(
        { x: 900, y: 420, width: 252, height: 160 },
        { x: -1_400, y: -800 },
        1,
        { width: 800, height: 500 },
        12
      )
    ).toBe(false);
  });

  it("reveals a keyboard-focused graph card with padding", () => {
    expect(
      computeGraphPanToRevealRect(
        { x: 900, y: 420, width: 252, height: 160 },
        { x: -1_000, y: -450 },
        1,
        { width: 800, height: 500 },
        16
      )
    ).toEqual({ x: -884, y: -404 });
  });
});
