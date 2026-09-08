import assert from 'node:assert/strict';
import test from 'node:test';

import type { ProcessFlowNode } from '../types/recipe.ts';
import { buildExecutionSequence } from './graphParser.ts';

function node(id: string): ProcessFlowNode {
  return {
    id,
    position: { x: 0, y: 0 },
    type: 'processNode',
    data: {
      label: id,
      toolId: `${id}-tool`,
      step: { kind: 'bake', duration_sec: 1, temperature_c: 120 },
    },
  };
}

test('returns an empty sequence for an empty canvas', () => {
  assert.deepEqual(buildExecutionSequence([], []), []);
});

test('orders a linear recipe by its edges rather than node array order', () => {
  const nodes = [node('bake'), node('expose'), node('spin')];
  const edges = [
    { id: 'spin-bake', source: 'spin', target: 'bake' },
    { id: 'bake-expose', source: 'bake', target: 'expose' },
  ];

  assert.deepEqual(
    buildExecutionSequence(nodes, edges).map((step) => step.id),
    ['spin', 'bake', 'expose'],
  );
});

test('rejects a cycle that has no root node', () => {
  const nodes = [node('a'), node('b')];
  const edges = [
    { id: 'a-b', source: 'a', target: 'b' },
    { id: 'b-a', source: 'b', target: 'a' },
  ];

  assert.throws(
    () => buildExecutionSequence(nodes, edges),
    /Cycle detected or no starting point/,
  );
});

test.todo('rejects a disconnected graph instead of silently omitting nodes');
test.todo('handles every branch and join with a real topological sort');
test.todo('rejects dangling, duplicate, and self-referential edges');
