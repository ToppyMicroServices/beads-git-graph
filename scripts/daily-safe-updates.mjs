import { pathToFileURL } from "node:url";

import { buildGitHubApiUrl, resolveGitHubNextPath } from "./github-api-utils.mjs";

const API_VERSION = "2022-11-28";
const DEPENDABOT_LOGIN = "dependabot[bot]";
const LABELS = {
  automerge: {
    name: "automerge",
    color: "0E8A16",
    description: "Dependabot patch and minor updates eligible for auto-merge"
  },
  manualReview: {
    name: "manual-review",
    color: "D93F0B",
    description: "Dependency update requires manual review before merging"
  },
  needsRebase: {
    name: "needs-rebase",
    color: "FBCA04",
    description: "Dependabot was asked to rebase this pull request"
  },
  superseded: {
    name: "superseded",
    color: "6E7781",
    description: "Older dependency update replaced by a newer open pull request"
  }
};

function requireEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function parseSemver(version) {
  const match = /^v?(\d+)\.(\d+)\.(\d+)(?:[-+][0-9A-Za-z.-]+)?$/.exec(version.trim());
  if (match === null) return null;
  return {
    major: Number.parseInt(match[1], 10),
    minor: Number.parseInt(match[2], 10),
    patch: Number.parseInt(match[3], 10)
  };
}

function compareSemverDesc(left, right) {
  if (left.major !== right.major) return right.major - left.major;
  if (left.minor !== right.minor) return right.minor - left.minor;
  return right.patch - left.patch;
}

export function parseDependabotTitle(title) {
  const match = /^build\(deps(?:-dev)?\): bump (.+?) from (\S+) to (\S+)$/.exec(title.trim());
  if (match === null) return null;
  return {
    dependencyName: match[1],
    fromVersion: match[2],
    toVersion: match[3]
  };
}

export function classifyDependabotUpdate(title) {
  const parsedTitle = parseDependabotTitle(title);
  if (parsedTitle === null) {
    return {
      dependencyName: null,
      fromVersion: null,
      toVersion: null,
      updateType: "unknown"
    };
  }

  const fromVersion = parseSemver(parsedTitle.fromVersion);
  const toVersion = parseSemver(parsedTitle.toVersion);
  if (fromVersion === null || toVersion === null) {
    return {
      ...parsedTitle,
      updateType: "unknown"
    };
  }

  let updateType = "patch";
  if (fromVersion.major !== toVersion.major) {
    updateType = "major";
  } else if (fromVersion.minor !== toVersion.minor) {
    updateType = "minor";
  }

  return {
    ...parsedTitle,
    updateType: updateType
  };
}

export function planDependabotTriage(pullRequests) {
  const dependabotPullRequests = pullRequests
    .filter((pullRequest) => pullRequest.author === DEPENDABOT_LOGIN)
    .map((pullRequest) => ({
      ...pullRequest,
      dependency: classifyDependabotUpdate(pullRequest.title)
    }));

  const supersededPullRequestNumbers = new Set();
  const pullRequestsByDependency = new Map();

  for (const pullRequest of dependabotPullRequests) {
    if (pullRequest.dependency.dependencyName === null) continue;
    const list = pullRequestsByDependency.get(pullRequest.dependency.dependencyName) ?? [];
    list.push(pullRequest);
    pullRequestsByDependency.set(pullRequest.dependency.dependencyName, list);
  }

  for (const dependencyPullRequests of pullRequestsByDependency.values()) {
    if (dependencyPullRequests.length < 2) continue;

    const rankedPullRequests = [...dependencyPullRequests].sort((left, right) => {
      const leftVersion = parseSemver(left.dependency.toVersion ?? "");
      const rightVersion = parseSemver(right.dependency.toVersion ?? "");
      if (leftVersion !== null && rightVersion !== null) {
        const versionComparison = compareSemverDesc(leftVersion, rightVersion);
        if (versionComparison !== 0) return versionComparison;
      }
      return new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime();
    });

    for (const pullRequest of rankedPullRequests.slice(1)) {
      supersededPullRequestNumbers.add(pullRequest.number);
    }
  }

  return pullRequests.map((pullRequest) => {
    if (pullRequest.author !== DEPENDABOT_LOGIN) {
      return {
        ...pullRequest,
        dependency: null,
        action: "ignore"
      };
    }

    const dependency = classifyDependabotUpdate(pullRequest.title);
    if (supersededPullRequestNumbers.has(pullRequest.number)) {
      return {
        ...pullRequest,
        dependency: dependency,
        action: "close-superseded"
      };
    }

    if (dependency.updateType === "patch" || dependency.updateType === "minor") {
      return {
        ...pullRequest,
        dependency: dependency,
        action: "automerge"
      };
    }

    return {
      ...pullRequest,
      dependency: dependency,
      action: "manual-review"
    };
  });
}

