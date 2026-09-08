import type { Telemetry, TelemetrySeries } from '../types/protocol';

export function describeTelemetry(telemetry: Telemetry): {
  kind: Telemetry['kind'];
  label: string;
  unit: string;
  value: number;
} {
  switch (telemetry.kind) {
    case 'spin_coat':
      return { kind: telemetry.kind, label: 'Spin speed', unit: 'RPM', value: telemetry.rpm };
    case 'bake':
      return {
        kind: telemetry.kind,
        label: 'Temperature',
        unit: '°C',
        value: telemetry.temperature_c,
      };
    case 'expose':
      return {
        kind: telemetry.kind,
        label: 'UV intensity',
        unit: 'mW/cm²',
        value: telemetry.intensity_mw_cm2,
      };
  }
}

export function appendTelemetrySample(
  existing: TelemetrySeries | undefined,
  stepId: string,
  telemetry: Telemetry,
  simulatedTimeMs: number,
  maxSamples = 120,
): TelemetrySeries {
  const descriptor = describeTelemetry(telemetry);
  if (existing && existing.kind !== descriptor.kind) {
    throw new Error(
      `Telemetry metric changed from ${existing.kind} to ${descriptor.kind} for ${stepId}.`,
    );
  }

  return {
    stepId,
    kind: descriptor.kind,
    label: descriptor.label,
    unit: descriptor.unit,
    samples: [
      ...(existing?.samples ?? []),
      { simulatedTimeMs, value: descriptor.value },
    ].slice(-maxSamples),
  };
}
