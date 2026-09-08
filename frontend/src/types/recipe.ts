import type { Edge, Node } from 'reactflow';

export const PROTOCOL_VERSION = 1 as const;

export type StepKind = 'spin_coat' | 'bake' | 'expose';
export type StepRunStatus =
  | 'pending'
  | 'active'
  | 'completed'
  | 'cancelled'
  | 'failed';

export type SpinCoatStep = {
  kind: 'spin_coat';
  rpm: number;
  duration_sec: number;
};

export type BakeStep = {
  kind: 'bake';
  temperature_c: number;
  duration_sec: number;
};

export type ExposeStep = {
  kind: 'expose';
  intensity_mw_cm2: number;
  duration_sec: number;
};

export type StepConfig = SpinCoatStep | BakeStep | ExposeStep;

export type EditableStepField =
  | 'duration_sec'
  | 'rpm'
  | 'temperature_c'
  | 'intensity_mw_cm2';

export type UpdateNodeData = (
  nodeId: string,
  field: EditableStepField,
  value: number,
) => void;

export type DeleteNode = (nodeId: string) => void;

export type ProcessNodeData = {
  label: string;
  toolId: string;
  step: StepConfig;
  isActive?: boolean;
  runStatus?: StepRunStatus;
  isLocked?: boolean;
  updateNodeData?: UpdateNodeData;
  deleteNode?: DeleteNode;
};

export type ProcessFlowNode = Node<ProcessNodeData, 'processNode'>;
export type ProcessFlowEdge = Edge;

export type RecipeNode = {
  id: string;
  label: string;
  tool_id: string;
  step: StepConfig;
};

export type RecipeEdge = {
  id: string;
  source: string;
  target: string;
};

export type Recipe = {
  schema_version: typeof PROTOCOL_VERSION;
  recipe_id: string;
  name: string;
  nodes: RecipeNode[];
  edges: RecipeEdge[];
};

export type ValidationIssue = {
  field: EditableStepField | 'step';
  message: string;
};
