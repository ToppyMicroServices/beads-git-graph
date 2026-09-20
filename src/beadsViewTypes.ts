import { type AgentExecutionSnapshot } from "./agentExecutionTrace";
import { type BeadItem } from "./beadsData";
import { type BeadsSyncCapability } from "./beadsSync";
import { type BeadsWriteCapability } from "./beadsWriteCapability";
import { type CommandAvailability } from "./commandAvailability";

export interface BeadGroup {
  workspace: string;
  workspacePath: string;
  storageKind?: "local" | "beads";
  items: BeadItem[];
  /** Whether readiness was computed successfully for this snapshot. */
  readinessKnown: boolean;
}

export interface EmptyBeadWorkspace {
  workspace: string;
  workspacePath: string;
  storageKind?: "local" | "beads";
}

export interface BeadWarning {
  source: string;
  message: string;
  workspacePath?: string;
}

export interface BeadLoadResult {
  executionSnapshot?: AgentExecutionSnapshot;
  localWorkspaces?: EmptyBeadWorkspace[];
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
  readinessKnown: boolean;
}
