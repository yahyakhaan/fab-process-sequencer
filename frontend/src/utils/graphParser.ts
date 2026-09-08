import type {
  ProcessFlowEdge,
  ProcessFlowNode,
  RecipeNode,
} from '../types/recipe';

export function buildExecutionSequence(
  nodes: ProcessFlowNode[],
  edges: ProcessFlowEdge[],
): RecipeNode[] {
  if (nodes.length === 0) return [];

  const nodeMap = new Map(nodes.map((node) => [node.id, node]));
  const targetIds = new Set(edges.map((edge) => edge.target));
  const rootNodes = nodes.filter((node) => !targetIds.has(node.id));

  if (rootNodes.length === 0) {
    throw new Error('Invalid Sequence: Cycle detected or no starting point.');
  }

  let currentNodeId: string | null = rootNodes[0]!.id;
  const sequence: RecipeNode[] = [];
  const visited = new Set<string>();

  while (currentNodeId) {
    if (visited.has(currentNodeId)) {
      throw new Error('Invalid Sequence: Cycle detected. Fab processes must be linear.');
    }
    visited.add(currentNodeId);

    const node = nodeMap.get(currentNodeId);
    if (node) {
      sequence.push({
        id: node.id,
        label: node.data.label,
        tool_id: node.data.toolId,
        step: node.data.step,
      });
    }

    const outgoingEdge = edges.find((edge) => edge.source === currentNodeId);
    currentNodeId = outgoingEdge?.target ?? null;
  }

  return sequence;
}
