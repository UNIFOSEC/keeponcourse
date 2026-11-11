import { describe, expect, it } from "vitest";
import { LIMITS, hasErrors, isValidDate, validateCourse } from "../src/validation";

const valid = { name: "Intro to Statistics", description: "Probability and testing", target_date: "2027-03-01", status: "Not Started" as const };

describe("isValidDate", () => {
  it("accepts real calendar dates", () => {
    expect(isValidDate("2026-11-11")).toBe(true);
    expect(isValidDate("2028-02-29")).toBe(true); // leap year
  });

  it("rejects impossible dates and other formats", () => {
    for (const bad of ["2026-02-30", "2027-02-29", "2026-13-01", "2026-1-5", "11/11/2026", "", null, 20261111]) {
      expect(isValidDate(bad)).toBe(false);
    }
  });
});

describe("validateCourse", () => {
  it("accepts a complete course", () => {
    expect(hasErrors(validateCourse(valid))).toBe(false);
  });

  it("requires every field for a new course", () => {
    const errors = validateCourse({});
    expect(Object.keys(errors).sort()).toEqual(["description", "name", "status", "target_date"]);
  });

  it("treats whitespace-only text as missing", () => {
    expect(validateCourse({ ...valid, name: "   " }).name).toBeDefined();
  });

  it("enforces the same length limits as the API", () => {
    expect(validateCourse({ ...valid, name: "x".repeat(LIMITS.name) }).name).toBeUndefined();
    expect(validateCourse({ ...valid, name: "x".repeat(LIMITS.name + 1) }).name).toBeDefined();
    expect(validateCourse({ ...valid, description: "x".repeat(LIMITS.description + 1) }).description).toBeDefined();
  });

  it("only accepts the three statuses", () => {
    expect(validateCourse({ ...valid, status: "Done" as never }).status).toBeDefined();
  });

  it("checks only the fields present in a partial update", () => {
    expect(hasErrors(validateCourse({ status: "Completed" }, true))).toBe(false);
    expect(validateCourse({ target_date: "2026-02-30" }, true).target_date).toBeDefined();
  });
});
