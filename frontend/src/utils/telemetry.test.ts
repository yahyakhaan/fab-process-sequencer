import assert from 'node:assert/strict';
import test from 'node:test';

import { appendTelemetrySample, describeTelemetry } from './telemetry.ts';

test('describes every telemetry metric with its physical unit', () => {
  assert.deepEqual(describeTelemetry({ kind: 'spin_coat', rpm: 3_000 }), {
    kind: 'spin_coat',
    label: 'Spin speed',
    unit: 'RPM',
    value: 3_000,
  });
  assert.equal(
    describeTelemetry({ kind: 'bake', temperature_c: 120 }).unit,
    '°C',
  );
  assert.equal(
    describeTelemetry({ kind: 'expose', intensity_mw_cm2: 15 }).unit,
    'mW/cm²',
  );
});

test('never mixes telemetry kinds in one plotted series', () => {
  const series = appendTelemetrySample(
    undefined,
    'step-1',
    { kind: 'spin_coat', rpm: 1_000 },
    1_000,
  );

  assert.throws(
    () => appendTelemetrySample(
      series,
      'step-1',
      { kind: 'bake', temperature_c: 100 },
      2_000,
    ),
    /metric changed/,
  );
});

test('bounds plotted telemetry samples', () => {
  let series = appendTelemetrySample(
    undefined,
    'step-1',
    { kind: 'spin_coat', rpm: 1_000 },
    1_000,
    2,
  );
  series = appendTelemetrySample(
    series,
    'step-1',
    { kind: 'spin_coat', rpm: 2_000 },
    2_000,
    2,
  );
  series = appendTelemetrySample(
    series,
    'step-1',
    { kind: 'spin_coat', rpm: 3_000 },
    3_000,
    2,
  );

  assert.deepEqual(series.samples.map((sample) => sample.value), [2_000, 3_000]);
});
