import { ExtensionContext, Memento } from "vscode";

import { GitRepoSet } from "./types";
const LAST_ACTIVE_REPO = "lastActiveRepo";
const REPO_STATES = "repoStates";

export class ExtensionState {
  private workspaceState: Memento;

  constructor(context: ExtensionContext) {
    this.workspaceState = context.workspaceState;
  }

  /* Discovered Repos */
  public getRepos() {
    return this.workspaceState.get<GitRepoSet>(REPO_STATES, {});
  }
  public saveRepos(gitRepoSet: GitRepoSet) {
    this.workspaceState.update(REPO_STATES, gitRepoSet);
  }

  /* Last Active Repo */
  public getLastActiveRepo() {
    return this.workspaceState.get<string | null>(LAST_ACTIVE_REPO, null);
  }
  public setLastActiveRepo(repo: string | null) {
    this.workspaceState.update(LAST_ACTIVE_REPO, repo);
  }
}
