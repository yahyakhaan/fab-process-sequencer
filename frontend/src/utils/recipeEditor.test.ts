import assert from 'node:assert/strict';
import test from 'node:test';

import type { ProcessFlowEdge } from '../types/recipe.ts';
import {
  createProcessNode,
  createSampleGraph,
  getConnectionIssue,
  getEditorIssues,
  isStepKind,
  removeNodesAndIncidentEdges,
} from './recipeEditor.ts';

test('creates every palette step with typed defaults and a stable supplied id', () => {
  const spin = createProcessNode('spin_coat', { x: 12, y: 24 }, 'spin-1');
  const bake = createProcessNode('bake', { x: 30, y: 40 }, 'bake-1');
  const expose = createProcessNode('expose', { x: 50, y: 60 }, 'expose-1');

  assert.equal(spin.id, 'spin-1');
  assert.deepEqual(spin.position, { x: 12, y: 24 });
  assert.deepEqual(spin.data.step, {
    kind: 'spin_coat',
    duration_sec: 45,
    rpm: 3_000,
  });
  assert.equal(bake.data.step.kind, 'bake');
  assert.equal(expose.data.step.kind, 'expose');
});

test('recognizes only supported drag payloads', () => {
  assert.equal(isStepKind('spin_coat'), true);
  assert.equal(isStepKind('bake'), true);
  assert.equal(isStepKind('expose'), true);
  assert.equal(isStepKind('etch'), false);
  assert.equal(isStepKind(''), false);
});

test('rejects self-loop and duplicate connections before adding an edge', () => {
  const edges: ProcessFlowEdge[] = [
    { id: 'a-b', source: 'a', target: 'b' },
  ];

  assert.match(
    getConnectionIssue(
      { source: 'a', target: 'a', sourceHandle: null, targetHandle: null },
      edges,
    ) ?? '',
    /cannot connect to itself/,
  );
  assert.match(
    getConnectionIssue(
      { source: 'a', target: 'b', sourceHandle: null, targetHandle: null },
      edges,
    ) ?? '',
    /already connected/,
  );
  assert.equal(
    getConnectionIssue(
      { source: 'b', target: 'a', sourceHandle: null, targetHandle: null },
      edges,
    ),
    null,
  );
});

test('deleting a node also removes every incident edge', () => {
  const nodes = [
    createProcessNode('spin_coat', { x: 0, y: 0 }, 'a'),
    createProcessNode('bake', { x: 0, y: 0 }, 'b'),
    createProcessNode('expose', { x: 0, y: 0 }, 'c'),
  ];
  const edges: ProcessFlowEdge[] = [
    { id: 'a-b', source: 'a', target: 'b' },
    { id: 'b-c', source: 'b', target: 'c' },
    { id: 'a-c', source: 'a', target: 'c' },
  ];

  const result = removeNodesAndIncidentEdges(nodes, edges, new Set(['b']));

  assert.deepEqual(result.nodes.map((node) => node.id), ['a', 'c']);
  assert.deepEqual(result.edges.map((edge) => edge.id), ['a-c']);
});

test('reports invalid typed parameters before a recipe can run', () => {
  const invalidNode = createProcessNode('bake', { x: 0, y: 0 }, 'bake');
  invalidNode.data.step = {
    kind: 'bake',
    duration_sec: 0,
    temperature_c: 500,
  };

  const messages = getEditorIssues([invalidNode], []).map(
    (issue) => issue.message,
  );

  assert.equal(messages.length, 2);
  assert.ok(messages.some((message) => message.includes('Duration')));
  assert.ok(messages.some((message) => message.includes('Temperature')));
});

test('loads a fresh three-step sample graph', () => {
  const first = createSampleGraph();
  const second = createSampleGraph();

  assert.deepEqual(first.nodes.map((node) => node.id), [
    'step-1',
    'step-2',
    'step-3',
  ]);
  assert.equal(first.edges.length, 2);
  assert.notEqual(first.nodes, second.nodes);
  assert.notEqual(first.nodes[0], second.nodes[0]);
});
