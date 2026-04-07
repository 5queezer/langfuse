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

  it("rejects names with punctuation", () => {
    const result = signupSchema.safeParse({
      ...validBaseInput,
      name: "André!",
    });

    expect(result.success).toBe(false);
  });
});
