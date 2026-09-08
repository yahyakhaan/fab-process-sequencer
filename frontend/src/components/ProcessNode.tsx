import { useCallback } from 'react';
import type { ChangeEvent, CSSProperties } from 'react';
import { Handle, Position } from 'reactflow';
import type { NodeProps } from 'reactflow';

import type { EditableStepField, ProcessNodeData } from '../types/recipe';
import {
  DURATION_SPEC,
  getParameterSpec,
  getParameterValue,
  validateStep,
} from '../utils/stepConfig';

export default function ProcessNode({ data, id }: NodeProps<ProcessNodeData>) {
  const onChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      const field = event.target.name as EditableStepField;
      data.updateNodeData?.(id, field, Number(event.target.value));
    },
    [data, id],
  );

  const parameter = getParameterSpec(data.step);
  const issues = validateStep(data.step);
  const invalidFields = new Set(issues.map((issue) => issue.field));
  const inputStyle: CSSProperties = {
    width: '70px',
    background: '#333',
    color: '#fff',
    border: '1px solid #555',
  };
  const containerStyle: CSSProperties = {
    background: data.isActive ? '#1a3320' : '#222',
    border: data.isActive ? '2px solid #00ff00' : '1px solid #555',
    boxShadow: data.isActive ? '0 0 15px rgba(0, 255, 0, 0.4)' : 'none',
    transition: 'all 0.2s ease-in-out',
    borderRadius: '8px',
    padding: '10px',
    color: '#fff',
    minWidth: '190px',
  };

  return (
    <div style={containerStyle}>
      <Handle type="target" position={Position.Top} style={{ background: '#555' }} />

      <div style={{ fontWeight: 'bold', marginBottom: '8px', borderBottom: '1px solid #444', paddingBottom: '4px' }}>
        {data.label}
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '5px', fontSize: '12px' }}>
        <label style={{ display: 'flex', justifyContent: 'space-between', gap: '8px' }}>
          {DURATION_SPEC.label} ({DURATION_SPEC.unit}):
          <input
            aria-invalid={invalidFields.has('duration_sec')}
            name={DURATION_SPEC.field}
            type="number"
            value={data.step.duration_sec}
            min={DURATION_SPEC.min}
            max={DURATION_SPEC.max}
            step={DURATION_SPEC.step}
            onChange={onChange}
            style={inputStyle}
          />
        </label>

        <label style={{ display: 'flex', justifyContent: 'space-between', gap: '8px' }}>
          {parameter.label} ({parameter.unit}):
          <input
            aria-invalid={invalidFields.has(parameter.field)}
            name={parameter.field}
            type="number"
            value={getParameterValue(data.step)}
            min={parameter.min}
            max={parameter.max}
            step={parameter.step}
            onChange={onChange}
            style={inputStyle}
          />
        </label>
      </div>

      <Handle type="source" position={Position.Bottom} style={{ background: '#555' }} />
    </div>
  );
}
