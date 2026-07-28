import { type BeadItem } from "./beadsData";
import { type BeadsSyncCapability } from "./beadsSync";
import { type BeadsWriteCapability } from "./beadsWriteCapability";
import { type CommandAvailability } from "./commandAvailability";

export interface BeadGroup {
  workspace: string;
  workspacePath: string;
  items: BeadItem[];
}

export interface EmptyBeadWorkspace {
  workspace: string;
  workspacePath: string;
}

export interface BeadWarning {
  source: string;
  message: string;
  workspacePath?: string;
}

export interface BeadLoadResult {
  groups: BeadGroup[];
  emptyWorkspaces: EmptyBeadWorkspace[];
  unavailableWorkspaces: EmptyBeadWorkspace[];
  bdExecutableStatus: CommandAvailability;
  errors: { source: string; message: string }[];
  warnings: BeadWarning[];
  planImportCapabilities?: Array<{
    workspace: string;
    workspacePath: string;
    capability: BeadsWriteCapability;
  }>;
  agentWriteCapabilities?: Array<{
    workspace: string;
    workspacePath: string;
    capability: BeadsWriteCapability;
  }>;
  syncCapabilities?: Array<{
    workspace: string;
    workspacePath: string;
    capability: BeadsSyncCapability;
  }>;
}

export interface CliLoadResult {
  items: BeadItem[];
  warnings: BeadWarning[];
}
