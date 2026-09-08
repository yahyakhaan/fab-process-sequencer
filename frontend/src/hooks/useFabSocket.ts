import { useCallback, useEffect, useRef, useState } from 'react';

import type {
  ClientMessage,
  ConnectionState,
  RunState,
  TelemetrySeries,
} from '../types/protocol';
import type { StepRunStatus } from '../types/recipe';
import {
  HEARTBEAT_INTERVAL_MS,
  assertProtocolPayloadSize,
  getReconnectDelay,
  isHeartbeatExpired,
} from '../utils/connectionPolicy';
import { parseServerMessage } from '../utils/protocol';
import { formatServerMessage } from '../utils/stepConfig';
import { appendTelemetrySample } from '../utils/telemetry';

const MAX_LOG_ENTRIES = 500;

export type EventLogEntry = {
  id: number;
  timestampMs: number;
  tone: 'info' | 'success' | 'warning' | 'error';
  message: string;
};

function messageTone(type: string): EventLogEntry['tone'] {
  if (type === 'run_failed' || type === 'run_rejected') return 'error';
  if (type === 'run_cancelled') return 'warning';
  if (type === 'run_completed' || type === 'connection_ready') return 'success';
  return 'info';
}

export function useFabSocket(url: string) {
  const socketRef = useRef<WebSocket | null>(null);
  const logIdRef = useRef(0);
  const runStateRef = useRef<RunState>('idle');
  const activeStepIdRef = useRef<string | null>(null);
  const [logs, setLogs] = useState<EventLogEntry[]>([]);
  const [activeStepId, setActiveStepId] = useState<string | null>(null);
  const [currentRunId, setCurrentRunId] = useState<string | null>(null);
  const [latestTelemetryStepId, setLatestTelemetryStepId] =
    useState<string | null>(null);
  const [stepStates, setStepStates] =
    useState<Record<string, StepRunStatus>>({});
  const [telemetrySeries, setTelemetrySeries] =
    useState<Record<string, TelemetrySeries>>({});
  const [runState, setRunState] = useState<RunState>('idle');
  const [lastError, setLastError] = useState<string | null>(null);
  const [connectionState, setConnectionState] =
    useState<ConnectionState>('connecting');
  const [retryInMs, setRetryInMs] = useState<number | null>(null);
  const [retryNonce, setRetryNonce] = useState(0);

  const updateRunState = useCallback((state: RunState) => {
    runStateRef.current = state;
    setRunState(state);
  }, []);

  const updateActiveStep = useCallback((stepId: string | null) => {
    activeStepIdRef.current = stepId;
    setActiveStepId(stepId);
  }, []);

  const appendLog = useCallback(
    (
      message: string,
      tone: EventLogEntry['tone'] = 'info',
      timestampMs = Date.now(),
    ) => {
      const entry: EventLogEntry = {
        id: ++logIdRef.current,
        timestampMs,
        tone,
        message,
      };
      setLogs((currentLogs) =>
        [...currentLogs, entry].slice(-MAX_LOG_ENTRIES),
      );
    },
    [],
  );

  useEffect(() => {
    let disposed = false;
    let retryTimer: number | undefined;
    let heartbeatTimer: number | undefined;
    let reconnectAttempt = 0;
    let lastMessageAtMs = Date.now();

    const stopHeartbeat = () => {
      if (heartbeatTimer !== undefined) {
        window.clearInterval(heartbeatTimer);
        heartbeatTimer = undefined;
      }
    };

    const scheduleReconnect = () => {
      const delay = getReconnectDelay(reconnectAttempt);
      reconnectAttempt += 1;
      setRetryInMs(delay);
      retryTimer = window.setTimeout(connect, delay);
    };

    const connect = () => {
      if (disposed) return;
      setConnectionState('connecting');
      setRetryInMs(null);

      const socket = new WebSocket(url);
      socketRef.current = socket;

      socket.onopen = () => {
        if (disposed || socketRef.current !== socket) return;
        reconnectAttempt = 0;
        lastMessageAtMs = Date.now();
        setConnectionState('connected');
        setRetryInMs(null);
        stopHeartbeat();
        heartbeatTimer = window.setInterval(() => {
          if (socketRef.current !== socket || socket.readyState !== WebSocket.OPEN) {
            return;
          }
          if (isHeartbeatExpired(lastMessageAtMs, Date.now())) {
            appendLog('Simulator heartbeat timed out', 'error');
            socket.close(4000, 'Heartbeat timeout');
            return;
          }
          socket.send(JSON.stringify({
            schema_version: 1,
            type: 'ping',
            request_id: `heartbeat-${Date.now()}`,
          } satisfies ClientMessage));
        }, HEARTBEAT_INTERVAL_MS);
      };

      socket.onmessage = (event: MessageEvent<unknown>) => {
        if (disposed || socketRef.current !== socket) return;
        lastMessageAtMs = Date.now();
        try {
          if (typeof event.data !== 'string') {
            throw new Error('Received a non-text WebSocket message.');
          }

          assertProtocolPayloadSize(event.data);
          const message = parseServerMessage(event.data);
          const formatted = formatServerMessage(message);
          if (formatted) {
            appendLog(
              formatted.replace(/^>\s*/, ''),
              messageTone(message.type),
              'timestamp_ms' in message ? message.timestamp_ms : Date.now(),
            );
          }

          switch (message.type) {
            case 'connection_ready':
              if (runStateRef.current !== 'failed') setLastError(null);
              break;
            case 'run_accepted':
              setCurrentRunId(message.run_id);
              updateRunState('running');
              break;
            case 'run_rejected':
              setLastError(message.message);
              updateActiveStep(null);
              updateRunState('failed');
              break;
            case 'step_started':
              updateActiveStep(message.step_id);
              setStepStates((current) => ({
                ...current,
                [message.step_id]: 'active',
              }));
              break;
            case 'step_progress':
              updateActiveStep(message.step_id);
              setStepStates((current) => ({
                ...current,
                [message.step_id]: 'active',
              }));
              setTelemetrySeries((current) => {
                const existing = current[message.step_id];
                if (existing && existing.kind !== message.telemetry.kind) {
                  return current;
                }
                return {
                  ...current,
                  [message.step_id]: appendTelemetrySample(
                    existing,
                    message.step_id,
                    message.telemetry,
                    message.simulated_time_ms,
                  ),
                };
              });
              setLatestTelemetryStepId(message.step_id);
              break;
            case 'step_completed':
              setStepStates((current) => ({
                ...current,
                [message.step_id]: 'completed',
              }));
              if (activeStepIdRef.current === message.step_id) {
                updateActiveStep(null);
              }
              break;
            case 'run_completed':
              updateActiveStep(null);
              updateRunState('completed');
              break;
            case 'run_cancelled': {
              const cancelledStepId = message.step_id ?? activeStepIdRef.current;
              if (cancelledStepId) {
                setStepStates((current) => ({
                  ...current,
                  [cancelledStepId]: 'cancelled',
                }));
              }
              updateActiveStep(null);
              updateRunState('cancelled');
              break;
            }
            case 'run_failed':
              if (message.step_id) {
                setStepStates((current) => ({
                  ...current,
                  [message.step_id!]: 'failed',
                }));
              }
              setLastError(message.message);
              updateActiveStep(null);
              updateRunState('failed');
              break;
            case 'pong':
              break;
          }
        } catch (error: unknown) {
          const message =
            error instanceof Error ? error.message : 'Unknown protocol error.';
          appendLog(`Protocol error: ${message}`, 'error');
        }
      };

      socket.onerror = () => {
        if (disposed || socketRef.current !== socket) return;
        setConnectionState('error');
        appendLog('WebSocket connection error', 'error');
      };

      socket.onclose = () => {
        if (disposed || socketRef.current !== socket) return;
        stopHeartbeat();
        socketRef.current = null;
        setConnectionState('disconnected');
        appendLog('Simulator connection closed', 'warning');

        if (
          runStateRef.current === 'running'
          || runStateRef.current === 'validating'
        ) {
          const interruptedStepId = activeStepIdRef.current;
          if (interruptedStepId) {
            setStepStates((current) => ({
              ...current,
              [interruptedStepId]: 'cancelled',
            }));
          }
          updateActiveStep(null);
          setLastError('Connection lost. The interrupted run was stopped safely.');
          updateRunState('failed');
        }

        scheduleReconnect();
      };
    };

    connect();

    return () => {
      disposed = true;
      if (retryTimer !== undefined) window.clearTimeout(retryTimer);
      stopHeartbeat();
      const socket = socketRef.current;
      if (socket) {
        socketRef.current = null;
        socket.close();
      }
    };
  }, [appendLog, retryNonce, updateActiveStep, updateRunState, url]);

  const sendMessage = useCallback(
    (message: ClientMessage) => {
      if (socketRef.current?.readyState !== WebSocket.OPEN) {
        throw new Error('The simulator is disconnected. Retry the connection first.');
      }

      const payload = JSON.stringify(message);
      assertProtocolPayloadSize(payload);
      socketRef.current.send(payload);

      if (message.type === 'run_recipe') {
        setCurrentRunId(null);
        setLastError(null);
        updateActiveStep(null);
        updateRunState('validating');
        setTelemetrySeries({});
        setLatestTelemetryStepId(null);
        setStepStates(
          Object.fromEntries(
            message.recipe.nodes.map((node) => [node.id, 'pending' as const]),
          ),
        );
        appendLog('Validating recipe with the simulator', 'info');
      } else if (message.type === 'cancel_run') {
        appendLog(`Cancellation requested for ${message.run_id}`, 'warning');
      }
    },
    [appendLog, updateActiveStep, updateRunState],
  );

  const retry = useCallback(() => {
    setRetryNonce((value) => value + 1);
  }, []);

  const resetRun = useCallback(() => {
    if (
      runStateRef.current === 'running'
      || runStateRef.current === 'validating'
    ) {
      return;
    }
    setCurrentRunId(null);
    setLastError(null);
    updateActiveStep(null);
    setStepStates({});
    updateRunState('idle');
  }, [updateActiveStep, updateRunState]);

  const clearLogs = useCallback(() => setLogs([]), []);

  return {
    logs,
    activeStepId,
    currentRunId,
    latestTelemetryStepId,
    stepStates,
    telemetrySeries,
    runState,
    lastError,
    connectionState,
    retryInMs,
    sendMessage,
    retry,
    resetRun,
    clearLogs,
  };
}
