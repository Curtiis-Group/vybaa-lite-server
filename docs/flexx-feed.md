# Flexx collections

Feed reads never generate content. `GET /api/v1/flexx/designs` reads published
collections and returns owner/category-bound signed cursors with a fixed
publication snapshot. Scrolling paginates these saved maps; it does not call AI.

The existing hourly scheduler prepares one global batch per six-hour bucket,
configured in `src/config/flexx-design.config.ts`. The model remains in
`src/config/ai-provider.config.ts`. No new interval or environment switch is added.
The database claim and expiring lease prevent duplicate generation across workers.
Only a fully validated batch is published. Failed/expired work can be retried by
the same background cycle; old collections are not overwritten or deleted.

Collections contain abstract layouts, partner authors, partner reactions and questions,
not user identities, personal values, journals or transcripts. The app binds the
signed-in user's real stats. Authors are one to three distinct known AI partners;
the user is never an author. `likedBy` contains zero to six distinct partner IDs,
chosen in the same generation call. There are no generated popularity numbers.
Legacy user-author maps and near-white palettes are normalized at read time.
Device-saved likes remain scoped to the signed-in account.

Each scheduled batch includes two questionnaire cards. Answer submission uses
the authenticated user's timezone and the server's local date, resolves the
original question from the published collection and validates selected/custom
answers. One answer per card/local day is saved idempotently as a private
`FLEXX_QUESTIONNAIRE_ANSWERED` ActivitySignal. This is consumed by the existing
daily-observation and Rewind question context queries; it never completes a
Rewind session or awards goal progress. Saving an answer does not call AI.
Personalization-off answers are retained privately with `privacyEligible: false`.
Private answers and controls are excluded from the share image.

## Rollout

Apply `prisma/migrations/20261019010000_scheduled_flexx_collections/migration.sql`
through the normal Prisma migration deployment before running the new backend.
Regenerate Prisma Client as part of the normal build. No production migration
was applied during implementation.

Until the first scheduled batch is published, starter compositions remain
available. Missing/unavailable storage never falls back to request-time AI.
The reader exposes up to the latest 24 collections, preserving all stored history.
