export type SortOption = 'createdAt' | 'deadline' | 'pledgedAmount' | 'targetAmount';

export interface SortDropdownProps {
  value: SortOption;
  onChange: (value: SortOption) => void;
  disabled?: boolean;
}

export function SortDropdown({ value, onChange, disabled = false }: SortDropdownProps) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value as SortOption)}
      disabled={disabled}
      aria-label="Sort campaigns"
      className="control-select"
      style={{ cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? 0.55 : 1 }}
    >
      <option value="createdAt">Created At</option>
      <option value="deadline">Deadline</option>
      <option value="pledgedAmount">Pledged Amount</option>
      <option value="targetAmount">Target Amount</option>
    </select>
  );
}
