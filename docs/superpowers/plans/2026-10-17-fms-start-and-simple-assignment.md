# FMS form start repair and simple assignment

Owner request: repair every form start reporting “The exact workflow could not
start from this form”; collapse assignment settings; select the next employee
from Assigned To on the completing form, otherwise retain the previous owner.
Web only. Existing published/custom contracts and historical instances stay intact.

1. Reproduce the exact `flow_form` transaction in pgTAP before changing SQL.
2. Separate the mutating starter call from the subsequent instance lookup.
3. Add an opt-in simple form-chain configuration using the existing version-2
   contract; default new steps to it, retain advanced configurations explicitly.
   Use only the nearest causal human visit. Never infer an owner from another
   branch or choose arbitrarily between multiple employees/questions.
4. Collapse Assignment and advanced settings, explain the rule in plain text.
5. Exercise preview/execution parity, initial/repeated forms, absent Assigned To,
   denied access, replay, existing custom modes, and desktop/phone rendering.
6. Run focused tests, types/build, scoped review and credential scan. Preflight
   jewelos-prod, apply only the forward fix migration, publish main, verify
   hosted ledger/lint and hosting status. Production-only release is already
   authorized by the owner; synthetic fixtures remain local.
