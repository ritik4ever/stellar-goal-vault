import { describe, it, expect } from "vitest";
import {
  validateStellarAccount,
  validateTitle,
  validateDescription,
  validateTargetAmount,
  validateDeadlineHours,
  validateForm,
  isFormValid,
} from "./validation";

describe("Frontend Validation Utilities", () => {
  describe("validateStellarAccount", () => {
    it("should validate a correct Stellar account", () => {
      const result = validateStellarAccount("G" + "A".repeat(55));
      expect(result).toBeNull();
    });

    it("should reject empty creator account", () => {
      expect(validateStellarAccount("")).not.toBeNull();
      expect(validateStellarAccount("   ")).not.toBeNull();
    });

    it("should reject account not starting with G", () => {
      const result = validateStellarAccount("A" + "A".repeat(55));
      expect(result).toBeTruthy();
      expect(result).toContain("must start with 'G'");
    });

    it("should reject account with wrong length", () => {
      const result = validateStellarAccount("G" + "A".repeat(50));
      expect(result).toBeTruthy();
      expect(result).toContain("exactly 56 characters");
    });

    it("should reject account with invalid characters", () => {
      const result = validateStellarAccount("G" + "Z".repeat(55));
      expect(result).toBeTruthy();
      expect(result).toContain("Invalid Stellar account format");
    });

    it("should accept valid account with allowed characters (A-Z, 2-7)", () => {
      const result = validateStellarAccount("G" + "2".repeat(27) + "A".repeat(28));
      expect(result).toBeNull();
    });
  });

  describe("validateTitle", () => {
    it("should validate a valid title", () => {
      expect(validateTitle("Valid Campaign Title")).toBeNull();
    });

    it("should reject empty title", () => {
      expect(validateTitle("")).not.toBeNull();
      expect(validateTitle("   ")).not.toBeNull();
    });

    it("should reject title shorter than 4 characters", () => {
      const result = validateTitle("Hey");
      expect(result).toBeTruthy();
      expect(result).toContain("at least 4 characters");
    });

    it("should reject title longer than 80 characters", () => {
      const result = validateTitle("A".repeat(81));
      expect(result).toBeTruthy();
      expect(result).toContain("cannot exceed 80 characters");
    });

    it("should accept title with 4 characters", () => {
      expect(validateTitle("Test")).toBeNull();
    });

    it("should accept title with 80 characters", () => {
      expect(validateTitle("A".repeat(80))).toBeNull();
    });
  });

  describe("validateDescription", () => {
    it("should validate a valid description", () => {
      const desc =
        "This is a valid campaign description that has enough content to pass validation.";
      expect(validateDescription(desc)).toBeNull();
    });

    it("should reject empty description", () => {
      expect(validateDescription("")).not.toBeNull();
      expect(validateDescription("   ")).not.toBeNull();
    });

    it("should reject description shorter than 20 characters", () => {
      const result = validateDescription("Too short");
      expect(result).toBeTruthy();
      expect(result).toContain("at least 20 characters");
    });

    it("should reject description longer than 500 characters", () => {
      const result = validateDescription("A".repeat(501));
      expect(result).toBeTruthy();
      expect(result).toContain("cannot exceed 500 characters");
    });

    it("should accept description with 20 characters", () => {
      expect(validateDescription("A".repeat(20))).toBeNull();
    });

    it("should accept description with 500 characters", () => {
      expect(validateDescription("A".repeat(500))).toBeNull();
    });
  });

  describe("validateTargetAmount", () => {
    it("should validate a valid amount", () => {
      expect(validateTargetAmount("100")).toBeNull();
      expect(validateTargetAmount(100.5)).toBeNull();
    });

    it("should reject empty amount", () => {
      expect(validateTargetAmount("")).not.toBeNull();
    });

    it("should reject zero or negative amounts", () => {
      expect(validateTargetAmount("0")).not.toBeNull();
      expect(validateTargetAmount("-5")).not.toBeNull();
      expect(validateTargetAmount(0)).not.toBeNull();
    });

    it("should reject non-numeric amounts", () => {
      const result = validateTargetAmount("abc");
      expect(result).toBeTruthy();
      expect(result).toContain("valid number");
    });

    it("should reject amount less than minimum (0.01)", () => {
      const result = validateTargetAmount("0.001");
      expect(result).toBeTruthy();
      expect(result).toContain("at least 0.01");
    });

    it("should accept minimum valid amount (0.01)", () => {
      expect(validateTargetAmount("0.01")).toBeNull();
    });

    it("should accept large amounts", () => {
      expect(validateTargetAmount("999999999.99")).toBeNull();
    });
  });

  describe("validateDeadlineHours", () => {
    it("should validate a valid deadline", () => {
      expect(validateDeadlineHours("72")).toBeNull();
      expect(validateDeadlineHours(24)).toBeNull();
    });

    it("should reject empty deadline", () => {
      expect(validateDeadlineHours("")).not.toBeNull();
    });

    it("should reject zero or negative hours", () => {
      expect(validateDeadlineHours("0")).not.toBeNull();
      expect(validateDeadlineHours("-5")).not.toBeNull();
      expect(validateDeadlineHours(0)).not.toBeNull();
    });

    it("should reject non-numeric deadline", () => {
      const result = validateDeadlineHours("abc");
      expect(result).toBeTruthy();
      expect(result).toContain("whole number");
    });

    it("should reject deadline less than 1 hour", () => {
      const result = validateDeadlineHours("0.5");
      expect(result).toBeTruthy();
      expect(result).toContain("at least 1 hour");
    });

    it("should reject deadline exceeding 365 days (8760 hours)", () => {
      const result = validateDeadlineHours("8761");
      expect(result).toBeTruthy();
      expect(result).toContain("cannot exceed 365 days");
    });

    it("should accept maximum valid deadline (8760 hours)", () => {
      expect(validateDeadlineHours("8760")).toBeNull();
    });

    it("should accept deadline of 1 hour", () => {
      expect(validateDeadlineHours("1")).toBeNull();
    });
  });

  describe("validateForm", () => {
    it("should return empty object for valid form", () => {
      const result = validateForm({
        creator: "G" + "A".repeat(55),
        title: "Valid Campaign",
        description: "This is a valid campaign description.",
        targetAmount: "500",
        deadlineHours: "72",
      });
      expect(result).toEqual({});
    });

    it("should return all errors for invalid form", () => {
      const result = validateForm({
        creator: "invalid",
        title: "Bad",
        description: "Short",
        targetAmount: "-10",
        deadlineHours: "0",
      });
      expect(result.creator).toBeTruthy();
      expect(result.title).toBeTruthy();
      expect(result.description).toBeTruthy();
      expect(result.targetAmount).toBeTruthy();
      expect(result.deadlineHours).toBeTruthy();
    });

    it("should return partial errors for partially invalid form", () => {
      const result = validateForm({
        creator: "G" + "A".repeat(55),
        title: "Valid Title",
        description: "Short",
        targetAmount: "100",
        deadlineHours: "72",
      });
      expect(result.creator).toBeUndefined();
      expect(result.title).toBeUndefined();
      expect(result.description).toBeTruthy();
      expect(result.targetAmount).toBeUndefined();
      expect(result.deadlineHours).toBeUndefined();
    });
  });

  describe("isFormValid", () => {
    it("should return true for empty errors object", () => {
      expect(isFormValid({})).toBe(true);
    });

    it("should return false if any error exists", () => {
      expect(isFormValid({ creator: "error" })).toBe(false);
      expect(isFormValid({ title: undefined, description: "error" })).toBe(false);
    });

    it("should return true when all errors are undefined", () => {
      expect(
        isFormValid({
          creator: undefined,
          title: undefined,
          description: undefined,
        }),
      ).toBe(true);
    });
  });
});
