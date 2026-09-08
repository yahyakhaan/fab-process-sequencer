import type { Recipe, StepKind } from './recipe';

export type SimulationConfig = {
  time_scale: number;
  fault: null;
};

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
  | { schema_version: 1; type: 'pong'; request_id: string };

export type ConnectionState =
  | 'connecting'
  | 'connected'
  | 'disconnected'
  | 'error';
