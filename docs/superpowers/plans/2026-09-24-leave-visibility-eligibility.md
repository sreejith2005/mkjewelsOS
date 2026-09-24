# Leave visibility and eligibility

1. Move the existing leave workspace before the Availability roster on web and Android. Keep roster behavior intact.
2. Add a server-owned eligibility RPC for the signed-in applicant. Exclude Super Admin and any profile whose designation is Director, Managing Director, or Owner; HR and other roles remain eligible. Apply the same check in `submit_leave_request` so a direct call cannot bypass the interface.
3. Add an active Leave Types Dropdown Master category and the three requested values through a forward migration. The app continues reading the master and does not hardcode a separate list.
4. Start excluded users on summary or review, with no apply control. Preserve existing applications and review access.
5. Test database permission denial and staff success, web/native visibility, and the existing Availability regression suites. Deploy the migration to the existing linked project after dry-run and publish the required signed Android update if all release gates pass.
