import * as vscode from "vscode";

export type WorkspacePresetId = "default" | "transforms" | "metrics" | "pca";
export interface RecentWorkspaceEntry {
  readonly uri: string;
  readonly label: string;
  readonly description?: string;
}

class SidebarSectionItem extends vscode.TreeItem {
  public readonly sectionId: "presets" | "recent";

  public constructor(
    label: string,
    sectionId: "presets" | "recent",
    iconPath: vscode.ThemeIcon
  ) {
    super(label, vscode.TreeItemCollapsibleState.Expanded);
    this.sectionId = sectionId;
    this.iconPath = iconPath;
    this.contextValue = "workspaceSection";
  }
}

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

class RecentWorkspaceItem extends vscode.TreeItem {
  public constructor(entry: RecentWorkspaceEntry) {
    super(entry.label, vscode.TreeItemCollapsibleState.None);
    this.description = entry.description;
    this.tooltip = entry.description ? `${entry.label}\n${entry.description}` : entry.label;
    this.iconPath = new vscode.ThemeIcon("history");
    this.contextValue = "recentWorkspace";
    this.command = {
      command: "audioEda.openWorkbenchForFile",
      title: "Open Recent Audio EDA Workspace",
      arguments: [vscode.Uri.parse(entry.uri)]
    };
  }
}

class SidebarInfoItem extends vscode.TreeItem {
  public constructor(label: string) {
    super(label, vscode.TreeItemCollapsibleState.None);
    this.contextValue = "sidebarInfo";
    this.iconPath = new vscode.ThemeIcon("info");
  }
}

type SidebarItem = SidebarSectionItem | WorkspacePresetItem | RecentWorkspaceItem | SidebarInfoItem;

export class AudioEdaSidebarProvider
  implements vscode.TreeDataProvider<SidebarItem>
{
  private readonly onDidChangeTreeDataEmitter = new vscode.EventEmitter<SidebarItem | undefined>();
  private recentWorkspaces: RecentWorkspaceEntry[] = [];

  public readonly onDidChangeTreeData = this.onDidChangeTreeDataEmitter.event;

  public setRecentWorkspaces(entries: readonly RecentWorkspaceEntry[]): void {
    this.recentWorkspaces = entries.slice(0, 5).map((entry) => ({
      uri: entry.uri,
      label: entry.label,
      description: entry.description
    }));
    this.refresh();
  }

  public refresh(): void {
    this.onDidChangeTreeDataEmitter.fire(undefined);
  }

  public getTreeItem(element: SidebarItem): vscode.TreeItem {
    return element;
  }

  private buildPresetItems(): WorkspacePresetItem[] {
    return [
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
    ];
  }

  private buildRecentItems(): SidebarItem[] {
    if (this.recentWorkspaces.length === 0) {
      return [new SidebarInfoItem("No recent workspaces yet.")];
    }

    return this.recentWorkspaces.map((entry) => new RecentWorkspaceItem(entry));
  }

  public getChildren(element?: SidebarItem): Thenable<SidebarItem[]> {
    if (!element) {
      return Promise.resolve([
        new SidebarSectionItem("Workspace Presets", "presets", new vscode.ThemeIcon("list-flat")),
        new SidebarSectionItem("Recent Workspaces", "recent", new vscode.ThemeIcon("history"))
      ]);
    }

    if (element instanceof SidebarSectionItem) {
      if (element.sectionId === "presets") {
        return Promise.resolve(this.buildPresetItems());
      }

      return Promise.resolve(this.buildRecentItems());
    }

    return Promise.resolve([]);
  }
}
