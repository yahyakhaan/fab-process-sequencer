import { useCallback, useEffect, useRef, useState } from 'react';

import type { ClientMessage, ConnectionState } from '../types/protocol';
import { parseServerMessage } from '../utils/protocol';
import { formatServerMessage } from '../utils/stepConfig';

export function useFabSocket(url: string) {
  const socketRef = useRef<WebSocket | null>(null);
  const [logs, setLogs] = useState<string[]>([]);
  const [activeStepId, setActiveStepId] = useState<string | null>(null);
  const [connectionState, setConnectionState] =
    useState<ConnectionState>('connecting');

  useEffect(() => {
    const socket = new WebSocket(url);
    let disposed = false;
    socketRef.current = socket;

    socket.onopen = () => {
      if (!disposed) setConnectionState('connected');
    };

    socket.onmessage = (event: MessageEvent<unknown>) => {
      if (disposed) return;
      try {
        if (typeof event.data !== 'string') {
          throw new Error('Received a non-text WebSocket message.');
        }

        const message = parseServerMessage(event.data);
        const formatted = formatServerMessage(message);
        if (formatted) setLogs((currentLogs) => [...currentLogs, formatted]);

        switch (message.type) {
          case 'step_started':
          case 'step_progress':
            setActiveStepId(message.step_id);
            break;
          case 'step_completed':
            setActiveStepId((currentId) =>
              currentId === message.step_id ? null : currentId,
            );
            break;
          case 'run_completed':
          case 'run_rejected':
            setActiveStepId(null);
            break;
        }
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : 'Unknown protocol error.';
        setLogs((currentLogs) => [...currentLogs, `> Protocol error: ${message}`]);
      }
    };

    socket.onerror = () => {
      if (disposed) return;
      setConnectionState('error');
      setLogs((currentLogs) => [...currentLogs, '> WebSocket error']);
    };

    socket.onclose = () => {
      if (disposed) return;
      setConnectionState('disconnected');
      setActiveStepId(null);
      setLogs((currentLogs) => [...currentLogs, '> Fab backend disconnected']);
    };

    return () => {
      disposed = true;
      if (socketRef.current === socket) socketRef.current = null;
      socket.close();
    };
  }, [url]);

  const sendMessage = useCallback((message: ClientMessage) => {
    if (socketRef.current?.readyState !== WebSocket.OPEN) {
      throw new Error('WebSocket is not connected. Is the Rust server running?');
    }

    socketRef.current.send(JSON.stringify(message));
  }, []);

  const clearLogs = useCallback(() => setLogs([]), []);

  return { logs, activeStepId, connectionState, sendMessage, clearLogs };
}
