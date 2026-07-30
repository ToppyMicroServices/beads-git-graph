import { parsePlanDraft, type PlanDraft, type PlanDraftValidationError } from "../src/planDraft";

export interface PlanDraftPreviewState {
  draft: PlanDraft | null;
  errors: PlanDraftValidationError[];
}

export interface PlanDraftImportMessage {
  command: "importPlanDraft";
  workspacePath: string;
  draftText: string;
}

export interface PlanDraftController {
  setText(text: string): void;
  preview(): PlanDraftPreviewState;
  cancel(): void;
  importPlan(workspacePath: string, capabilitySupported: boolean): boolean;
  getText(): string;
}

export function createPlanDraftController(
  postMessage: (message: PlanDraftImportMessage) => void
): PlanDraftController {
  let draftText = "";
  let previewedText: string | null = null;
  let previewState: PlanDraftPreviewState = { draft: null, errors: [] };

  return {
    setText(text) {
      draftText = text;
      previewedText = null;
      previewState = { draft: null, errors: [] };
    },
    preview() {
      previewedText = draftText;
      let value: unknown;
      try {
        value = JSON.parse(draftText);
      } catch (error) {
        previewState = {
          draft: null,
          errors: [
            {
              code: "invalid-field",
              path: "",
              message: error instanceof Error ? error.message : "Plan Draft must be valid JSON."
            }
          ]
        };
        return previewState;
      }
      previewState = parsePlanDraft(value);
      return previewState;
    },
    cancel() {
      draftText = "";
      previewedText = null;
      previewState = { draft: null, errors: [] };
    },
    importPlan(workspacePath, capabilitySupported) {
      if (
        !capabilitySupported ||
        workspacePath.trim() === "" ||
        previewedText !== draftText ||
        previewState.draft === null ||
        previewState.errors.length > 0
      ) {
        return false;
      }
      postMessage({ command: "importPlanDraft", workspacePath, draftText });
      return true;
    },
    getText() {
      return draftText;
    }
  };
}
