# UGC safety operations

Vybaa’s safety mailbox must be monitored every day. Set `MODERATION_ALERT_EMAIL` in production to a staffed address; it falls back to `SMTP_USER` only when the dedicated address is absent.

## Response target

Every new report is ordered oldest-first and includes `responseDueAt`, exactly 24 hours after submission. The admin safety queue marks overdue reports. A team member must start review, examine the preserved evidence snapshot, and complete one of these actions before the deadline:

- **Remove + suspend** for a violation. This removes the reported activity/comment, invalidates the offender’s refresh session, suspends the account from all authenticated endpoints, and preserves the report audit record.
- **Dismiss** only when the content does not violate the Terms or Community Standards.

Open `/app/admin/feature-flags`, enter the production `ADMIN_SECRET`, then use **Safety queue**. Treat an email failure as an operational alert: reports remain in the queue even when mail delivery fails.

## Release checklist

1. Apply Prisma migrations with `npm run db:migrate` in `cloud/`.
2. Set and verify `MODERATION_ALERT_EMAIL`, `SMTP_USER`, `SMTP_PASSWORD`, and `ADMIN_SECRET`.
3. In the Cloudinary console, subscribe to the Amazon Rekognition AI Moderation add-on. Public profile and community-cover uploads fail closed unless Cloudinary returns an `approved` moderation result. Test one safe and one unsafe image before submission.
4. Deploy the cloud API, app, and public website. Confirm `https://www.vybaa.app/terms` shows the September 11, 2026 policy.
5. Create two test users. Post an allowed activity from user A and view it as user B.
6. Report it from the activity overflow menu. Confirm the report appears in Safety queue and the safety mailbox receives an alert.
7. Block user A from the same safety sheet. Confirm their activity disappears immediately and their public profile is no longer available to user B.
8. Use Remove + suspend on a test report. Confirm the content is removed and user A can no longer authenticate.

## App Review recording

Record on a physical iPhone in one continuous take:

1. Open Log in and show the unchecked Terms/Community Standards agreement. Open **Terms of Use**, return, tick the agreement, and log in.
2. Open Communities, select a community, open a different user’s activity overflow menu, choose **Report content**, select a reason, and submit.
3. Open the same safety menu, choose **Block**, show the explanation, confirm, and show the content disappear immediately.
4. Optionally open another user’s public profile and show the visible **Report or block** button.

Upload the recording to a stable reviewer-accessible URL and add it to App Store Connect under App Review Information → Notes. Do not use a URL that requires your company login.

Suggested review reply:

> We implemented the Guideline 1.2 safeguards throughout Vybaa. Users must accept our Terms of Use and Community Standards before email or Google registration/login; the terms explicitly prohibit objectionable content and abusive behavior. Shared community fields are filtered before posting. Every other user’s activity and public profile exposes Report and Block controls. Reports enter an oldest-first moderation queue, alert our safety mailbox, and carry a 24-hour deadline. Blocking immediately removes that user’s content from the blocker’s feed and also creates a developer-visible safety report with preserved evidence. Our moderation action removes offending content and suspends the responsible account. The physical-device demonstration is linked in App Review Notes.
