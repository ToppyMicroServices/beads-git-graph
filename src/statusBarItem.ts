import * as vscode from "vscode";

import { getConfig } from "./config";

export class StatusBarItem {
  private statusBarItem: vscode.StatusBarItem;
  private beadsStatusBarItem: vscode.StatusBarItem;
  private numRepos: number = 0;

  constructor(context: vscode.ExtensionContext) {
    this.statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 1);
    this.statusBarItem.text = "$(git-merge) Git Graph";
    this.statusBarItem.tooltip = "View Git Graph";
    this.statusBarItem.command = "beads-git-graph.view";

    this.beadsStatusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 0);
    this.beadsStatusBarItem.text = "$(list-tree) Beads";
    this.beadsStatusBarItem.tooltip = "Focus Beads Graph view";
    this.beadsStatusBarItem.command = "beads-git-graph.focusBeadsView";

    context.subscriptions.push(this.statusBarItem, this.beadsStatusBarItem);
  }

  public setNumRepos(numRepos: number) {
    this.numRepos = numRepos;
    this.refresh();
  }

  public refresh() {
    if (getConfig().showStatusBarItem()) {
      this.beadsStatusBarItem.show();
      if (this.numRepos > 0) {
        this.statusBarItem.show();
      } else {
        this.statusBarItem.hide();
      }
    } else {
      this.statusBarItem.hide();
      this.beadsStatusBarItem.hide();
    }
  }
}
