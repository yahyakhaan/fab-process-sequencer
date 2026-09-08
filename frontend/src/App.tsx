import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  DragEvent,
  MouseEvent as ReactMouseEvent,
} from 'react';
import ReactFlow, {
  Background,
  Controls,
  addEdge,
  applyEdgeChanges,
  applyNodeChanges,
} from 'reactflow';
import type {
  Connection,
  DefaultEdgeOptions,
  EdgeChange,
  NodeChange,
  NodeOrigin,
  NodeTypes,
  ReactFlowInstance,
  XYPosition,
} from 'reactflow';

import ProcessNode from './components/ProcessNode';
import TelemetryPlot from './components/TelemetryPlot';
import { useFabSocket } from './hooks/useFabSocket';
import type { FaultInjection } from './types/protocol';
import type {
  EditableStepField,
  ProcessFlowEdge,
  ProcessFlowNode,
  ProcessNodeData,
  Recipe,
  StepKind,
} from './types/recipe';
import { PROTOCOL_VERSION } from './types/recipe';
import { buildExecutionSequence } from './utils/graphParser';
import { getFabWebSocketUrl } from './utils/protocol';
import {
  MAX_RECIPE_EDGES,
  MAX_RECIPE_NODES,
  STEP_KIND_DRAG_TYPE,
  STEP_TEMPLATES,
  createProcessNode,
  createSampleGraph,
  getConnectionIssue,
  getEditorIssues,
  isStepKind,
} from './utils/recipeEditor';
import { updateStepField } from './utils/stepConfig';

import 'reactflow/dist/style.css';

const NODE_TYPES: NodeTypes = { processNode: ProcessNode };
const NODE_ORIGIN: NodeOrigin = [0.5, 0.5];
const DEFAULT_EDGE_OPTIONS: DefaultEdgeOptions = {
  animated: true,
  style: { stroke: '#6f8098', strokeWidth: 2 },
};

type EditorMessage = {
  tone: 'info' | 'error' | 'success' | 'warning';
  text: string;
};

