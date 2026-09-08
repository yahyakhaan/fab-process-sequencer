import assert from 'node:assert/strict';
import test from 'node:test';

import { parseServerMessage } from './protocol.ts';

test('parses a typed step progress message', () => {
  const message = parseServerMessage(JSON.stringify({
    schema_version: 1,
    type: 'step_progress',
    run_id: 'run-1',
    step_id: 'step-1',
    progress_sec: 5,
    duration_sec: 10,
    telemetry: { kind: 'spin_coat', rpm: 3_000 },
    timestamp_ms: 100,
    simulated_time_ms: 5_000,
  }));

  assert.equal(message.type, 'step_progress');
  if (message.type === 'step_progress') {
    assert.deepEqual(message.telemetry, { kind: 'spin_coat', rpm: 3_000 });
  }
});

test('rejects an unsupported protocol version', () => {
  assert.throws(
    () => parseServerMessage('{"schema_version":2,"type":"connection_ready"}'),
    /invalid or unsupported/,
  );
});

test('rejects a telemetry payload with the wrong metric', () => {
  assert.throws(
    () => parseServerMessage(JSON.stringify({
      schema_version: 1,
      type: 'step_progress',
      run_id: 'run-1',
      step_id: 'step-1',
      progress_sec: 5,
      duration_sec: 10,
      telemetry: { kind: 'bake', rpm: 3_000 },
      timestamp_ms: 100,
      simulated_time_ms: 5_000,
    })),
    /malformed step_progress/,
  );
});

test('parses cancelled and failed terminal run events', () => {
  const cancelled = parseServerMessage(JSON.stringify({
    schema_version: 1,
    type: 'run_cancelled',
    run_id: 'run-1',
    step_id: 'step-1',
    timestamp_ms: 100,
    simulated_time_ms: 5_000,
  }));
  const failed = parseServerMessage(JSON.stringify({
    schema_version: 1,
    type: 'run_failed',
    run_id: 'run-2',
    step_id: 'step-2',
    code: 'tool_fault',
    message: 'Simulated interlock trip',
    timestamp_ms: 200,
    simulated_time_ms: 8_000,
  }));

  assert.equal(cancelled.type, 'run_cancelled');
  assert.equal(failed.type, 'run_failed');
});

test('parses every server event variant used by the run lifecycle', () => {
  const messages = [
    { schema_version: 1, type: 'connection_ready' },
    {
      schema_version: 1,
      type: 'run_accepted',
      request_id: 'request-1',
      run_id: 'run-1',
      timestamp_ms: 10,
      simulated_time_ms: 0,
    },
    {
      schema_version: 1,
      type: 'run_rejected',
      request_id: null,
      code: 'invalid_recipe',
      message: 'Recipe is invalid',
      timestamp_ms: 10,
    },
    {
      schema_version: 1,
      type: 'step_started',
      run_id: 'run-1',
      step_id: 'step-1',
      step_kind: 'bake',
      timestamp_ms: 20,
      simulated_time_ms: 0,
    },
    {
      schema_version: 1,
      type: 'step_completed',
      run_id: 'run-1',
      step_id: 'step-1',
      telemetry: { kind: 'bake', temperature_c: 20 },
      timestamp_ms: 30,
      simulated_time_ms: 10_000,
    },
    {
      schema_version: 1,
      type: 'run_completed',
      run_id: 'run-1',
      timestamp_ms: 40,
      simulated_time_ms: 10_000,
    },
    { schema_version: 1, type: 'pong', request_id: 'heartbeat-1' },
  ];

  assert.deepEqual(
    messages.map((message) => parseServerMessage(JSON.stringify(message)).type),
    messages.map((message) => message.type),
  );
});

test('rejects unsafe timing fields and impossible progress', () => {
  const baseProgress = {
    schema_version: 1,
    type: 'step_progress',
    run_id: 'run-1',
    step_id: 'step-1',
    progress_sec: 5,
    duration_sec: 10,
    telemetry: { kind: 'spin_coat', rpm: 3_000 },
    timestamp_ms: 100,
    simulated_time_ms: 5_000,
  };

  assert.throws(
    () => parseServerMessage(JSON.stringify({ ...baseProgress, progress_sec: 11 })),
    /malformed step_progress/,
  );
  assert.throws(
    () => parseServerMessage(JSON.stringify({ ...baseProgress, timestamp_ms: -1 })),
    /malformed step_progress/,
  );
  assert.throws(
    () => parseServerMessage(JSON.stringify({ ...baseProgress, duration_sec: 1.5 })),
    /malformed step_progress/,
  );
});
