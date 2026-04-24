import { X, Search } from "lucide-react";
import "./SearchInput.css";

interface SearchInputProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  ariaLabel?: string;
}

/**
 * SearchInput component with clear button
 *
 * Features:
 * - Clear button (X icon) to reset search
 * - Search icon placeholder
 * - Accessible with proper ARIA labels
 * - Styled to match the design system
 *
 * @param value - Current search value
 * @param onChange - Callback when search value changes
 * @param placeholder - Placeholder text
 * @param disabled - Whether the input is disabled
 * @param ariaLabel - ARIA label for accessibility
 */
export function SearchInput({
  value,
  onChange,
  placeholder = "Search campaigns...",
  disabled = false,
  ariaLabel = "Search campaigns by title, creator, or ID",
}: SearchInputProps) {
  const handleClear = () => {
    onChange("");
  };

  return (
    <div className="search-input-wrapper">
      <Search className="search-input-icon" size={20} aria-hidden="true" />
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        disabled={disabled}
        aria-label={ariaLabel}
        className="search-input search-input-field"
      />
      {value && (
        <button
          type="button"
          onClick={handleClear}
          className="search-clear-button"
          aria-label="Clear search"
          title="Clear search"
        >
          <X size={18} aria-hidden="true" />
        </button>
      )}
    </div>
  );
}
