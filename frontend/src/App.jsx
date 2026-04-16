import { useCallback, useEffect, useState, useRef } from 'react';
import ReactFlow, {
  Background,
  Controls,
  applyNodeChanges,
  applyEdgeChanges,
  addEdge,
} from 'reactflow';
import 'reactflow/dist/style.css';

// scaffold a basic lithography sequence
const initialNodes = [
  { id: 'step-1', position: { x: 250, y: 100 }, data: { label: 'Spin Coat (Photoresist)' }, type: 'default' },
  { id: 'step-2', position: { x: 250, y: 200 }, data: { label: 'Soft Bake (120°C)' }, type: 'default' },
  { id: 'step-3', position: { x: 250, y: 300 }, data: { label: 'UV Exposure' }, type: 'default' },
];

const initialEdges = [
  { id: 'e1-2', source: 'step-1', target: 'step-2' },
  { id: 'e2-3', source: 'step-2', target: 'step-3' },
];

function App() {
  const [nodes, setNodes] = useState(initialNodes);
  const [edges, setEdges] = useState(initialEdges);
  const ws = useRef(null);

  useEffect(() => {
    // 1. Establish connection to the Rust backend
    ws.current = new WebSocket('ws://127.0.0.1:3000/ws');
    
    ws.current.onopen = () => console.log('Connected to Rust Fab Backend');
    ws.current.onmessage = (msg) => console.log('Telemetry from Fab:', msg.data);
    ws.current.onerror = (err) => console.error('WebSocket Error:', err);
    
    return () => ws.current?.close();
  }, []);

  const onNodesChange = useCallback((changes) => setNodes((nds) => applyNodeChanges(changes, nds)), []);
  const onEdgesChange = useCallback((changes) => setEdges((eds) => applyEdgeChanges(changes, eds)), []);
  const onConnect = useCallback((params) => setEdges((eds) => addEdge(params, eds)), []);

  const deployToFab = () => {
    // 2. Map the visual nodes to our data contract
    const steps = nodes.map((node) => {
      let action = "unknown";
      let duration_sec = 30;
      let target_value = 0;

      if (node.data.label.includes("Bake")) { 
        action = "bake"; target_value = 120; duration_sec = 60; 
      } else if (node.data.label.includes("Spin")) { 
        action = "spin_coat"; target_value = 3000; duration_sec = 45;
      } else if (node.data.label.includes("UV")) { 
        action = "expose"; duration_sec = 15; 
      }

      return {
        id: node.id,
        action,
        duration_sec,
        target_value
      };
    });

    const payload = { steps };
    
    // 3. Fire the JSON payload over the WebSocket
    if (ws.current && ws.current.readyState === WebSocket.OPEN) {
      ws.current.send(JSON.stringify(payload));
      console.log("Deployed recipe:", payload);
    } else {
      alert("WebSocket is not connected! Is the Rust server running?");
    }
  };

  return (
    <div style={{ width: '100vw', height: '100vh', display: 'flex', flexDirection: 'column' }}>
      
      <div style={{ padding: '15px 25px', background: '#1e1e1e', color: '#fff', display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontFamily: 'sans-serif' }}>
        <h2 style={{ margin: 0 }}>Process Sequencer</h2>
        <button 
          onClick={deployToFab} 
          style={{ padding: '10px 20px', background: '#007acc', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer', fontWeight: 'bold', fontSize: '14px' }}>
          Deploy to Fab 
        </button>
      </div>

      <div style={{ flex: 1 }}>
        <ReactFlow 
          nodes={nodes} 
          edges={edges} 
          onNodesChange={onNodesChange} 
          onEdgesChange={onEdgesChange} 
          onConnect={onConnect}
          fitView
        >
          <Background />
          <Controls />
        </ReactFlow>
      </div>
      
    </div>
  );
}

export default App;