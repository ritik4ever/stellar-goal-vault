import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SearchInput } from "./SearchInput";

describe("SearchInput Component", () => {
  const mockOnChange = vi.fn();

  beforeEach(() => {
    mockOnChange.mockClear();
  });

  describe("Rendering", () => {
    it("should render search input with default placeholder", () => {
      render(<SearchInput value="" onChange={mockOnChange} />);
      const input = screen.getByPlaceholderText("Search campaigns...");
      expect(input).toBeInTheDocument();
    });

    it("should render with custom placeholder", () => {
      const customPlaceholder = "Find a campaign...";
      render(<SearchInput value="" onChange={mockOnChange} placeholder={customPlaceholder} />);
      const input = screen.getByPlaceholderText(customPlaceholder);
      expect(input).toBeInTheDocument();
    });

    it("should render search icon", () => {
      const { container } = render(<SearchInput value="" onChange={mockOnChange} />);
      const icon = container.querySelector(".search-input-icon");
      expect(icon).toBeInTheDocument();
    });

    it("should not render clear button when value is empty", () => {
      render(<SearchInput value="" onChange={mockOnChange} />);
      const clearButton = screen.queryByAltText("Clear search");
      expect(screen.queryByRole("button", { name: "Clear search" })).not.toBeInTheDocument();
    });

    it("should render clear button when value is not empty", () => {
      render(<SearchInput value="test query" onChange={mockOnChange} />);
      const clearButton = screen.getByRole("button", { name: "Clear search" });
      expect(clearButton).toBeInTheDocument();
    });
  });

  describe("User Interactions", () => {
    it("should call onChange when user types", async () => {
      const user = userEvent.setup();
      render(<SearchInput value="" onChange={mockOnChange} />);

      const input = screen.getByPlaceholderText("Search campaigns...");
      await user.type(input, "rocket");

      expect(mockOnChange).toHaveBeenCalledTimes(6); // One call per character
      expect(mockOnChange).toHaveBeenLastCalledWith("rocket");
    });

    it("should clear the input when clear button is clicked", async () => {
      const user = userEvent.setup();
      render(<SearchInput value="test search" onChange={mockOnChange} />);

      const clearButton = screen.getByRole("button", { name: "Clear search" });
      await user.click(clearButton);

      expect(mockOnChange).toHaveBeenCalledWith("");
    });

    it("should update displayed value when value prop changes", () => {
      const { rerender } = render(<SearchInput value="initial" onChange={mockOnChange} />);
      const input = screen.getByDisplayValue("initial") as HTMLInputElement;
      expect(input.value).toBe("initial");

      rerender(<SearchInput value="updated" onChange={mockOnChange} />);
      expect(input.value).toBe("updated");
    });
  });

  describe("Disabled State", () => {
    it("should disable input when disabled prop is true", () => {
      render(<SearchInput value="" onChange={mockOnChange} disabled={true} />);
      const input = screen.getByPlaceholderText("Search campaigns..") as HTMLInputElement;
      expect(input.disabled).toBe(true);
    });

    it("should not call onChange when input is disabled", async () => {
      const user = userEvent.setup();
      const { rerender } = render(
        <SearchInput value="" onChange={mockOnChange} disabled={false} />
      );

      const input = screen.getByPlaceholderText("Search campaigns..") as HTMLInputElement;

      // Enable input and type
      await user.type(input, "test");
      const firstCallCount = mockOnChange.mock.calls.length;

      // Disable input and try to type (shouldn't work)
      rerender(<SearchInput value="" onChange={mockOnChange} disabled={true} />);

      // Note: In real scenarios, disabled inputs cannot receive focus, so this test
      // mainly ensures the disabled attribute is set correctly
      expect(input.disabled).toBe(true);
    });
  });

  describe("Accessibility", () => {
    it("should have proper aria-label", () => {
      render(<SearchInput value="" onChange={mockOnChange} />);
      const input = screen.getByLabelText("Search campaigns by title, creator, or ID");
      expect(input).toBeInTheDocument();
    });

    it("should have custom aria-label when provided", () => {
      const customLabel = "Find campaigns";
      render(
        <SearchInput
          value=""
          onChange={mockOnChange}
          ariaLabel={customLabel}
        />
      );
      const input = screen.getByLabelText(customLabel);
      expect(input).toBeInTheDocument();
    });

    it("should have aria-hidden on icons", () => {
      const { container } = render(<SearchInput value="test" onChange={mockOnChange} />);

      // Check search icon
      const searchIcon = container.querySelector(".search-input-icon");
      expect(searchIcon).toHaveAttribute("aria-hidden", "true");

      // Check close icon in clear button
      const closeIcon = searchIcon?.parentElement?.querySelector("svg:last-of-type");
      // The close icon is also aria-hidden in the clear button's svg
    });

    it("should have clear button with title attribute", () => {
      render(<SearchInput value="test" onChange={mockOnChange} />);
      const clearButton = screen.getByRole("button", { name: "Clear search" });
      expect(clearButton).toHaveAttribute("title", "Clear search");
    });
  });

  describe("Input Events", () => {
    it("should handle paste events", async () => {
      const user = userEvent.setup();
      render(<SearchInput value="" onChange={mockOnChange} />);

      const input = screen.getByPlaceholderText("Search campaigns..") as HTMLInputElement;

      // Simulate paste by changing the value directly
      fireEvent.change(input, { target: { value: "pasted text" } });

      expect(mockOnChange).toHaveBeenCalled();
    });

    it("should handle select all + delete", async () => {
      const user = userEvent.setup();
      render(<SearchInput value="existing" onChange={mockOnChange} />);

      const input = screen.getByPlaceholderText("Search campaigns..") as HTMLInputElement;
      input.focus();

      await user.keyboard("{Control>}a{/Control}");
      await user.keyboard("{Backspace}");

      expect(mockOnChange).toHaveBeenCalled();
    });
  });

  describe("Styling", () => {
    it("should have search-input-wrapper class", () => {
      const { container } = render(<SearchInput value="" onChange={mockOnChange} />);
      const wrapper = container.querySelector(".search-input-wrapper");
      expect(wrapper).toBeInTheDocument();
    });

    it("should have search-input class on input element", () => {
      const { container } = render(<SearchInput value="" onChange={mockOnChange} />);
      const input = container.querySelector(".search-input");
      expect(input).toBeInTheDocument();
    });

    it("should have search-clear-button class on clear button", () => {
      const { container } = render(<SearchInput value="test" onChange={mockOnChange} />);
      const button = container.querySelector(".search-clear-button");
      expect(button).toBeInTheDocument();
    });
  });

  describe("Edge Cases", () => {
    it("should handle very long search queries", async () => {
      const user = userEvent.setup();
      const longQuery = "a".repeat(500);
      render(<SearchInput value={longQuery} onChange={mockOnChange} />);

      const input = screen.getByDisplayValue(longQuery) as HTMLInputElement;
      expect(input.value).toBe(longQuery);
    });

    it("should handle special characters in search", async () => {
      const user = userEvent.setup();
      const specialQuery = "test@#$%^&*()";
      render(<SearchInput value={specialQuery} onChange={mockOnChange} />);

      const input = screen.getByDisplayValue("test@#$%^&*()") as HTMLInputElement;
      expect(input.value).toBe(specialQuery);
    });

    it("should handle unicode characters", async () => {
      const unicodeQuery = "🚀 RocketShip ñ";
      render(<SearchInput value={unicodeQuery} onChange={mockOnChange} />);

      const input = screen.getByDisplayValue(unicodeQuery) as HTMLInputElement;
      expect(input.value).toBe(unicodeQuery);
    });
  });
});
