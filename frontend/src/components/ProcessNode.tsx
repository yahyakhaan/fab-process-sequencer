import { useCallback } from 'react';
import type { ChangeEvent } from 'react';
import { Handle, Position } from 'reactflow';
import type { NodeProps } from 'reactflow';

import type { EditableStepField, ProcessNodeData } from '../types/recipe';
import {
  DURATION_SPEC,
  getParameterSpec,
  getParameterValue,
  validateStep,
} from '../utils/stepConfig';

const STATUS_LABELS = {
  pending: 'Pending',
  active: 'Running',
  completed: 'Complete',
  cancelled: 'Cancelled',
  failed: 'Failed',
} as const;

export default function ProcessNode({
  data,
  id,
  selected,
}: NodeProps<ProcessNodeData>) {
  const onChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      if (data.isLocked) return;
      const field = event.target.name as EditableStepField;
      data.updateNodeData?.(id, field, Number(event.target.value));
    },
    [data, id],
  );

  const parameter = getParameterSpec(data.step);
  const issues = validateStep(data.step);
  const durationIssue = issues.find(
    (issue) => issue.field === DURATION_SPEC.field,
  );
  const parameterIssue = issues.find(
    (issue) => issue.field === parameter.field,
  );
  const durationErrorId = `${id}-duration-error`;
  const parameterErrorId = `${id}-${parameter.field}-error`;

  return (
    <article
      className={`process-node${data.isActive ? ' process-node--active' : ''}${selected ? ' process-node--selected' : ''}${data.runStatus ? ` process-node--${data.runStatus}` : ''}`}
      aria-label={`${data.label} process step`}
    >
      <Handle
        type="target"
        position={Position.Top}
        className="process-node__handle"
        isConnectable={!data.isLocked}
      />

      <header className="process-node__header">
        <div>
          <strong>{data.label}</strong>
          <span>{data.toolId}</span>
        </div>
        {data.runStatus && (
          <span className={`process-node__status process-node__status--${data.runStatus}`}>
            {STATUS_LABELS[data.runStatus]}
          </span>
        )}
        <button
          type="button"
          className="process-node__delete nodrag"
          onClick={() => data.deleteNode?.(id)}
          disabled={data.isLocked}
          aria-label={`Delete ${data.label}`}
          title="Delete step"
        >
          ×
        </button>
      </header>

      <div className="process-node__fields">
        <label htmlFor={`${id}-duration`}>
          <span>
            {DURATION_SPEC.label}
            <small>{DURATION_SPEC.unit}</small>
          </span>
          <input
            id={`${id}-duration`}
            className="nodrag nowheel"
            aria-invalid={Boolean(durationIssue)}
            aria-describedby={durationIssue ? durationErrorId : undefined}
            name={DURATION_SPEC.field}
            type="number"
            value={data.step.duration_sec}
            min={DURATION_SPEC.min}
            max={DURATION_SPEC.max}
            step={DURATION_SPEC.step}
            onChange={onChange}
            disabled={data.isLocked}
          />
        </label>
        {durationIssue && (
          <small id={durationErrorId} className="process-node__error" role="alert">
            {durationIssue.message}
          </small>
        )}

        <label htmlFor={`${id}-${parameter.field}`}>
          <span>
            {parameter.label}
            <small>{parameter.unit}</small>
          </span>
          <input
            id={`${id}-${parameter.field}`}
            className="nodrag nowheel"
            aria-invalid={Boolean(parameterIssue)}
            aria-describedby={parameterIssue ? parameterErrorId : undefined}
            name={parameter.field}
            type="number"
            value={getParameterValue(data.step)}
            min={parameter.min}
            max={parameter.max}
            step={parameter.step}
            onChange={onChange}
            disabled={data.isLocked}
          />
        </label>
        {parameterIssue && (
          <small id={parameterErrorId} className="process-node__error" role="alert">
            {parameterIssue.message}
          </small>
        )}
      </div>

      <Handle
        type="source"
        position={Position.Bottom}
        className="process-node__handle"
        isConnectable={!data.isLocked}
      />
    </article>
  );
}
