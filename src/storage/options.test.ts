import { describe, expect, it } from "vitest";
import { validateUsername } from "./options";

describe("validateUsername", () => {
  it("rejects blank names and inappropriate fuzzy matches", () => {
    expect(validateUsername("   ")).toBe("Username is required.");
    expect(validateUsername("LongUsernameX")).toBe("Username must be 12 characters or fewer.");
    expect(validateUsername("CockSuck")).toBe("That username is considered inappropriate, please select another.");
    expect(validateUsername("fuuckin")).toBe("That username is considered inappropriate, please select another.");
    expect(validateUsername("fcking")).toBe("That username is considered inappropriate, please select another.");
  });

  it("accepts simple text names", () => {
    expect(validateUsername("Jake")).toBe("");
    expect(validateUsername("AdventureOne")).toBe("");
  });
});
