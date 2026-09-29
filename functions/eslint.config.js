import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["lib/**"] },
  ...tseslint.configs.recommended,
  {
    rules: {
      "no-console": "error", // use firebase-functions/logger (structured, no PII)
    },
  },
);
