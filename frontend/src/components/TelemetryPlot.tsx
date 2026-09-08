import type { TelemetrySeries } from '../types/protocol';

type TelemetryPlotProps = {
  series?: TelemetrySeries;
  stepLabel?: string;
};

function formatValue(value: number): string {
  if (Math.abs(value) >= 1_000) return Math.round(value).toLocaleString();
  if (Math.abs(value) >= 100) return value.toFixed(1);
  return value.toFixed(2);
}

export default function TelemetryPlot({
  series,
  stepLabel,
}: TelemetryPlotProps) {
  if (!series || series.samples.length === 0) {
    return (
      <div className="telemetry-plot telemetry-plot--empty">
        <div aria-hidden="true">⌁</div>
        <p>
          {stepLabel
            ? `Waiting for ${stepLabel} telemetry.`
            : 'Select or run a step to inspect its telemetry.'}
        </p>
      </div>
    );
  }

  const values = series.samples.map((sample) => sample.value);
  const minimum = Math.min(...values);
  const maximum = Math.max(...values);
  const latest = values.at(-1)!;
  const range = maximum - minimum;
  const points = values
    .map((value, index) => {
      const x = values.length === 1
        ? 120
        : 8 + (index / (values.length - 1)) * 224;
      const y = range === 0 ? 48 : 82 - ((value - minimum) / range) * 66;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');

  return (
    <figure className="telemetry-plot">
      <figcaption>
        <div>
          <strong>{series.label}</strong>
          <span>{stepLabel ?? series.stepId}</span>
        </div>
        <div className="telemetry-plot__latest">
          <strong>{formatValue(latest)}</strong>
          <span>{series.unit}</span>
        </div>
      </figcaption>
      <svg
        viewBox="0 0 240 96"
        role="img"
        aria-label={`${series.label} plot for ${stepLabel ?? series.stepId}, latest value ${formatValue(latest)} ${series.unit}`}
      >
        <line x1="8" y1="82" x2="232" y2="82" />
        <line x1="8" y1="15" x2="232" y2="15" />
        <polyline points={points} />
        {values.length === 1 && <circle cx="120" cy="48" r="3" />}
      </svg>
      <div className="telemetry-plot__range">
        <span>Min {formatValue(minimum)} {series.unit}</span>
        <span>{series.samples.length} samples</span>
        <span>Max {formatValue(maximum)} {series.unit}</span>
      </div>
    </figure>
  );
}
