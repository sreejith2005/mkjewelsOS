# Form library visibility

Approved by the owner on 2026-10-23 in chat.

Add a per-form-version **Visible in Forms Library** toggle, available to active users with `forms.manage`. Existing forms and newly created forms default to visible. Hidden forms remain manageable by form authors. Other users cannot browse or submit them independently, even when an assignment or past submission allows reading the template.

Assigned Tasks and FMS work retain exact assignment-based access and atomic submission/progression. Existing submissions, attachments, notifications, workflow links, and pinned versions remain intact. Visibility is independent of lifecycle, role eligibility, and module access. Revisions and duplicates inherit the source visibility.

Approach: persist a dedicated boolean on `form_templates`, change visibility through an audited RPC, and separate library eligibility from template readability. A frontend-only filter would permit direct API submissions; archiving would disrupt active work. Neither satisfies the request.

No new Kiara read tool is needed: this is a library setting, not a new employee data source. Update existing app help. No native Android change or APK is required.
