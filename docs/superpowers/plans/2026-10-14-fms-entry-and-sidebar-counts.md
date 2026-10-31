# FMS form entry repair and live sidebar counts

Approved in chat on 2026-10-14. Reproduction reported: Instagram Assignee,
opened from Forms Library, should start Instagram FMS and expose the next work
item in Tasks. Preserve exact assignments, published form versions, historical
submissions, and existing server assignment precedence (migration 0194 already
defaults unnamed steps to the initial submitter).

1. Reproduce initial-form routing and matching using rollback-only synthetic
   pgTAP fixtures. Inspect hosted workflow metadata if authenticated access is
   available; never infer a live cause solely from source.
2. Add forward migration 0236: route initial form completion through the existing
   server route evaluator for standalone and assigned starts. Preserve exact
   assignment identity, scope, atomic submission/progression, and audit. Explain
   eligible-flow/form-version mismatches rather than silently presenting a
   workflow form as successfully started. Ordinary standalone forms stay valid.
3. Add migration 0237: actor-scoped exact sidebar counts, private durable leave
   status alerts, and allowed/denied pgTAP coverage. Count pending personal work,
   not management visibility or the limited recent inbox. Preserve history.
4. Extend shared data/core count parsing and web/native shell badges. Reuse
   tenant and inbox realtime; refresh on reconnect and foreground. Hide zero
   badges; retain pending work until completion and update alerts until read.
5. Run focused database/client tests, related FMS regressions, typechecks/build,
   rendered desktop/phone QA, and diff checks. Keep local/hosted/device evidence
   distinct. Preserve all unrelated current checkout changes.
6. Follow production playbook and standing signed Android release instruction.
   Stop at failed release gates; never include unrelated dirty shared source or
   pending migrations in a production release.
