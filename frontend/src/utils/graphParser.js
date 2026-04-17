export function buildExecutionSequence(nodes, edges) {
  if (!nodes || nodes.length === 0) return [];

  const nodeMap = new Map(nodes.map(node => [node.id, node]));

  const targetIds = new Set(edges.map(edge => edge.target));
  const rootNodes = nodes.filter(node => !targetIds.has(node.id));

  if (rootNodes.length === 0) {
    throw new Error("Invalid Sequence: Cycle detected or no starting point.");
  }

  let currentNodeId = rootNodes[0].id;
  const sequence = [];
  const visited = new Set();

  while (currentNodeId) {
    // Cycle detection
    if (visited.has(currentNodeId)) {
      throw new Error("Invalid Sequence: Cycle detected. Fab processes must be linear.");
    }
    visited.add(currentNodeId);

    const node = nodeMap.get(currentNodeId);
    if (node) {
      sequence.push({
        id: node.id,
        action: node.data.action,
        duration_sec: node.data.duration_sec,
        target_value: node.data.target_value
      });
    }

    const outgoingEdge = edges.find(edge => edge.source === currentNodeId);
    currentNodeId = outgoingEdge ? outgoingEdge.target : null;
  }

  return sequence;
}