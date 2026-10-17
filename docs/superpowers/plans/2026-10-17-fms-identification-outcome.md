# Distinguishable FMS work and clear completion

Owner requests unique visible identification of otherwise identical stage tasks,
plain submission confirmation with next assignee, and an obvious continuation
when the current employee owns the next stage. Previous form context stays before
execution. Web only; existing canonical IDs, transactional progression and access
checks stay authoritative.

- Add shared presentation helper appending the persisted FMS reference, preserving
  configured titles; use it in web Tasks and Home and focused page headings.
- Add a plain runtime outcome component. Preserve the existing successful starter and Forms Library confirmations.
  Use server-returned ownWorkTargets only for continuation links; name every actual
  destination, retain approval/hold/waiting/deferred semantics and parallel targets.
- Focused runtime page replaces the completed runner/context with its success
  outcome. Pending completion keeps required evidence/checklist controls available.
- Test duplicate titles, next-owner links, no other-owner link, parallel outcomes,
  deferred requirements, starter recovery and stage submission. Exercise actual
  handoff/continuation and previous answers at phone and desktop widths.
- No schema change planned. Review, type/build/regressions, scoped main publication
  and independent CI/web deployment verification follow existing authorization.