function createGithubClient() {
  const token = requireEnv("GITHUB_TOKEN");
  const repository = requireEnv("GITHUB_REPOSITORY");
  const [owner, repo] = repository.split("/");
  const apiUrl = process.env.GITHUB_API_URL ?? "https://api.github.com";

  async function githubRequest(path, init = {}) {
    const response = await fetch(buildGitHubApiUrl(apiUrl, path), {
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
      const response = await fetch(buildGitHubApiUrl(apiUrl, nextPath), {
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
      nextPath = nextMatch === null ? null : resolveGitHubNextPath(apiUrl, nextMatch[1]);
    }

    return results;
  }

  return {
    owner,
    repo,
    githubRequest,
    paginate
  };
}

async function ensureLabelExists(githubClient, label) {
  try {
    await githubClient.githubRequest(`/repos/${githubClient.owner}/${githubClient.repo}/labels`, {
      method: "POST",
      body: JSON.stringify(label)
    });
  } catch (error) {
    if (!String(error.message).includes("(422)")) {
      throw error;
    }
  }
}

async function readOpenPullRequests(githubClient) {
  const issues = await githubClient.paginate(
    `/repos/${githubClient.owner}/${githubClient.repo}/issues?state=open&per_page=100`
  );
  const openPullRequestIssues = issues.filter((issue) => issue.pull_request !== undefined);

  return Promise.all(
    openPullRequestIssues.map(async (issue) => {
      const pullRequest = await githubClient.githubRequest(
        `/repos/${githubClient.owner}/${githubClient.repo}/pulls/${issue.number}`
      );
      return {
        number: issue.number,
        title: issue.title,
        url: issue.html_url,
        author: issue.user?.login ?? "unknown",
        updatedAt: issue.updated_at,
        labels: (issue.labels ?? []).map((label) =>
          typeof label === "string" ? label : (label.name ?? "")
        ),
        draft: pullRequest.draft,
        mergeableState: pullRequest.mergeable_state ?? "unknown"
      };
    })
  );
}

async function replaceLabels(githubClient, pullRequestNumber, labels) {
  await githubClient.githubRequest(
    `/repos/${githubClient.owner}/${githubClient.repo}/issues/${pullRequestNumber}`,
    {
      method: "PATCH",
      body: JSON.stringify({
        labels: [...new Set(labels)].sort()
      })
    }
  );
}

async function addComment(githubClient, pullRequestNumber, body) {
  await githubClient.githubRequest(
    `/repos/${githubClient.owner}/${githubClient.repo}/issues/${pullRequestNumber}/comments`,
    {
      method: "POST",
      body: JSON.stringify({ body })
    }
  );
}

async function closePullRequest(githubClient, pullRequestNumber) {
  await githubClient.githubRequest(
    `/repos/${githubClient.owner}/${githubClient.repo}/issues/${pullRequestNumber}`,
    {
      method: "PATCH",
      body: JSON.stringify({ state: "closed" })
    }
  );
}

async function triagePullRequest(githubClient, pullRequest) {
  const labelSet = new Set(pullRequest.labels);

  if (pullRequest.action === "close-superseded") {
    labelSet.delete(LABELS.automerge.name);
    labelSet.delete(LABELS.manualReview.name);
    labelSet.delete(LABELS.needsRebase.name);
    labelSet.add(LABELS.superseded.name);
    await replaceLabels(githubClient, pullRequest.number, [...labelSet]);
    await addComment(
      githubClient,
      pullRequest.number,
      "Closing this Dependabot pull request because a newer update for the same dependency is already open."
    );
    await closePullRequest(githubClient, pullRequest.number);
    return;
  }

  if (pullRequest.action === "automerge") {
    labelSet.add(LABELS.automerge.name);
    labelSet.delete(LABELS.manualReview.name);
    labelSet.delete(LABELS.superseded.name);

    if (pullRequest.mergeableState === "behind") {
      if (!labelSet.has(LABELS.needsRebase.name)) {
        await addComment(githubClient, pullRequest.number, "@dependabot rebase");
      }
      labelSet.add(LABELS.needsRebase.name);
    } else {
      labelSet.delete(LABELS.needsRebase.name);
    }

    await replaceLabels(githubClient, pullRequest.number, [...labelSet]);
    return;
  }

  labelSet.add(LABELS.manualReview.name);
  labelSet.delete(LABELS.automerge.name);
  labelSet.delete(LABELS.needsRebase.name);
  labelSet.delete(LABELS.superseded.name);
  await replaceLabels(githubClient, pullRequest.number, [...labelSet]);
}

export async function main() {
  const githubClient = createGithubClient();
  await Promise.all(Object.values(LABELS).map((label) => ensureLabelExists(githubClient, label)));

  const openPullRequests = await readOpenPullRequests(githubClient);
  const triagedPullRequests = planDependabotTriage(openPullRequests);

  for (const pullRequest of triagedPullRequests) {
    if (pullRequest.action === "ignore") continue;
    await triagePullRequest(githubClient, pullRequest);
  }
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
