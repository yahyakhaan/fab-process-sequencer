import type { Recipe, StepKind } from './recipe';

export type SimulationConfig = {
  time_scale: number;
  fault: FaultInjection;
};

export type FaultInjection =
  | null
  | 'tool_fault'
  | 'sensor_out_of_range';

export type ClientMessage =
  | {
      schema_version: 1;
      type: 'run_recipe';
      request_id: string;
      recipe: Recipe;
      simulation: SimulationConfig;
    }
  | {
      schema_version: 1;
      type: 'cancel_run';
      request_id: string;
      run_id: string;
    }
  | {
      schema_version: 1;
      type: 'ping';
      request_id: string;
    };

export type Telemetry =
  | { kind: 'spin_coat'; rpm: number }
  | { kind: 'bake'; temperature_c: number }
  | { kind: 'expose'; intensity_mw_cm2: number };

type RunEvent = {
  schema_version: 1;
  run_id: string;
  timestamp_ms: number;
  simulated_time_ms: number;
};

type StepEvent = RunEvent & {
  step_id: string;
};

export type ServerMessage =
  | { schema_version: 1; type: 'connection_ready' }
  | (RunEvent & {
      type: 'run_accepted';
      request_id: string;
    })
  | {
      schema_version: 1;
      type: 'run_rejected';
      request_id: string | null;
      code: string;
      message: string;
      timestamp_ms: number;
    }
  | (StepEvent & {
      type: 'step_started';
      step_kind: StepKind;
    })
  | (StepEvent & {
      type: 'step_progress';
      progress_sec: number;
      duration_sec: number;
      telemetry: Telemetry;
    })
  | (StepEvent & {
      type: 'step_completed';
      telemetry: Telemetry;
    })
  | (RunEvent & { type: 'run_completed' })
  | (RunEvent & {
      type: 'run_cancelled';
      step_id: string | null;
    })
  | (RunEvent & {
      type: 'run_failed';
      step_id: string | null;
      code: string;
      message: string;
    })
  | { schema_version: 1; type: 'pong'; request_id: string };

export type ConnectionState =
  | 'connecting'
  | 'connected'
  | 'disconnected'
  | 'error';

export type RunState =
  | 'idle'
  | 'validating'
  | 'running'
  | 'completed'
  | 'failed'
  | 'cancelled';

export type TelemetrySeries = {
  stepId: string;
  kind: Telemetry['kind'];
  label: string;
  unit: string;
  samples: Array<{
    simulatedTimeMs: number;
    value: number;
  }>;
};
