// Bind the deployed aggregates to the exact classifier replay; changing these requires an explicit research review.
export const labelEvidenceBinding = {
  registryVersion: "label-rules-1",
  classifierVersion: "automatic-breakout-3",
  referenceVersion: "historical-label-context-1",
  sourceSHA256:
    "56eaabea545a89ed0afaa5867d84e22d56872d323875da95afeb35c65a900283",
  researchSHA256:
    "27fb606b7b619c82c8d9e4653f8e7f901bff3c89714c1b132b0e68f8f0fa6aa3",
  // Hash UTF-8 text with LF line endings so Windows checkouts and Linux CI bind the same research content.
  aggregateSHA256:
    "9304f50c24d00f20d0681d27861d5e57c9f2f08b66244b896f5f10d190484a0b",
} as const;
