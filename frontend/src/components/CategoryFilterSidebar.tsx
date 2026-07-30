import { useState } from "react";
import { useMediaQuery } from "../hooks/useMediaQuery";

interface CategoryFilterSidebarProps {
  categories: string[];
  selectedCategories: string[];
  onToggle: (category: string) => void;
  onClear: () => void;
}

function CategoryItem({
  category,
  checked,
  onChange,
}: {
  category: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="category-filter-item">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="category-checkbox"
      />
      <span className="category-label">{category}</span>
    </label>
  );
}

export function CategoryFilterSidebar({
  categories,
  selectedCategories,
  onToggle,
  onClear,
}: CategoryFilterSidebarProps) {
  const isMobile = useMediaQuery("(max-width: 767px)");
  const [isOpen, setIsOpen] = useState(!isMobile);

  const sidebarClass = isMobile
    ? `category-sidebar${isOpen ? " category-sidebar--open" : ""}`
    : "category-sidebar";

  return (
    <aside className={sidebarClass} aria-label="Category filters">
      <div className="category-sidebar-header">
        <h3 className="category-sidebar-title">Categories</h3>
        {isMobile && (
          <button
            type="button"
            className="category-toggle-btn"
            onClick={() => setIsOpen((prev) => !prev)}
            aria-expanded={isOpen}
            aria-controls="category-filter-list"
          >
            {isOpen ? "Collapse" : "Expand"}
          </button>
        )}
      </div>

      <div id="category-filter-list" className="category-filter-list">
        {categories.length === 0 ? (
          <p className="muted category-empty">No categories available</p>
        ) : (
          categories.map((category) => (
            <CategoryItem
              key={category}
              category={category}
              checked={selectedCategories.includes(category)}
              onChange={onToggle}
            />
          ))
        )}
        {selectedCategories.length > 0 && (
          <button
            type="button"
            className="btn-ghost category-clear-btn"
            onClick={onClear}
          >
            Clear all
          </button>
        )}
      </div>
    </aside>
  );
}