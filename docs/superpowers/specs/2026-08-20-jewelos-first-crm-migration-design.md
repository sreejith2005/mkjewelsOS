# JewelOS-first CRM migration

## Decision

JewelOS is the permanent system of record for identity, staff lifecycle,
roles, branches, departments, access policy, audit trails, and future CRM
operations. The existing `sreejith-crm` application is a controlled migration
source and rollback reference, not a second permanent authority.

## Target architecture

The final customer-facing application is JewelOS. CRM lives as a JewelOS
domain module backed by the `jewelos-prod` Supabase project and its database
authorization model. CRM data keeps stable source references to the legacy
CRM so historical records can be reconciled without matching people, clients,
or branches by display name.

The current proxied `/crm` deployment remains only as a reversible bridge
until each migrated capability has passed data, authorization, and user
acceptance checks. No permanent cross-project OAuth dependency, duplicated
employee roster, or dual-write workflow is introduced.

## Change-tolerant data model

Core facts with durable meaning remain typed and indexed: client identity,
normalized contacts, ownership, branch, timestamps, lifecycle state, and
audit attribution. Changeable business fields use versioned field definitions
and validated JSON payloads. A field definition has a stable key, label,
type, validation rules, active/effective state, and revision history. Existing
historical answers retain the field-definition revision that governed them.

This permits future CRM forms and fields to change without destructive table
rewrites or reinterpretation of historical records.

## Migration rules

1. JewelOS IDs are canonical for staff, branches, roles, and permissions.
2. Every imported legacy record carries `legacy_source`, `legacy_id`, import
   batch, source checksum, and reconciliation status.
3. Cross-system relationships are maintained only in explicit, audited mapping
   tables. Name-based matching is a review aid, never an authorization rule.
4. Each capability has one writer. During transition the legacy CRM remains
   the writer until JewelOS has been accepted for that capability.
5. Imports are idempotent and append-only where historical facts are involved.
6. CRM deletion, merge, reassignment, permission, and configuration changes
   are server-authorized and audited.

## Delivery sequence

1. Build the canonical crosswalk and read-only migration/reconciliation tools.
2. Import and verify staff/branch mappings and CRM reference data with no
   production CRM writes.
3. Migrate CRM reads and configurable field definitions to JewelOS.
4. Cut over one write capability at a time: client creation, walk-ins,
   follow-ups, referrals, documents, then reporting.
5. Retain the legacy CRM as a read-only archive until retention, backup, and
   restoration checks are accepted.

## Security and operations

RLS and narrowly granted database functions are the enforcement boundary.
Browser UI only reflects decisions made server-side. Sensitive mutations write
JewelOS audit rows in the same transaction. Backup/restore drills,
reconciliation reports, migration runbooks, and role-based acceptance tests
are required before each cutover.
