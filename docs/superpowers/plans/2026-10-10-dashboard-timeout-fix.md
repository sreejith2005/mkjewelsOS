# Main dashboard timeout repair

The production default overview returns valid JSON but takes 19–30 seconds;
authenticated PostgREST requests have an eight-second statement limit. Earlier
administrative SQL smoke checks did not enforce that limit.

1. Reproduce the default overview with the same eight-second SQL budget, without
   printing operational records. Add a local synthetic scale regression.
2. Add the next forward migration. First allow PostgreSQL to inline the private,
   parameter-only metric predicate; its per-function SET clause prevents inlining
   and forces repeated SQL execution for every metric/record pair. Retain actor
   resolution, row scope rules, metrics, grant boundaries and RPC signatures.
   Predicate inlining alone failed the scale budget; caching the four stable
   module-access decisions once per row-helper invocation passed it.
3. Run the existing analytics/saved-view authorization contracts and the scale
   regression locally. Measure the resulting production read under the same budget.
4. Review the exact linked migration ledger/dry run, deploy only the correction,
   verify read success and denied access, then publish the named paths to main.

No client timeout increase, stored-data migration, authorization relaxation, or
Android binary change is planned. If predicate inlining alone does not meet the
budget, measure the repeated access checks/row scans before extending the correction.
