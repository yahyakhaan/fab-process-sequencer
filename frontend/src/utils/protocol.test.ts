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
