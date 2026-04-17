import { useCallback, useState, useMemo } from 'react';
import ReactFlow, { Background, Controls, applyNodeChanges, applyEdgeChanges, addEdge } from 'reactflow';
import { buildExecutionSequence } from './utils/graphParser';
import { useFabSocket } from './hooks/useFabSocket';

import 'reactflow/dist/style.css';
import ProcessNode from './components/ProcessNode';

function App() {
  // 1. Function that updates node data when inputs change
  const updateNodeData = useCallback((nodeId, fieldName, value) => {
    setNodes((nds) =>
      nds.map((node) => {
        if (node.id === nodeId) {
          node.data = { ...node.data, [fieldName]: value };
        }
        return node;
      })
    );
  }, []);

  // 2. Setup initial nodes using the custom data structure
  const initialNodes = useMemo(() => [
    { id: 'step-1', position: { x: 250, y: 50 }, type: 'processNode', data: { label: 'Spin Coat', action: 'spin_coat', duration_sec: 45, target_value: 3000, updateNodeData } },
    { id: 'step-2', position: { x: 250, y: 200 }, type: 'processNode', data: { label: 'Soft Bake', action: 'bake', duration_sec: 60, target_value: 120, updateNodeData } },
    { id: 'step-3', position: { x: 250, y: 350 }, type: 'processNode', data: { label: 'UV Exposure', action: 'expose', duration_sec: 15, target_value: 0, updateNodeData } },
  ], [updateNodeData]);

  const initialEdges = [
    { id: 'e1-2', source: 'step-1', target: 'step-2' },
    { id: 'e2-3', source: 'step-2', target: 'step-3' },
  ];

  // 3. Register the custom node type with React Flow
  const nodeTypes = useMemo(() => ({ processNode: ProcessNode }), []);

  const [nodes, setNodes] = useState(initialNodes);
  const [edges, setEdges] = useState(initialEdges);

  // 4. Use the custom WebSocket hook
  const { logs, activeStepId, sendPayload } = useFabSocket('ws://127.0.0.1:3000/ws');

  // 5. Dynamically map over nodes to inject the isActive flag based on telemetry
  const activeNodes = useMemo(() => {
    return nodes.map((node) => ({
      ...node,
      data: {
        ...node.data,
        isActive: node.id === activeStepId
      }
    }));
  }, [nodes, activeStepId]);

  const onNodesChange = useCallback((changes) => setNodes((nds) => applyNodeChanges(changes, nds)), []);
  const onEdgesChange = useCallback((changes) => setEdges((eds) => applyEdgeChanges(changes, eds)), []);
  const onConnect = useCallback((params) => setEdges((eds) => addEdge(params, eds)), []);
  const deployToFab = () => {
    try {
      // Traverse the graph visually
      const steps = buildExecutionSequence(nodes, edges);
      sendPayload({ steps });
    } catch (error) {
      // Catch cycle errors or disconnected graphs
      alert(error.message);
    }
  };

  return (
    <div style={{ width: '100vw', height: '100vh', display: 'flex', flexDirection: 'column', background: '#121212' }}>
      <div style={{ padding: '15px 25px', background: '#1e1e1e', color: '#fff', display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontFamily: 'sans-serif' }}>
        <h2 style={{ margin: 0 }}>Process Sequencer</h2>
        <button onClick={deployToFab} style={{ padding: '10px 20px', background: '#007acc', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer', fontWeight: 'bold' }}>
          Deploy to Fab
        </button>
      </div>

      <div style={{ flex: 1, display: 'flex' }}>
        <div style={{ flex: 2 }}>
          <ReactFlow 
            nodes={activeNodes} 
            edges={edges} 
            nodeTypes={nodeTypes}
            onNodesChange={onNodesChange} 
            onEdgesChange={onEdgesChange} 
            onConnect={onConnect}
            fitView
          >
            <Background color="#333" />
            <Controls />
          </ReactFlow>
        </div>

        <div style={{ flex: 1, background: '#000', color: '#0f0', padding: '20px', fontFamily: 'monospace', overflowY: 'auto', borderLeft: '2px solid #333' }}>
          <h3 style={{ marginTop: 0, color: '#fff' }}>Live Telemetry Log</h3>
          {logs.map((log, index) => <div key={index} style={{ marginBottom: '4px' }}>{log}</div>)}
        </div>
      </div>
    </div>
  );
}

export default App;