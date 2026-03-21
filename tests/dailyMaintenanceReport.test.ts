import { describe, expect, it } from "vitest";

import {
  buildDailyMaintenanceBody,
  hasActionableDailyMaintenance
} from "../scripts/daily-maintenance-report.mjs";

describe("daily maintenance report", () => {
  it("treats open pull requests and alerts as actionable", () => {
    expect(
      hasActionableDailyMaintenance({
        pullRequests: [{ number: 1 }],
        codeScanningAlerts: [],
        dependabotAlerts: [],
        fetchErrors: []
      })
    ).toBe(true);

    expect(
      hasActionableDailyMaintenance({
        pullRequests: [],
        codeScanningAlerts: [],
        dependabotAlerts: [],
        fetchErrors: []
      })
    ).toBe(false);
  });

  it("renders a readable markdown summary", () => {
    const body = buildDailyMaintenanceBody({
      repository: "ToppyMicroServices/beads-git-graph",
      generatedAt: "2026-03-21T00:15:00.000Z",
      pullRequests: [
        {
          number: 12,
          title: "Bump dependency",
          url: "https://example.com/pr/12",
          author: "dependabot[bot]",
          updatedAt: "2026-03-19T00:15:00.000Z"
        }
      ],
      codeScanningAlerts: [
        {
          number: 7,
          title: "Command injection",
          url: "https://example.com/code-scanning/7",
          severity: "high",
          tool: "CodeQL"
        }
      ],
      dependabotAlerts: [
        {
          number: 4,
          url: "https://example.com/dependabot/4",
          severity: "medium",
          packageName: "dompurify",
          ecosystem: "npm"
        }
      ],
      fetchErrors: ["Dependabot alerts: forbidden"]
    });

    expect(body).toContain("# Daily GitHub Maintenance");
    expect(body).toContain("## Open Pull Requests (1)");
    expect(body).toContain("[#12](https://example.com/pr/12) Bump dependency");
    expect(body).toContain("## Open Code Scanning Alerts (1)");
    expect(body).toContain("Command injection — HIGH — CodeQL");
    expect(body).toContain("## Open Dependabot Alerts (1)");
    expect(body).toContain("dompurify — MEDIUM — npm");
    expect(body).toContain("## Fetch Errors (1)");
  });
});
