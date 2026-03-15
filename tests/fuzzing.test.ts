import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { normalizeBeadPriority, normalizeBeadStatus } from "../src/beadsData";

describe("property-based normalization", () => {
  it("keeps priority normalization within the supported priority range", () => {
    fc.assert(
      fc.property(fc.string(), (input) => {
        const normalized = normalizeBeadPriority(input);
        expect(normalized).toMatch(/^P[0-4]$/);
        expect(normalizeBeadPriority(normalized)).toBe(normalized);
      })
    );
  });

  it("keeps status normalization inside the supported status set", () => {
    fc.assert(
      fc.property(fc.string(), (input) => {
        const normalized = normalizeBeadStatus(input);
        expect(["open", "in_progress", "blocked", "closed", "other"]).toContain(normalized);
        expect(normalizeBeadStatus(normalized)).toBe(normalized);
      })
    );
  });
});
