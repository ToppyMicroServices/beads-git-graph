import * as vscode from "vscode";

import {
  CommitDetailsFileActionVisibility,
  DateFormat,
  DateType,
  GraphStyle,
  ReferenceInputSpaceSubstitution,
  RepoDropdownOrder,
  TabIconColourTheme
} from "./types";

class Config {
  private workspaceConfiguration: vscode.WorkspaceConfiguration;

  constructor() {
    this.workspaceConfiguration = vscode.workspace.getConfiguration("beads-git-graph");
  }

  public autoCenterCommitDetailsView() {
    return this.workspaceConfiguration.get("autoCenterCommitDetailsView", true);
  }

  public commitDetailsFileActionVisibility(): CommitDetailsFileActionVisibility {
    const defaults: CommitDetailsFileActionVisibility = {
      viewDiff: true,
      viewDiffWithWorkingFile: true,
      viewFileAtRevision: true,
      openFile: true,
      resetFileToRevision: true,
      copyRelativeFilePath: true,
      copyAbsoluteFilePath: true
    };
    const configured = this.workspaceConfiguration.get<Partial<CommitDetailsFileActionVisibility>>(
      "commitDetailsFileActionVisibility",
      {}
    );
    return { ...defaults, ...configured };
  }

  public enhancedAccessibility() {
    return this.workspaceConfiguration.get("enhancedAccessibility", false);
  }

  public dateFormat(): DateFormat {
    return this.workspaceConfiguration.get("dateFormat", "Date & Time");
  }

  public dateType(): DateType {
    return this.workspaceConfiguration.get("dateType", "Author Date");
  }

  public graphColours() {
    return this.workspaceConfiguration
      .get("graphColours", ["#4C9AFF", "#2EC4B6", "#FFB703", "#A78BFA", "#FF5DA2"])
      .filter(
        (v) =>
          v.match(
            /^\s*(#[0-9a-fA-F]{6}|#[0-9a-fA-F]{8}|rgb[a]?\s*\(\d{1,3},\s*\d{1,3},\s*\d{1,3}\))\s*$/
          ) !== null
      );
  }

  public graphStyle(): GraphStyle {
    return this.workspaceConfiguration.get("graphStyle", "rounded");
  }

  public initialLoadCommits() {
    return this.workspaceConfiguration.get("initialLoadCommits", 300);
  }

  public loadMoreCommits() {
    return this.workspaceConfiguration.get("loadMoreCommits", 75);
  }

  public referenceInputSpaceSubstitution(): ReferenceInputSpaceSubstitution {
    return this.workspaceConfiguration.get("referenceInputSpaceSubstitution", "None");
  }

  public repoDropdownOrder(): RepoDropdownOrder {
    return this.workspaceConfiguration.get("repoDropdownOrder", "Workspace Full Path");
  }

  public maxDepthOfRepoSearch() {
    return this.workspaceConfiguration.get("maxDepthOfRepoSearch", 0);
  }

  public showCurrentBranchByDefault() {
    return this.workspaceConfiguration.get("showCurrentBranchByDefault", false);
  }

  public preferMainBranchByDefault() {
    return this.workspaceConfiguration.get("preferMainBranchByDefault", true);
  }

  public hiddenBranchPatterns() {
    return this.workspaceConfiguration.get("hiddenBranchPatterns", [
      "^beads",
      "^beads-sync$",
      "^db/",
      "^beads-sync/"
    ]);
  }

  public mutedGraphOpacity() {
    return this.workspaceConfiguration.get("mutedGraphOpacity", 0.45);
  }

  public mutedGraphLineWidth() {
    return this.workspaceConfiguration.get("mutedGraphLineWidth", 1.2);
  }

  public mutedGraphNodeRadius() {
    return this.workspaceConfiguration.get("mutedGraphNodeRadius", 2.8);
  }

  public showStatusBarItem() {
    return this.workspaceConfiguration.get("showStatusBarItem", true);
  }

  public showUncommittedChanges() {
    return this.workspaceConfiguration.get("showUncommittedChanges", true);
  }

  public tabIconColourTheme(): TabIconColourTheme {
    return this.workspaceConfiguration.get("tabIconColourTheme", "colour");
  }

  public gitPath(): string {
    const path = vscode.workspace.getConfiguration("git").get("path", null);
    return path !== null ? path : "git";
  }
}

export function getConfig() {
  return new Config();
}
