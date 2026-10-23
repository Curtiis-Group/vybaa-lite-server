import { z } from "zod";
import { ONBOARDING_QUESTIONS } from "../config/onboarding-questionnaire.config";

export const onboardingProfileInputSchema = z
  .object({
    version: z.literal(1),
    revision: z.number().int().min(0),
    skipped: z.boolean(),
    answers: z
      .array(
        z
          .object({
            questionId: z.string().max(50),
            choices: z.array(z.string().trim().min(1).max(100)).max(3),
            customText: z.string().trim().max(500),
          })
          .strict(),
      )
      .max(ONBOARDING_QUESTIONS.length),
  })
  .strict()
  .superRefine((profile, context) => {
    const ids = new Set<string>();
    for (const answer of profile.answers) {
      const question = ONBOARDING_QUESTIONS.find(
        (entry) => entry.id === answer.questionId,
      );
      if (
        !question ||
        ids.has(answer.questionId) ||
        answer.choices.length > question.maxChoices ||
        new Set(answer.choices).size !== answer.choices.length ||
        answer.choices.some((choice) => !question.options.includes(choice)) ||
        (!answer.choices.length && !answer.customText)
      ) {
        context.addIssue({
          code: "custom",
          message: "Choose valid, distinct answers for each question",
        });
      }
      ids.add(answer.questionId);
    }
    if (profile.skipped && profile.answers.length)
      context.addIssue({
        code: "custom",
        message: "A skipped questionnaire must not submit answers",
      });
  });

export type OnboardingProfileInput = z.infer<
  typeof onboardingProfileInputSchema
>;
