# Imported checklist completion fix

## Goal

Imported rows whose task type is `checklist` must be click-to-complete even when the source CSV says evidence is required. Genuine `delegation` tasks must keep their upload requirement.

## Plan

1. Add a component regression test proving stale checklist data shows Complete, never Upload, and describes evidence as not required.
2. Add forward migration `0148` that normalizes future imported checklist persistence while preserving the raw row used for cross-file fingerprints.
3. Repair only registry-linked imported checklist templates and instances, with one audit entry per changed record.
4. Add pgTAP coverage for checklist normalization, delegation preservation, replay compatibility, helper privileges, and audit logging.
5. Run focused tests, local database reset/pgTAP, broader web tests, typecheck, build, lint, and diff checks.
