import { useCallback } from 'react';
import { Handle, Position } from 'reactflow';

export default function ProcessNode({ data, id }) {
  const onChange = useCallback((evt) => {
    const { name, value } = evt.target;
    data.updateNodeData(id, name, Number(value));
  }, [data, id]);

  return (
    <div style={{ background: '#222', border: '1px solid #555', borderRadius: '8px', padding: '10px', color: '#fff', minWidth: '150px' }}>
      <Handle type="target" position={Position.Top} style={{ background: '#555' }} />
      
      <div style={{ fontWeight: 'bold', marginBottom: '8px', borderBottom: '1px solid #444', paddingBottom: '4px' }}>
        {data.label}
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '5px', fontSize: '12px' }}>
        <label style={{ display: 'flex', justifyContent: 'space-between' }}>
          Duration (s):
          <input 
            name="duration_sec" 
            type="number" 
            defaultValue={data.duration_sec} 
            onChange={onChange}
            style={{ width: '50px', background: '#333', color: '#fff', border: '1px solid #555' }} 
          />
        </label>
        
        <label style={{ display: 'flex', justifyContent: 'space-between' }}>
          Target Value:
          <input 
            name="target_value" 
            type="number" 
            defaultValue={data.target_value} 
            onChange={onChange}
            style={{ width: '50px', background: '#333', color: '#fff', border: '1px solid #555' }} 
          />
        </label>
      </div>

      <Handle type="source" position={Position.Bottom} style={{ background: '#555' }} />
    </div>
  );
}