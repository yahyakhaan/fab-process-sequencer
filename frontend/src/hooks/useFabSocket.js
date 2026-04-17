import { useEffect, useRef, useState, useCallback } from 'react';

export function useFabSocket(url) {
  const ws = useRef(null);
  const [logs, setLogs] = useState([]);
  const [activeStepId, setActiveStepId] = useState(null);

  useEffect(() => {
    ws.current = new WebSocket(url);
    ws.current.onopen = () => setLogs(prev => [...prev, '> Connected to Rust Fab Backend']);
    
    ws.current.onmessage = (msg) => {
      const data = JSON.parse(msg.data);
      if (data.status === "Complete") {
        setLogs(prev => [...prev, `> FAB SEQUENCE COMPLETE`]);
        setActiveStepId(null);
      } else {
        setLogs(prev => [...prev, `> [${data.step_id}] ${data.status.toUpperCase()} | Target: ${Math.round(data.current_value)} | Sec: ${data.progress_sec}`]);
        setActiveStepId(data.step_id);
      }
    };
    
    ws.current.onerror = () => setLogs(prev => [...prev, '> WebSocket Error']);
    return () => ws.current?.close();
  }, [url]);

  const sendPayload = (payload) => {
    if (ws.current && ws.current.readyState === WebSocket.OPEN) {
      ws.current.send(JSON.stringify(payload));
      setLogs(prev => [...prev, `> Deployed sequence of ${payload.steps.length} steps.`]);
    } else {
      throw new Error("WebSocket is not connected! Is the Rust server running?");
    }
  };

  const clearLogs = useCallback(() => setLogs([]), []);

  return { logs, activeStepId, sendPayload, clearLogs }; 
}