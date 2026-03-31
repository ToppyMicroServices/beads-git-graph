function normalizeApiPrefix(apiUrl) {
  const baseUrl = new URL(apiUrl);
  const prefix = baseUrl.pathname.replace(/\/$/, "");
  return { baseUrl, prefix };
}

export function buildGitHubApiUrl(apiUrl, path) {
  if (/^https?:\/\//.test(path)) {
    const { baseUrl, prefix } = normalizeApiPrefix(apiUrl);
    const resolvedUrl = new URL(path);
    if (resolvedUrl.origin !== baseUrl.origin || !resolvedUrl.pathname.startsWith(prefix)) {
      throw new Error(`Refusing to access non-GitHub API URL: ${path}`);
    }
    return resolvedUrl.toString();
  }

  const { baseUrl, prefix } = normalizeApiPrefix(apiUrl);
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  return `${baseUrl.origin}${prefix}${normalizedPath}`;
}

export function resolveGitHubNextPath(apiUrl, nextUrl) {
  const { baseUrl, prefix } = normalizeApiPrefix(apiUrl);
  const resolvedUrl = new URL(nextUrl, baseUrl);

  if (resolvedUrl.origin !== baseUrl.origin || !resolvedUrl.pathname.startsWith(prefix)) {
    throw new Error(`Refusing to follow non-GitHub API pagination URL: ${nextUrl}`);
  }

  const nextPath = resolvedUrl.pathname.slice(prefix.length) || "/";
  return `${nextPath}${resolvedUrl.search}`;
}
