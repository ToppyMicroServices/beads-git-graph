import {
  buildDailyMaintenanceBody,
  hasActionableDailyMaintenance
} from "./daily-maintenance-report.mjs";

const ISSUE_TITLE = "Daily GitHub Maintenance";
const ISSUE_LABEL = "daily-update";
const API_VERSION = "2022-11-28";

function requireEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

const token = requireEnv("GITHUB_TOKEN");
const repository = requireEnv("GITHUB_REPOSITORY");
const [owner, repo] = repository.split("/");
const apiUrl = process.env.GITHUB_API_URL ?? "https://api.github.com";
const generatedAt = new Date().toISOString();

async function githubRequest(path, init = {}) {
  const response = await fetch(`${apiUrl}${path}`, {
    ...init,
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "X-GitHub-Api-Version": API_VERSION,
      ...init.headers
    }
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`${init.method ?? "GET"} ${path} failed (${response.status}): ${errorText}`);
  }

  if (response.status === 204) return null;
  return response.json();
}

async function paginate(path) {
  const results = [];
  let nextPath = path;

  while (nextPath !== null) {
    const response = await fetch(`${apiUrl}${nextPath}`, {
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${token}`,
        "X-GitHub-Api-Version": API_VERSION
      }
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`GET ${nextPath} failed (${response.status}): ${errorText}`);
    }

    const page = await response.json();
    results.push(...page);

    const linkHeader = response.headers.get("link") ?? "";
    const nextMatch = linkHeader.match(/<([^>]+)>; rel="next"/);
    if (nextMatch === null) {
      nextPath = null;
    } else if (nextMatch[1].startsWith(apiUrl)) {
      nextPath = nextMatch[1].substring(apiUrl.length);
    } else {
      nextPath = nextMatch[1];
    }
  }

  return results;
}

function compareByDateAsc(a, b, key) {
  return new Date(a[key]).getTime() - new Date(b[key]).getTime();
}

function severityRank(severity) {
  switch ((severity ?? "").toLowerCase()) {
    case "critical":
      return 0;
    case "high":
      return 1;
    case "medium":
      return 2;
    case "low":
      return 3;
    default:
      return 4;
  }
}

async function readOpenPullRequests() {
  const pullRequests = await paginate(`/repos/${owner}/${repo}/pulls?state=open&per_page=100`);
  return pullRequests
    .map((pullRequest) => ({
      number: pullRequest.number,
      title: pullRequest.title,
      url: pullRequest.html_url,
      author: pullRequest.user?.login ?? "unknown",
      updatedAt: pullRequest.updated_at
    }))
    .sort((a, b) => compareByDateAsc(a, b, "updatedAt"));
}

async function readCodeScanningAlerts() {
  const alerts = await paginate(
    `/repos/${owner}/${repo}/code-scanning/alerts?state=open&per_page=100`
  );
  return alerts
    .map((alert) => ({
      number: alert.number,
      title: alert.rule?.description ?? alert.rule?.id ?? "Code scanning alert",
      url: alert.html_url,
      severity: alert.rule?.severity ?? alert.most_recent_instance?.severity ?? "unknown",
      tool: alert.tool?.name ?? alert.most_recent_instance?.analysis_key ?? "unknown tool"
    }))
    .sort((a, b) => severityRank(a.severity) - severityRank(b.severity));
}

async function readDependabotAlerts() {
  const alerts = await paginate(
    `/repos/${owner}/${repo}/dependabot/alerts?state=open&per_page=100`
  );
  return alerts
    .map((alert) => ({
      number: alert.number,
      url: alert.html_url,
      severity:
        alert.security_advisory?.severity ?? alert.security_vulnerability?.severity ?? "unknown",
      packageName:
        alert.dependency?.package?.name ??
        alert.security_vulnerability?.package?.name ??
        "unknown package",
      ecosystem:
        alert.dependency?.package?.ecosystem ??
        alert.security_vulnerability?.package?.ecosystem ??
        "unknown ecosystem"
    }))
    .sort((a, b) => severityRank(a.severity) - severityRank(b.severity));
}

async function ensureLabelExists() {
  try {
    await githubRequest(`/repos/${owner}/${repo}/labels`, {
      method: "POST",
      body: JSON.stringify({
        name: ISSUE_LABEL,
        color: "1D76DB",
        description: "Daily GitHub PR and security maintenance summary"
      })
    });
  } catch (error) {
    if (!String(error.message).includes("(422)")) {
      throw error;
    }
  }
}

async function findDailyMaintenanceIssue() {
  const issues = await paginate(
    `/repos/${owner}/${repo}/issues?state=all&labels=${ISSUE_LABEL}&per_page=100`
  );
  return issues.find((issue) => !issue.pull_request && issue.title === ISSUE_TITLE) ?? null;
}

async function upsertDailyIssue(body, existingIssue) {
  if (existingIssue === null) {
    return githubRequest(`/repos/${owner}/${repo}/issues`, {
      method: "POST",
      body: JSON.stringify({
        title: ISSUE_TITLE,
        body: body,
        labels: [ISSUE_LABEL]
      })
    });
  }

  return githubRequest(`/repos/${owner}/${repo}/issues/${existingIssue.number}`, {
    method: "PATCH",
    body: JSON.stringify({
      title: ISSUE_TITLE,
      body: body,
      state: "open",
      labels: [ISSUE_LABEL]
    })
  });
}

async function closeDailyIssue(existingIssue, body) {
  if (existingIssue === null || existingIssue.state === "closed") {
    return;
  }

  await githubRequest(`/repos/${owner}/${repo}/issues/${existingIssue.number}/comments`, {
    method: "POST",
    body: JSON.stringify({
      body: `No open PR or security backlog detected on ${generatedAt}. Closing this issue.`
    })
  });
  await githubRequest(`/repos/${owner}/${repo}/issues/${existingIssue.number}`, {
    method: "PATCH",
    body: JSON.stringify({
      state: "closed",
      body: body
    })
  });
}

async function main() {
  const fetchErrors = [];
  const [pullRequests, codeScanningAlerts, dependabotAlerts] = await Promise.all([
    readOpenPullRequests().catch((error) => {
      fetchErrors.push(`Pull requests: ${error.message}`);
      return [];
    }),
    readCodeScanningAlerts().catch((error) => {
      fetchErrors.push(`Code scanning alerts: ${error.message}`);
      return [];
    }),
    readDependabotAlerts().catch((error) => {
      fetchErrors.push(`Dependabot alerts: ${error.message}`);
      return [];
    })
  ]);

  await ensureLabelExists();

  const report = {
    repository: repository,
    generatedAt: generatedAt,
    pullRequests: pullRequests,
    codeScanningAlerts: codeScanningAlerts,
    dependabotAlerts: dependabotAlerts,
    fetchErrors: fetchErrors
  };
  const body = buildDailyMaintenanceBody(report);
  const existingIssue = await findDailyMaintenanceIssue();

  if (hasActionableDailyMaintenance(report)) {
    await upsertDailyIssue(body, existingIssue);
  } else {
    await closeDailyIssue(existingIssue, body);
  }
}

await main();
