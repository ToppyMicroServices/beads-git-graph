import { type AgentProviderId } from "./agentProvider";

export interface AgentLiveExecution {
  runId: string;
  provider: AgentProviderId;
  model: string;
  startedAt: string;
  heartbeatAt: string;
}
