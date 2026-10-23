"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.onboardingProfileInputSchema = void 0;
const zod_1 = require("zod");
const onboarding_questionnaire_config_1 = require("../config/onboarding-questionnaire.config");
exports.onboardingProfileInputSchema = zod_1.z
    .object({
    version: zod_1.z.literal(1),
    revision: zod_1.z.number().int().min(0),
    skipped: zod_1.z.boolean(),
    answers: zod_1.z
        .array(zod_1.z
        .object({
        questionId: zod_1.z.string().max(50),
        choices: zod_1.z.array(zod_1.z.string().trim().min(1).max(100)).max(3),
        customText: zod_1.z.string().trim().max(500),
    })
        .strict())
        .max(onboarding_questionnaire_config_1.ONBOARDING_QUESTIONS.length),
})
    .strict()
    .superRefine((profile, context) => {
    const ids = new Set();
    for (const answer of profile.answers) {
        const question = onboarding_questionnaire_config_1.ONBOARDING_QUESTIONS.find((entry) => entry.id === answer.questionId);
        if (!question ||
            ids.has(answer.questionId) ||
            answer.choices.length > question.maxChoices ||
            new Set(answer.choices).size !== answer.choices.length ||
            answer.choices.some((choice) => !question.options.includes(choice)) ||
            (!answer.choices.length && !answer.customText)) {
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
