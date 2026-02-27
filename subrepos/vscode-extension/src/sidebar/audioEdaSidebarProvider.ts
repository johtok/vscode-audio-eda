import * as vscode from "vscode";

export type WorkspacePresetId = "default" | "transforms" | "metrics" | "pca";

class WorkspacePresetItem extends vscode.TreeItem {
  public constructor(
    label: string,
    presetId: WorkspacePresetId,
    description: string,
    iconPath: vscode.ThemeIcon
  ) {
    super(label, vscode.TreeItemCollapsibleState.None);
    this.description = description;
    this.iconPath = iconPath;
    this.contextValue = "workspacePreset";
    this.command = {
      command: "audioEda.openPresetWorkspace",
      title: "Open Audio EDA Preset Workspace",
      arguments: [presetId]
    };
  }
}

export class AudioEdaSidebarProvider
  implements vscode.TreeDataProvider<WorkspacePresetItem>
{
  private readonly onDidChangeTreeDataEmitter = new vscode.EventEmitter<
    WorkspacePresetItem | undefined
  >();

  public readonly onDidChangeTreeData = this.onDidChangeTreeDataEmitter.event;

  public refresh(): void {
    this.onDidChangeTreeDataEmitter.fire(undefined);
  }

  public getTreeItem(element: WorkspacePresetItem): vscode.TreeItem {
    return element;
  }

  public getChildren(element?: WorkspacePresetItem): Thenable<WorkspacePresetItem[]> {
    if (element) {
      return Promise.resolve([]);
    }

    return Promise.resolve([
      new WorkspacePresetItem(
        "General Audio Workspace",
        "default",
        "Start with core stack and load audio manually",
        new vscode.ThemeIcon("home")
      ),
      new WorkspacePresetItem(
        "Transform Lab Workspace",
        "transforms",
        "Timeseries + STFT + mel + MFCC + DCT + custom filterbank",
        new vscode.ThemeIcon("graph")
      ),
      new WorkspacePresetItem(
        "Metrics Workspace",
        "metrics",
        "Preset layout for metric-first inspection",
        new vscode.ThemeIcon("pulse")
      ),
      new WorkspacePresetItem(
        "PCA Workspace",
        "pca",
        "Preset layout for PCA-oriented analysis",
        new vscode.ThemeIcon("symbol-array")
      )
    ]);
  }
}
