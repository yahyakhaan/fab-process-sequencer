import assert from 'node:assert/strict';
import test from 'node:test';

import type { StepConfig } from '../types/recipe.ts';
import {
  formatTelemetry,
  getParameterSpec,
  updateStepField,
  validateStep,
} from './stepConfig.ts';

test('exposes a typed parameter definition for each step kind', () => {
  const spin: StepConfig = { kind: 'spin_coat', rpm: 3_000, duration_sec: 45 };
  const bake: StepConfig = { kind: 'bake', temperature_c: 120, duration_sec: 60 };
  const expose: StepConfig = {
    kind: 'expose',
    intensity_mw_cm2: 15,
    duration_sec: 15,
  };

  assert.equal(getParameterSpec(spin).unit, 'RPM');
  assert.equal(getParameterSpec(bake).unit, '°C');
  assert.equal(getParameterSpec(expose).unit, 'mW/cm²');
});

test('updates only fields supported by the discriminated step type', () => {
  const step: StepConfig = { kind: 'bake', temperature_c: 120, duration_sec: 60 };

  assert.deepEqual(updateStepField(step, 'temperature_c', 130), {
    kind: 'bake',
    temperature_c: 130,
    duration_sec: 60,
  });
  assert.equal(updateStepField(step, 'rpm', 3_000), step);
});

test('validates duration and type-specific parameter bounds', () => {
  const invalid: StepConfig = { kind: 'spin_coat', rpm: 25_000, duration_sec: 0 };

  assert.deepEqual(
    validateStep(invalid).map((issue) => issue.field),
    ['duration_sec', 'rpm'],
  );
});

test('formats telemetry with its physical unit', () => {
  assert.equal(formatTelemetry({ kind: 'spin_coat', rpm: 3_000 }), '3,000 RPM');
  assert.equal(formatTelemetry({ kind: 'bake', temperature_c: 119.75 }), '119.8 °C');
  assert.equal(
    formatTelemetry({ kind: 'expose', intensity_mw_cm2: 15 }),
    '15.00 mW/cm²',
  );
});
