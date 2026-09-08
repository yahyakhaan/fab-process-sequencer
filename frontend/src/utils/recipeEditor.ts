import type { Connection, XYPosition } from 'reactflow';

import type {
  ProcessFlowEdge,
  ProcessFlowNode,
  StepConfig,
  StepKind,
} from '../types/recipe';
import { validateStep } from './stepConfig.ts';

export const STEP_KIND_DRAG_TYPE = 'application/x-fab-step-kind';
export const MAX_RECIPE_NODES = 64;
export const MAX_RECIPE_EDGES = 256;

export type StepTemplate = {
  kind: StepKind;
  label: string;
  description: string;
  toolId: string;
  accent: string;
};

export type EditorIssue = {
  id: string;
  message: string;
  nodeId?: string;
};

export const STEP_TEMPLATES = [
  {
    kind: 'spin_coat',
    label: 'Spin Coat',
    description: 'Ramp a wafer to a target speed',
    toolId: 'spinner-1',
    accent: '#4cc9f0',
  },
  {
    kind: 'bake',
    label: 'Bake',
    description: 'Heat and cool on a hotplate',
    toolId: 'hotplate-1',
    accent: '#ff9f43',
  },
  {
    kind: 'expose',
    label: 'UV Exposure',
    description: 'Expose resist at a set intensity',
    toolId: 'aligner-1',
    accent: '#b388ff',
  },
] as const satisfies readonly StepTemplate[];

function createStep(kind: StepKind): StepConfig {
  switch (kind) {
    case 'spin_coat':
      return { kind, duration_sec: 45, rpm: 3_000 };
    case 'bake':
      return { kind, duration_sec: 60, temperature_c: 120 };
    case 'expose':
      return { kind, duration_sec: 15, intensity_mw_cm2: 15 };
  }
}

export function isStepKind(value: string): value is StepKind {
  return STEP_TEMPLATES.some((template) => template.kind === value);
}

export function createProcessNode(
  kind: StepKind,
  position: XYPosition,
  id = `node-${crypto.randomUUID()}`,
): ProcessFlowNode {
  const template = STEP_TEMPLATES.find((candidate) => candidate.kind === kind);
  if (!template) throw new Error(`Unknown step kind: ${kind}`);

  return {
    id,
    position,
    type: 'processNode',
    data: {
      label: template.label,
      toolId: template.toolId,
      step: createStep(kind),
    },
  };
}

export function createSampleGraph(): {
  nodes: ProcessFlowNode[];
  edges: ProcessFlowEdge[];
} {
  const softBake = createProcessNode(
    'bake',
    { x: 360, y: 290 },
    'step-2',
  );
  softBake.data.label = 'Soft Bake';

  return {
    nodes: [
      createProcessNode('spin_coat', { x: 360, y: 110 }, 'step-1'),
      softBake,
      createProcessNode('expose', { x: 360, y: 470 }, 'step-3'),
    ],
    edges: [
      { id: 'e1-2', source: 'step-1', target: 'step-2' },
      { id: 'e2-3', source: 'step-2', target: 'step-3' },
    ],
  };
}

export function getConnectionIssue(
  connection: Connection,
  edges: ProcessFlowEdge[],
): string | null {
  if (!connection.source || !connection.target) {
    return 'Choose both a source and target step.';
  }
  if (connection.source === connection.target) {
    return 'A process step cannot connect to itself.';
  }
  if (
    edges.some(
      (edge) =>
        edge.source === connection.source && edge.target === connection.target,
    )
  ) {
    return 'Those process steps are already connected.';
  }
  return null;
}

export function getEditorIssues(
  nodes: ProcessFlowNode[],
  edges: ProcessFlowEdge[],
): EditorIssue[] {
  const issues: EditorIssue[] = [];

  if (nodes.length === 0) {
    issues.push({ id: 'empty-recipe', message: 'Add at least one process step.' });
  }
  if (nodes.length > MAX_RECIPE_NODES) {
    issues.push({
      id: 'node-limit',
      message: `Recipes support at most ${MAX_RECIPE_NODES} steps.`,
    });
  }
  if (edges.length > MAX_RECIPE_EDGES) {
    issues.push({
      id: 'edge-limit',
      message: `Recipes support at most ${MAX_RECIPE_EDGES} connections.`,
    });
  }

  for (const node of nodes) {
    for (const issue of validateStep(node.data.step)) {
      issues.push({
        id: `${node.id}-${issue.field}`,
        nodeId: node.id,
        message: `${node.data.label}: ${issue.message}`,
      });
    }
  }

  const nodeIds = new Set(nodes.map((node) => node.id));
  const connections = new Set<string>();
  for (const edge of edges) {
    if (!nodeIds.has(edge.source) || !nodeIds.has(edge.target)) {
      issues.push({
        id: `${edge.id}-dangling`,
        message: 'A connection references a step that no longer exists.',
      });
    }
    if (edge.source === edge.target) {
      issues.push({
        id: `${edge.id}-self-loop`,
        message: 'A process step cannot connect to itself.',
      });
    }

    const connectionKey = `${edge.source}\u0000${edge.target}`;
    if (connections.has(connectionKey)) {
      issues.push({
        id: `${edge.id}-duplicate`,
        message: 'Two process steps cannot have duplicate connections.',
      });
    }
    connections.add(connectionKey);
  }

  return issues;
}

export function removeNodesAndIncidentEdges(
  nodes: ProcessFlowNode[],
  edges: ProcessFlowEdge[],
  nodeIds: ReadonlySet<string>,
): { nodes: ProcessFlowNode[]; edges: ProcessFlowEdge[] } {
  return {
    nodes: nodes.filter((node) => !nodeIds.has(node.id)),
    edges: edges.filter(
      (edge) => !nodeIds.has(edge.source) && !nodeIds.has(edge.target),
    ),
  };
}
