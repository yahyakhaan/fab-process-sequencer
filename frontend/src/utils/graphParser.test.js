import assert from 'node:assert/strict';
import test from 'node:test';

import { buildExecutionSequence } from './graphParser.js';

function node(id) {
  return {
    id,
    data: {
      action: id,
      duration_sec: 1,
      target_value: 1,
    },
  };
}

test('returns an empty sequence for an empty canvas', () => {
  assert.deepEqual(buildExecutionSequence([], []), []);
});

test('orders a linear recipe by its edges rather than node array order', () => {
  const nodes = [node('bake'), node('expose'), node('spin')];
  const edges = [
    { source: 'spin', target: 'bake' },
    { source: 'bake', target: 'expose' },
  ];

  assert.deepEqual(
    buildExecutionSequence(nodes, edges).map((step) => step.id),
    ['spin', 'bake', 'expose'],
  );
});

test('rejects a cycle that has no root node', () => {
  const nodes = [node('a'), node('b')];
  const edges = [
    { source: 'a', target: 'b' },
    { source: 'b', target: 'a' },
  ];

  assert.throws(
    () => buildExecutionSequence(nodes, edges),
    /Cycle detected or no starting point/,
  );
});

test.todo('rejects a disconnected graph instead of silently omitting nodes');
test.todo('handles every branch and join with a real topological sort');
test.todo('rejects dangling, duplicate, and self-referential edges');
