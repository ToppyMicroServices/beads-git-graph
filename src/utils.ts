import * as path from "node:path";

import * as vscode from "vscode";

const FS_REGEX = /\\/g;

export function abbrevCommit(commitHash: string) {
  return commitHash.substring(0, 8);
}

export async function copyToClipboard(text: string): Promise<boolean> {
  try {
    await vscode.env.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

export function getPathFromUri(uri: vscode.Uri) {
  return uri.fsPath.replace(FS_REGEX, "/");
}

export function getPathFromStr(str: string) {
  return str.replace(FS_REGEX, "/");
}

export function isPathWithinRoot(root: string, target: string) {
  const resolvedRoot = path.resolve(root);
  const resolvedTarget = path.resolve(target);
  if (resolvedTarget === resolvedRoot) {
    return true;
  }

  const rootPrefix = resolvedRoot.endsWith(path.sep) ? resolvedRoot : `${resolvedRoot}${path.sep}`;
  return resolvedTarget.startsWith(rootPrefix);
}

export function resolvePathWithinRoot(root: string, targetPath: string) {
  const relativePath = getPathFromStr(targetPath).replace(/^\/+/, "");
  const resolvedTarget = path.resolve(root, relativePath);
  return isPathWithinRoot(root, resolvedTarget) ? resolvedTarget : null;
}

export function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function getNonce() {
  const possible = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let text = "";
  for (let i = 0; i < 32; i++) {
    text += possible.charAt(Math.floor(Math.random() * possible.length));
  }
  return text;
}

// Evaluate promises in parallel, with at most maxParallel running at any time
export function evalPromises<X, Y>(
  data: X[],
  maxParallel: number,
  createPromise: (val: X) => Promise<Y>
) {
  return new Promise<Y[]>((resolve, reject) => {
    if (data.length === 1) {
      createPromise(data[0])
        .then((v) => resolve([v]))
        .catch(() => reject());
    } else if (data.length === 0) {
      resolve([]);
    } else {
      const results: Y[] = Array.from({ length: data.length });
      let nextPromise = 0,
        rejected = false,
        completed = 0;
      const startNext = () => {
        const cur = nextPromise;
        nextPromise++;
        createPromise(data[cur])
          .then((result) => {
            if (!rejected) {
              results[cur] = result;
              completed++;
              if (nextPromise < data.length) startNext();
              else if (completed === data.length) resolve(results);
            }
          })
          .catch(() => {
            reject();
            rejected = true;
          });
      };
      for (let i = 0; i < maxParallel && i < data.length; i++) startNext();
    }
  });
}
