import type {
  EditableStepField,
  StepConfig,
  ValidationIssue,
} from '../types/recipe';
import type { ServerMessage, Telemetry } from '../types/protocol';

type ParameterSpec = {
  field: Exclude<EditableStepField, 'duration_sec'>;
  label: string;
  unit: string;
  min: number;
  max: number;
  step: number;
};

export const DURATION_SPEC = {
  field: 'duration_sec' as const,
  label: 'Duration',
  unit: 's',
  min: 1,
  max: 3_600,
  step: 1,
};

export function getParameterSpec(step: StepConfig): ParameterSpec {
  switch (step.kind) {
    case 'spin_coat':
      return {
        field: 'rpm',
        label: 'Speed',
        unit: 'RPM',
        min: 100,
        max: 20_000,
        step: 100,
      };
    case 'bake':
      return {
        field: 'temperature_c',
        label: 'Temperature',
        unit: '°C',
        min: 20,
        max: 450,
        step: 1,
      };
    case 'expose':
      return {
        field: 'intensity_mw_cm2',
        label: 'Intensity',
        unit: 'mW/cm²',
        min: 0.01,
        max: 1_000,
        step: 0.01,
      };
  }
}

export function getParameterValue(step: StepConfig): number {
  switch (step.kind) {
    case 'spin_coat':
      return step.rpm;
    case 'bake':
      return step.temperature_c;
    case 'expose':
      return step.intensity_mw_cm2;
  }
}

export function updateStepField(
  step: StepConfig,
  field: EditableStepField,
  value: number,
): StepConfig {
  if (field === 'duration_sec') {
    return { ...step, duration_sec: value };
  }

  switch (step.kind) {
    case 'spin_coat':
      return field === 'rpm' ? { ...step, rpm: value } : step;
    case 'bake':
      return field === 'temperature_c'
        ? { ...step, temperature_c: value }
        : step;
    case 'expose':
      return field === 'intensity_mw_cm2'
        ? { ...step, intensity_mw_cm2: value }
        : step;
  }
}

export function validateStep(step: StepConfig): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const parameter = getParameterSpec(step);
  const parameterValue = getParameterValue(step);

  if (
    !Number.isInteger(step.duration_sec)
    || step.duration_sec < DURATION_SPEC.min
    || step.duration_sec > DURATION_SPEC.max
  ) {
    issues.push({
      field: 'duration_sec',
      message: `Duration must be an integer from ${DURATION_SPEC.min} to ${DURATION_SPEC.max} seconds.`,
    });
  }

  if (
    !Number.isFinite(parameterValue)
    || parameterValue < parameter.min
    || parameterValue > parameter.max
  ) {
    issues.push({
      field: parameter.field,
      message: `${parameter.label} must be from ${parameter.min} to ${parameter.max} ${parameter.unit}.`,
    });
  }

  return issues;
}

export function formatTelemetry(telemetry: Telemetry): string {
  switch (telemetry.kind) {
    case 'spin_coat':
      return `${Math.round(telemetry.rpm).toLocaleString()} RPM`;
    case 'bake':
      return `${telemetry.temperature_c.toFixed(1)} °C`;
    case 'expose':
      return `${telemetry.intensity_mw_cm2.toFixed(2)} mW/cm²`;
  }
}

export function formatServerMessage(message: ServerMessage): string | null {
  switch (message.type) {
    case 'connection_ready':
      return '> Connected to Rust Fab Backend';
    case 'run_accepted':
      return `> Run ${message.run_id} accepted`;
    case 'run_rejected':
      return `> ERROR [${message.code}] ${message.message}`;
    case 'step_started':
      return `> [${message.step_id}] ${message.step_kind.toUpperCase()} started`;
    case 'step_progress':
      return `> [${message.step_id}] ${formatTelemetry(message.telemetry)} | ${message.progress_sec}/${message.duration_sec} simulated s`;
    case 'step_completed':
      return `> [${message.step_id}] completed at ${formatTelemetry(message.telemetry)}`;
    case 'run_completed':
      return `> Run ${message.run_id} complete`;
    case 'pong':
      return null;
  }
}
