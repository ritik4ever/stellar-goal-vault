export type SortOption = "newest" | "deadline" | "percentFunded" | "totalPledged";

export interface SortDropdownProps {
  value: SortOption;
  onChange: (value: SortOption) => void;
  disabled?: boolean;
}

export function SortDropdown({
  value,
  onChange,
  disabled = false,
}: SortDropdownProps) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value as SortOption)}
      disabled={disabled}
      aria-label="Sort campaigns"
      className="control-select"
      style={{ cursor: disabled ? "not-allowed" : "pointer", opacity: disabled ? 0.55 : 1 }}
    >
      <option value="newest">Newest</option>
      <option value="deadline">Deadline</option>
      <option value="percentFunded">Percent Funded</option>
      <option value="totalPledged">Total Pledged</option>
    </select>
  );
}
