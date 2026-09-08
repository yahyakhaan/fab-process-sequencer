import { PROTOCOL_VERSION } from '../types/recipe.ts';
import type { ServerMessage, Telemetry } from '../types/protocol';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isString(value: unknown): value is string {
  return typeof value === 'string';
}

function isNonEmptyString(value: unknown): value is string {
  return isString(value) && value.length > 0;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isNonNegativeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 0;
}

function isRunEvent(value: Record<string, unknown>): boolean {
  return isNonEmptyString(value.run_id)
    && isNonNegativeInteger(value.timestamp_ms)
    && isNonNegativeInteger(value.simulated_time_ms);
}

function parseTelemetry(value: unknown): Telemetry | null {
  if (!isRecord(value) || !isString(value.kind)) return null;

  if (value.kind === 'spin_coat' && isFiniteNumber(value.rpm) && value.rpm >= 0) {
    return { kind: value.kind, rpm: value.rpm };
  }
  if (
    value.kind === 'bake'
    && isFiniteNumber(value.temperature_c)
    && value.temperature_c >= 0
  ) {
    return { kind: value.kind, temperature_c: value.temperature_c };
  }
  if (
    value.kind === 'expose'
    && isFiniteNumber(value.intensity_mw_cm2)
    && value.intensity_mw_cm2 >= 0
  ) {
    return { kind: value.kind, intensity_mw_cm2: value.intensity_mw_cm2 };
  }

  return null;
}

export function parseServerMessage(raw: string): ServerMessage {
  const value: unknown = JSON.parse(raw);
  if (
    !isRecord(value)
    || value.schema_version !== PROTOCOL_VERSION
    || !isString(value.type)
  ) {
    throw new Error('Received an invalid or unsupported server message.');
  }

  switch (value.type) {
    case 'connection_ready':
      return { schema_version: PROTOCOL_VERSION, type: value.type };
    case 'run_accepted':
      if (isRunEvent(value) && isNonEmptyString(value.request_id)) {
        return value as ServerMessage;
      }
      break;
    case 'run_rejected':
      if (
        (value.request_id === null || isNonEmptyString(value.request_id))
        && isNonEmptyString(value.code)
        && isNonEmptyString(value.message)
        && isNonNegativeInteger(value.timestamp_ms)
      ) {
        return value as ServerMessage;
      }
      break;
    case 'step_started':
      if (
        isRunEvent(value)
        && isNonEmptyString(value.step_id)
        && ['spin_coat', 'bake', 'expose'].includes(String(value.step_kind))
      ) {
        return value as ServerMessage;
      }
      break;
    case 'step_progress': {
      const telemetry = parseTelemetry(value.telemetry);
      if (
        isRunEvent(value)
        && isNonEmptyString(value.step_id)
        && isNonNegativeInteger(value.progress_sec)
        && isNonNegativeInteger(value.duration_sec)
        && value.duration_sec > 0
        && value.progress_sec <= value.duration_sec
        && telemetry
      ) {
        return { ...value, telemetry } as ServerMessage;
      }
      break;
    }
    case 'step_completed': {
      const telemetry = parseTelemetry(value.telemetry);
      if (isRunEvent(value) && isNonEmptyString(value.step_id) && telemetry) {
        return { ...value, telemetry } as ServerMessage;
      }
      break;
    }
    case 'run_completed':
      if (isRunEvent(value)) return value as ServerMessage;
      break;
    case 'run_cancelled':
      if (
        isRunEvent(value)
        && (value.step_id === null || isNonEmptyString(value.step_id))
      ) {
        return value as ServerMessage;
      }
      break;
    case 'run_failed':
      if (
        isRunEvent(value)
        && (value.step_id === null || isNonEmptyString(value.step_id))
        && isNonEmptyString(value.code)
        && isNonEmptyString(value.message)
      ) {
        return value as ServerMessage;
      }
      break;
    case 'pong':
      if (isNonEmptyString(value.request_id)) return value as ServerMessage;
      break;
  }

  throw new Error(`Received a malformed ${value.type} message.`);
}

export function getFabWebSocketUrl(): string {
  const configuredUrl = import.meta.env.VITE_FAB_WS_URL;
  if (configuredUrl) return configuredUrl;

  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${window.location.host}/ws`;
}
