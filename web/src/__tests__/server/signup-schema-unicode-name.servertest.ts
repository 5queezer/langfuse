import { signupSchema } from "@/src/features/auth/lib/signupSchema";

describe("signupSchema name validation", () => {
  const validBaseInput = {
    email: "test@example.com",
    password: "P@ssw0rd!",
  };

  it("accepts names with accented letters", () => {
    const result = signupSchema.safeParse({
      ...validBaseInput,
      name: "André",
    });

    expect(result.success).toBe(true);
  });

  it("accepts names with hyphens", () => {
    const result = signupSchema.safeParse({
      ...validBaseInput,
      name: "Smith-Jones",
    });

    expect(result.success).toBe(true);
  });

  it("accepts names with apostrophes", () => {
    const result = signupSchema.safeParse({
      ...validBaseInput,
      name: "O'Brien",
    });

    expect(result.success).toBe(true);
  });

  it("accepts names with periods", () => {
    const result = signupSchema.safeParse({
      ...validBaseInput,
      name: "Dr. Smith",
    });

    expect(result.success).toBe(true);
  });

  it("rejects names longer than 100 characters", () => {
    const result = signupSchema.safeParse({
      ...validBaseInput,
      name: "a".repeat(101),
    });

    expect(result.success).toBe(false);
  });

  it("rejects names with disallowed punctuation", () => {
    const result = signupSchema.safeParse({
      ...validBaseInput,
      name: "André!",
    });

    expect(result.success).toBe(false);
  });
});