function App() {
  const [nodes, setNodes] = useState<ProcessFlowNode[]>([]);
  const [edges, setEdges] = useState<ProcessFlowEdge[]>([]);
  const [flowInstance, setFlowInstance] =
    useState<ReactFlowInstance<ProcessNodeData> | null>(null);
  const [editorMessage, setEditorMessage] =
    useState<EditorMessage | null>(null);
  const [faultInjection, setFaultInjection] =
    useState<FaultInjection>(null);
  const recipeId = useRef(crypto.randomUUID());
  const flowContainerRef = useRef<HTMLDivElement>(null);
  const telemetryStreamRef = useRef<HTMLDivElement>(null);
  const {
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
  } = useFabSocket(getFabWebSocketUrl());

  useEffect(() => {
    const stream = telemetryStreamRef.current;
    if (stream) stream.scrollTop = stream.scrollHeight;
  }, [logs]);

  const editorIssues = useMemo(
    () => getEditorIssues(nodes, edges),
    [nodes, edges],
  );
  const selectedNodeCount = nodes.filter((node) => node.selected).length;
  const selectedEdgeCount = edges.filter((edge) => edge.selected).length;
  const selectedCount = selectedNodeCount + selectedEdgeCount;
  const editorLocked = runState === 'validating' || runState === 'running';
  const recipeRevision = useMemo(
    () => JSON.stringify({
      nodes: nodes.map((node) => ({ id: node.id, data: node.data })),
      edges: edges.map(({ id, source, target }) => ({ id, source, target })),
      faultInjection,
    }),
    [edges, faultInjection, nodes],
  );
  const previousRecipeRevision = useRef(recipeRevision);
  const plotStepId =
    nodes.find((node) => node.selected)?.id
    ?? activeStepId
    ?? latestTelemetryStepId
    ?? undefined;
  const plotStepLabel = nodes.find((node) => node.id === plotStepId)?.data.label;
  const selectedTelemetrySeries = plotStepId
    ? telemetrySeries[plotStepId]
    : undefined;

  useEffect(() => {
    if (previousRecipeRevision.current !== recipeRevision) {
      previousRecipeRevision.current = recipeRevision;
      resetRun();
    }
  }, [recipeRevision, resetRun]);

  const updateNodeData = useCallback(
    (nodeId: string, field: EditableStepField, value: number) => {
      if (editorLocked) return;
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
      setEditorMessage(null);
    },
    [editorLocked],
  );

  const deleteNode = useCallback((nodeId: string) => {
    if (editorLocked) return;
    setNodes((currentNodes) =>
      currentNodes.filter((node) => node.id !== nodeId),
    );
    setEdges((currentEdges) =>
      currentEdges.filter(
        (edge) => edge.source !== nodeId && edge.target !== nodeId,
      ),
    );
    setEditorMessage({ tone: 'info', text: 'Process step removed.' });
  }, [editorLocked]);

  const renderedNodes = useMemo(
    () =>
      nodes.map((node) => ({
        ...node,
        data: {
          ...node.data,
          isActive: node.id === activeStepId,
          runStatus: stepStates[node.id],
          isLocked: editorLocked,
          updateNodeData,
          deleteNode,
        },
      })),
    [
      nodes,
      activeStepId,
      stepStates,
      editorLocked,
      updateNodeData,
      deleteNode,
    ],
  );

  const onNodesChange = useCallback((changes: NodeChange[]) => {
    const removedNodeIds = new Set(
      changes
        .filter((change) => change.type === 'remove')
        .map((change) => change.id),
    );

    if (removedNodeIds.size > 0) {
      setEdges((currentEdges) =>
        currentEdges.filter(
          (edge) =>
            !removedNodeIds.has(edge.source)
            && !removedNodeIds.has(edge.target),
        ),
      );
    }

    setNodes(
      (currentNodes) =>
        applyNodeChanges(changes, currentNodes) as ProcessFlowNode[],
    );
  }, []);

  const onEdgesChange = useCallback(
    (changes: EdgeChange[]) =>
      setEdges((currentEdges) => applyEdgeChanges(changes, currentEdges)),
    [],
  );

  const onConnect = useCallback(
    (connection: Connection) => {
      if (editorLocked) return;
      const issue = getConnectionIssue(connection, edges);
      if (issue) {
        setEditorMessage({ tone: 'error', text: issue });
        return;
      }
      if (edges.length >= MAX_RECIPE_EDGES) {
        setEditorMessage({
          tone: 'error',
          text: `Recipes support at most ${MAX_RECIPE_EDGES} connections.`,
        });
        return;
      }

      setEdges((currentEdges) =>
        addEdge(
          { ...connection, id: `edge-${crypto.randomUUID()}` },
          currentEdges,
        ),
      );
      setEditorMessage({ tone: 'success', text: 'Process steps connected.' });
    },
    [edges, editorLocked],
  );

  const addStepAt = useCallback(
    (kind: StepKind, position: XYPosition) => {
      if (editorLocked) return;
      if (nodes.length >= MAX_RECIPE_NODES) {
        setEditorMessage({
          tone: 'error',
          text: `Recipes support at most ${MAX_RECIPE_NODES} steps.`,
        });
        return;
      }

      const newNode = createProcessNode(kind, position);
      setNodes((currentNodes) => [...currentNodes, newNode]);
      setEditorMessage({
        tone: 'success',
        text: `${newNode.data.label} added. Drag from one node handle to another to connect it.`,
      });
    },
    [editorLocked, nodes.length],
  );

  const addStepToCanvas = useCallback(
    (kind: StepKind) => {
      const container = flowContainerRef.current;
      const placementIndex = nodes.length % 9;
      const xOffset = ((placementIndex % 3) - 1) * 230;
      const yOffset = (Math.floor(placementIndex / 3) - 1) * 165;
      const position =
        container && flowInstance
          ? flowInstance.screenToFlowPosition({
              x: container.getBoundingClientRect().left
                + container.clientWidth / 2
                + xOffset,
              y: container.getBoundingClientRect().top
                + container.clientHeight / 2
                + yOffset,
            })
          : { x: 320 + xOffset, y: 240 + yOffset };
      addStepAt(kind, position);
    },
    [addStepAt, flowInstance, nodes.length],
  );

  const onPaletteDragStart = useCallback(
    (event: DragEvent<HTMLButtonElement>, kind: StepKind) => {
      event.dataTransfer.setData(STEP_KIND_DRAG_TYPE, kind);
      event.dataTransfer.effectAllowed = 'copy';
    },
    [],
  );

  const onDragOver = useCallback((event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
  }, []);

  const onDrop = useCallback(
    (event: DragEvent<HTMLDivElement>) => {
      event.preventDefault();
      if (editorLocked) {
        setEditorMessage({
          tone: 'warning',
          text: 'Editing is locked while a simulation is active.',
        });
        return;
      }
      const kind = event.dataTransfer.getData(STEP_KIND_DRAG_TYPE);
      if (!flowInstance || !isStepKind(kind)) {
        setEditorMessage({
          tone: 'error',
          text: 'Drop a process step from the palette onto the canvas.',
        });
        return;
      }

      addStepAt(
        kind,
        flowInstance.screenToFlowPosition({
          x: event.clientX,
          y: event.clientY,
        }),
      );
    },
    [addStepAt, editorLocked, flowInstance],
  );

  const deleteSelection = useCallback(() => {
    if (editorLocked) return;
    const selectedNodeIds = new Set(
      nodes.filter((node) => node.selected).map((node) => node.id),
    );
    const selectedEdgeIds = new Set(
      edges.filter((edge) => edge.selected).map((edge) => edge.id),
    );

    if (selectedNodeIds.size === 0 && selectedEdgeIds.size === 0) {
      setEditorMessage({
        tone: 'info',
        text: 'Select a step or connection before deleting.',
      });
      return;
    }

    setNodes((currentNodes) =>
      currentNodes.filter((node) => !selectedNodeIds.has(node.id)),
    );
    setEdges((currentEdges) =>
      currentEdges.filter(
        (edge) =>
          !selectedEdgeIds.has(edge.id)
          && !selectedNodeIds.has(edge.source)
          && !selectedNodeIds.has(edge.target),
      ),
    );
    setEditorMessage({
      tone: 'info',
      text: `${selectedCount} selected ${selectedCount === 1 ? 'item' : 'items'} removed.`,
    });
  }, [edges, editorLocked, nodes, selectedCount]);

  const deleteEdge = useCallback(
    (event: ReactMouseEvent, edge: ProcessFlowEdge) => {
      event.preventDefault();
      if (editorLocked) return;
      setEdges((currentEdges) =>
        currentEdges.filter((candidate) => candidate.id !== edge.id),
      );
      setEditorMessage({ tone: 'info', text: 'Connection removed.' });
    },
    [editorLocked],
  );

  const fitCanvas = useCallback(() => {
    void flowInstance?.fitView({ padding: 0.24, duration: 250 });
  }, [flowInstance]);

  const resetView = useCallback(() => {
    void flowInstance?.setViewport(
      { x: 0, y: 0, zoom: 1 },
      { duration: 250 },
    );
  }, [flowInstance]);

  const loadSample = useCallback(() => {
    if (editorLocked) return;
    const sample = createSampleGraph();
    setNodes(sample.nodes);
    setEdges(sample.edges);
    recipeId.current = crypto.randomUUID();
    setEditorMessage({
      tone: 'success',
      text: 'Three-step photolithography sample loaded.',
    });
    requestAnimationFrame(() => {
      void flowInstance?.fitView({ padding: 0.24, duration: 300 });
    });
  }, [editorLocked, flowInstance]);

  const clearCanvas = useCallback(() => {
    if (editorLocked) return;
    setNodes([]);
    setEdges([]);
    recipeId.current = crypto.randomUUID();
    setEditorMessage({ tone: 'info', text: 'Canvas cleared.' });
  }, [editorLocked]);

  const runSimulation = useCallback(() => {
    const issue = getEditorIssues(nodes, edges)[0];
    if (issue) {
      setEditorMessage({ tone: 'error', text: issue.message });
      return;
    }

    try {
      const recipeNodes = buildExecutionSequence(nodes, edges);
      if (recipeNodes.length !== nodes.length) {
        throw new Error(
          'Connect every step into one executable path before running.',
        );
      }

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
        simulation: { time_scale: 10, fault: faultInjection },
      });
      setEditorMessage({
        tone: 'success',
        text: 'Recipe submitted to the simulator.',
      });
    } catch (error: unknown) {
      setEditorMessage({
        tone: 'error',
        text:
          error instanceof Error
            ? error.message
            : 'Unable to run the recipe.',
      });
    }
  }, [edges, faultInjection, nodes, sendMessage]);

  const cancelSimulation = useCallback(() => {
    if (!currentRunId) return;
    try {
      sendMessage({
        schema_version: PROTOCOL_VERSION,
        type: 'cancel_run',
        request_id: crypto.randomUUID(),
        run_id: currentRunId,
      });
      setEditorMessage({
        tone: 'warning',
        text: 'Stopping the active simulation safely…',
      });
    } catch (error: unknown) {
      setEditorMessage({
        tone: 'error',
        text: error instanceof Error ? error.message : 'Unable to cancel the run.',
      });
    }
  }, [currentRunId, sendMessage]);

  const displayedIssue = editorIssues.find((issue) => issue.id !== 'empty-recipe');
  const lifecycleMessage: EditorMessage | null =
    runState === 'validating'
      ? { tone: 'info', text: 'Validating recipe with the Rust simulator…' }
      : runState === 'running'
        ? {
            tone: 'info',
            text: activeStepId
              ? `Simulation running · ${nodes.find((node) => node.id === activeStepId)?.data.label ?? activeStepId}`
              : 'Simulation running · waiting for the next process step',
          }
        : runState === 'completed'
          ? { tone: 'success', text: 'Run completed successfully.' }
          : runState === 'cancelled'
            ? { tone: 'warning', text: 'Run cancelled. The recipe is ready to edit or run again.' }
            : runState === 'failed'
              ? { tone: 'error', text: lastError ?? 'The run failed.' }
              : null;
  const canvasMessage = lifecycleMessage ?? editorMessage
    ?? (displayedIssue
      ? { tone: 'error' as const, text: displayedIssue.message }
      : nodes.length > 0
        ? { tone: 'success' as const, text: 'Recipe inputs are within simulator limits.' }
        : null);
  const canRun =
    connectionState === 'connected'
    && !editorLocked
    && editorIssues.length === 0;

  return (
    <main className="app-shell">
      <header className="app-header">
        <div className="app-title">
          <div className="app-mark" aria-hidden="true">
            <span />
            <span />
            <span />
          </div>
          <div>
            <h1>Fab Process Sequencer</h1>
            <p>Build and simulate semiconductor process recipes</p>
          </div>
        </div>
        <div className="header-actions">
          <span className={`run-state-badge run-state-badge--${runState}`}>
            Run {runState}
          </span>
          <span className={`connection-badge connection-badge--${connectionState}`}>
            <span aria-hidden="true" />
            Simulator {connectionState}
          </span>
          {runState === 'running' ? (
            <button
              type="button"
              className="button button--cancel"
              onClick={cancelSimulation}
              disabled={!currentRunId}
            >
              <span aria-hidden="true">■</span>
              Cancel run
            </button>
          ) : (
            <button
              type="button"
              className="button button--primary"
              onClick={runSimulation}
              disabled={!canRun}
              title={
                connectionState !== 'connected'
                  ? 'Connect the simulator backend to run'
                  : editorIssues[0]?.message
              }
            >
              <span aria-hidden="true">
                {runState === 'validating' ? '⋯' : '▶'}
              </span>
              {runState === 'validating' ? 'Validating' : 'Run simulation'}
            </button>
          )}
        </div>
      </header>

      <div className="workspace">
        <aside className="palette" aria-label="Process step palette">
          <div className="panel-heading">
            <span>Process steps</span>
            <small>{nodes.length}/{MAX_RECIPE_NODES}</small>
          </div>
          <p className="palette__hint">
            Drag a step onto the canvas, or click to place it automatically.
          </p>

          <div className="palette__items">
            {STEP_TEMPLATES.map((template) => (
              <button
                key={template.kind}
                type="button"
                className="palette-card"
                draggable={!editorLocked}
                disabled={editorLocked}
                onDragStart={(event) =>
                  onPaletteDragStart(event, template.kind)}
                onClick={() => addStepToCanvas(template.kind)}
                style={{ '--step-accent': template.accent } as React.CSSProperties}
              >
                <span className="palette-card__grip" aria-hidden="true">⠿</span>
                <span className="palette-card__icon" aria-hidden="true" />
                <span>
                  <strong>{template.label}</strong>
                  <small>{template.description}</small>
                </span>
              </button>
            ))}
          </div>

          <label className="fault-control">
            <span>
              Failure demo
              <small>Simulation only</small>
            </span>
            <select
              value={faultInjection ?? 'none'}
              onChange={(event) => {
                const value = event.target.value;
                setFaultInjection(
                  value === 'tool_fault' || value === 'sensor_out_of_range'
                    ? value
                    : null,
                );
              }}
              disabled={editorLocked}
            >
              <option value="none">No injected fault</option>
              <option value="tool_fault">Tool interlock trip</option>
              <option value="sensor_out_of_range">Sensor out of range</option>
            </select>
          </label>

          <div className="palette__footer">
            <button
              type="button"
              className="button"
              onClick={loadSample}
              disabled={editorLocked}
            >
              Load sample
            </button>
            <button
              type="button"
              className="button button--danger-quiet"
              onClick={clearCanvas}
              disabled={editorLocked || (nodes.length === 0 && edges.length === 0)}
            >
              Clear canvas
            </button>
          </div>
        </aside>

        <section
          ref={flowContainerRef}
          className="flow-stage"
          aria-label="Recipe canvas"
          onDragOver={onDragOver}
          onDrop={onDrop}
        >
          <ReactFlow
            nodes={renderedNodes}
            edges={edges}
            nodeTypes={NODE_TYPES}
            nodeOrigin={NODE_ORIGIN}
            defaultEdgeOptions={DEFAULT_EDGE_OPTIONS}
            onInit={setFlowInstance}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onEdgeDoubleClick={deleteEdge}
            deleteKeyCode={editorLocked ? null : ['Backspace', 'Delete']}
            nodesDraggable={!editorLocked}
            nodesConnectable={!editorLocked}
            edgesUpdatable={!editorLocked}
            fitView
            fitViewOptions={{ padding: 0.24 }}
            minZoom={0.35}
            maxZoom={1.8}
          >
            <Background color="#263143" gap={22} size={1.4} />
            <Controls position="bottom-left" showInteractive={false} />
          </ReactFlow>

          <div className="canvas-toolbar" aria-label="Canvas controls">
            <span>{nodes.length} steps · {edges.length} connections</span>
            <div>
              <button type="button" onClick={resetView}>Reset view</button>
              <button type="button" onClick={fitCanvas} disabled={nodes.length === 0}>
                Fit view
              </button>
              <button
                type="button"
                onClick={deleteSelection}
                disabled={editorLocked || selectedCount === 0}
                title="Delete selected items (Delete or Backspace)"
              >
                Delete selected{selectedCount > 0 ? ` (${selectedCount})` : ''}
              </button>
            </div>
          </div>

          {nodes.length === 0 && (
            <div className="empty-state">
              <div className="empty-state__diagram" aria-hidden="true">
                <span />
                <i />
                <span />
              </div>
              <h2>Build your first process recipe</h2>
              <p>Drag steps from the palette, then connect their handles.</p>
              <button type="button" className="button" onClick={loadSample}>
                Or load the sample recipe
              </button>
            </div>
          )}

          {canvasMessage && (
            <div
              className={`canvas-message canvas-message--${canvasMessage.tone}`}
              role={canvasMessage.tone === 'error' ? 'alert' : 'status'}
            >
              <span aria-hidden="true">
                {canvasMessage.tone === 'error' ? '!' : '✓'}
              </span>
              {canvasMessage.text}
            </div>
          )}
        </section>

        <aside className="telemetry" aria-label="Live simulator telemetry">
          <div className="panel-heading telemetry__heading">
            <div>
              <span>Live telemetry</span>
              <small>Selected or active process step</small>
            </div>
            <span className={`run-state-dot run-state-dot--${runState}`} />
          </div>

          <div className="telemetry__plot-wrap">
            <TelemetryPlot
              series={selectedTelemetrySeries}
              stepLabel={plotStepLabel}
            />
          </div>

          <div className="event-log__heading">
            <div>
              <strong>Event log</strong>
              <span>{logs.length} events</span>
            </div>
            <button type="button" onClick={clearLogs} disabled={logs.length === 0}>
              Clear
            </button>
          </div>

          <div
            ref={telemetryStreamRef}
            className="telemetry__stream"
            aria-live="polite"
          >
            {logs.length === 0 ? (
              <div className="event-log__empty">No simulator events yet.</div>
            ) : logs.map((log) => (
              <div
                key={log.id}
                className={`telemetry__line telemetry__line--${log.tone}`}
              >
                <time dateTime={new Date(log.timestampMs).toISOString()}>
                  {new Date(log.timestampMs).toLocaleTimeString([], {
                    hour: '2-digit',
                    minute: '2-digit',
                    second: '2-digit',
                    hour12: false,
                  })}
                </time>
                <span>{log.message}</span>
              </div>
            ))}
          </div>

          <footer className="telemetry__footer">
            <div>
              <span className={`connection-dot connection-dot--${connectionState}`} />
              {connectionState === 'connected'
                ? 'Listening for simulator events'
                : retryInMs
                  ? `Retrying in ${(retryInMs / 1_000).toFixed(1)}s`
                  : `Simulator ${connectionState}`}
            </div>
            {connectionState !== 'connected' && (
              <button type="button" onClick={retry}>Retry now</button>
            )}
          </footer>
        </aside>
      </div>
    </main>
  );
}

export default App;
