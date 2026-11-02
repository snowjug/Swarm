import { Segmented } from '../../design/ui';

/** Whether the colours show where each actor finished, or how far it moved to get there. */
export function SegmentedColour({
  value,
  onChange,
}: {
  value: 'end' | 'movement';
  onChange: (value: 'end' | 'movement') => void;
}) {
  return (
    <Segmented<'end' | 'movement'>
      size="sm"
      label="Colour by"
      value={value}
      onChange={onChange}
      options={[
        { value: 'end', label: 'Where it ended' },
        { value: 'movement', label: 'How far it moved' },
      ]}
    />
  );
}
