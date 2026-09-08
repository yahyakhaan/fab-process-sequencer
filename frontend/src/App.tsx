import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import ReactFlow, {
  Background,
  Controls,
  addEdge,
  applyEdgeChanges,
  applyNodeChanges,
} from 'reactflow';
import type { Connection, EdgeChange, NodeChange, NodeTypes } from 'reactflow';

import ProcessNode from './components/ProcessNode';
import { useFabSocket } from './hooks/useFabSocket';
import type {
  EditableStepField,
  ProcessFlowEdge,
  ProcessFlowNode,
  Recipe,
} from './types/recipe';
import { PROTOCOL_VERSION } from './types/recipe';
import { buildExecutionSequence } from './utils/graphParser';
import { getFabWebSocketUrl } from './utils/protocol';
import { updateStepField, validateStep } from './utils/stepConfig';

import 'reactflow/dist/style.css';

const INITIAL_EDGES: ProcessFlowEdge[] = [
  { id: 'e1-2', source: 'step-1', target: 'step-2' },
  { id: 'e2-3', source: 'step-2', target: 'step-3' },
];

const NODE_TYPES: NodeTypes = { processNode: ProcessNode };

function createInitialNodes(): ProcessFlowNode[] {
  return [
    {
      id: 'step-1',
      position: { x: 250, y: 50 },
      type: 'processNode',
      data: {
        label: 'Spin Coat',
        toolId: 'spinner-1',
        step: { kind: 'spin_coat', duration_sec: 45, rpm: 3_000 },
      },
    },
    {
      id: 'step-2',
      position: { x: 250, y: 200 },
      type: 'processNode',
      data: {
        label: 'Soft Bake',
        toolId: 'hotplate-1',
        step: { kind: 'bake', duration_sec: 60, temperature_c: 120 },
      },
    },
    {
      id: 'step-3',
      position: { x: 250, y: 350 },
      type: 'processNode',
      data: {
        label: 'UV Exposure',
        toolId: 'aligner-1',
        step: { kind: 'expose', duration_sec: 15, intensity_mw_cm2: 15 },
      },
    },
  ];
}

function App() {
  const [nodes, setNodes] = useState<ProcessFlowNode[]>(createInitialNodes);
  const [edges, setEdges] = useState<ProcessFlowEdge[]>(INITIAL_EDGES);
  const recipeId = useRef(crypto.randomUUID());
  const { logs, activeStepId, connectionState, sendMessage, clearLogs } =
    useFabSocket(getFabWebSocketUrl());
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const updateNodeData = useCallback(
    (nodeId: string, field: EditableStepField, value: number) => {
      setNodes((currentNodes) =>
        currentNodes.map((node) =>
          node.id === nodeId
            ? {
                ...node,
                data: {
                  ...node.data,
                  step: updateStepField(node.data.step, field, value),
                },
              }
            : node,
        ),
      );
    },
    [setNodes],
  );

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logs]);

  const renderedNodes = useMemo(
    () =>
      nodes.map((node) => ({
        ...node,
        data: {
          ...node.data,
          isActive: node.id === activeStepId,
          updateNodeData,
        },
      })),
    [nodes, activeStepId, updateNodeData],
  );

  const onNodesChange = useCallback(
    (changes: NodeChange[]) =>
      setNodes(
        (currentNodes) =>
          applyNodeChanges(changes, currentNodes) as ProcessFlowNode[],
      ),
    [setNodes],
  );

  const onEdgesChange = useCallback(
    (changes: EdgeChange[]) =>
      setEdges((currentEdges) => applyEdgeChanges(changes, currentEdges)),
    [setEdges],
  );

  const onConnect = useCallback(
    (connection: Connection) =>
      setEdges((currentEdges) => addEdge(connection, currentEdges)),
    [setEdges],
  );

  const deployToFab = () => {
    try {
      for (const node of nodes) {
        const issue = validateStep(node.data.step)[0];
        if (issue) throw new Error(`${node.data.label}: ${issue.message}`);
      }

      const recipeNodes = buildExecutionSequence(nodes, edges);
      const recipe: Recipe = {
        schema_version: PROTOCOL_VERSION,
        recipe_id: recipeId.current,
        name: 'Positive photoresist',
        nodes: recipeNodes,
        edges: edges.map(({ id, source, target }) => ({ id, source, target })),
      };

      sendMessage({
        schema_version: PROTOCOL_VERSION,
        type: 'run_recipe',
        request_id: crypto.randomUUID(),
        recipe,
        simulation: { time_scale: 10, fault: null },
      });
    } catch (error: unknown) {
      alert(error instanceof Error ? error.message : 'Unable to run the recipe.');
    }
  };

  return (
    <div style={{ width: '100vw', height: '100vh', display: 'flex', flexDirection: 'column', background: '#121212', overflow: 'hidden' }}>
      <div style={{ padding: '15px 25px', background: '#1e1e1e', color: '#fff', display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontFamily: 'sans-serif' }}>
        <div>
          <h2 style={{ margin: 0 }}>Fab Process Sequencer</h2>
          <small style={{ color: '#aaa' }}>Simulator · {connectionState}</small>
        </div>
        <button onClick={deployToFab} disabled={connectionState !== 'connected'} style={{ padding: '10px 20px', background: '#007acc', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer', fontWeight: 'bold', opacity: connectionState === 'connected' ? 1 : 0.55 }}>
          Run Simulation
        </button>
      </div>

      <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
        <div style={{ flex: 2 }}>
          <ReactFlow
            nodes={renderedNodes}
            edges={edges}
            nodeTypes={NODE_TYPES}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            fitView
          >
            <Background color="#333" />
            <Controls />
          </ReactFlow>
        </div>

        <div style={{ flex: 1, background: '#000', color: '#0f0', padding: '20px', fontFamily: 'monospace', borderLeft: '2px solid #333', display: 'flex', flexDirection: 'column' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px', borderBottom: '1px solid #333', paddingBottom: '10px' }}>
            <h3 style={{ margin: 0, color: '#fff' }}>Live Telemetry</h3>
            <button onClick={clearLogs} style={{ background: '#333', color: '#fff', border: 'none', padding: '5px 10px', borderRadius: '4px', cursor: 'pointer', fontSize: '12px' }}>
              Clear
            </button>
          </div>

          <div style={{ flex: 1, overflowY: 'auto' }}>
            {logs.map((log, index) => <div key={`${index}-${log}`} style={{ marginBottom: '4px' }}>{log}</div>)}
            <div ref={messagesEndRef} />
          </div>
        </div>
      </div>
    </div>
  );
}

export default App;
