# Actual forms and proposed customer mappings

Date: 2026-10-27. **Review proposal only; no mapping is enabled or approved.**

Source: read-only hosted definition query in `scripts/audit-customer-form-definitions.sql`; metadata snapshot in `FORMS_FMS_CONFIGURATION_CATALOG.json`. No submission answers were read. The snapshot includes actual template/field IDs, stable keys, types, section definitions, conditions, validation, rules, order, literal options/labels, configured branch rules and workflow links. Default answers, selected employees and customer values are excluded. Runtime assignment behavior has not been executed; a saved branch rule is configuration evidence, not an end-to-end routing test.

## Templates found

All five templates are version 1 and published. No saved template named Sales Closure was found. Names are presentation; mappings bind the UUID/version/key below.

| Template | UUID | Family UUID | Questions |
| --- | --- | --- | ---: |
| INSTAGRAM ASSIGNEE FORM | 987e7745-0a4d-45a1-99d1-0a2326dd1d44 | 6f87153d-bf85-468c-bb1d-a2d9e48862ee | 6 |
| INTRODUCTION CALL — INSTAGRAM LEADS | 0882d415-3e05-4f0d-b623-f1d61b0023b1 | 15fada73-7208-4d46-ad6c-0e88d5794696 | 9 |
| PROPOSAL (PRODUCT DEMONSTRATION) — INSTAGRAM LEADS | ef75152c-8425-474f-bf78-62c9e10e7eed | a5c8186a-9758-4997-92a6-47edb6c51fee | 3 |
| NEGOTIATION — INSTAGRAM LEADS | cab4e693-d52f-42d8-8b83-e1d28271e0b3 | b80268f3-cb66-4cfc-9db8-a624175371ce | 1 |
| WORK AND UPLOAD FORM | d8a58f04-f62b-4689-a48d-b89c653bce61 | 7a9ed73a-64db-4d24-8bab-04cdc866761f | 7 |

## Starting form proposal

| Stable key | Exact label | Type / section | Proposed destination and mode | Review condition |
| --- | --- | --- | --- | --- |
| field_1 | DM RECEIVED DATE | date / section_1 | History: enquiry received date | A date is not a known instant; retain as date, do not invent contact timestamp |
| field_2 | SOURCE OF THE LEAD | select / section_1 | Both: channel/source metadata | Validate saved option values; do not hardcode the workflow name as source |
| field_3 | ASSIGNED TO | user_dropdown / section_1 | Operational only | Existing assignment engine remains authoritative; capture selected/effective employee as workflow metadata |
| field_4 | CUSTOMER NAME | text / section_1 | Both: primary/alternate name contribution | Existing known name preserved with provenance; phone ambiguity cannot authorize rename/merge |
| field_5 | INSTAGRAM ID | text / section_1 | Both: scoped Instagram identity evidence | Need provider/account scope; unverified handle is evidence, not a verified cross-channel identity |
| field_6 | CUSTOMER CONTACT NUMBER | phone / section_1 | Both: phone identity candidate | Use current country-aware CRM normalization and index; shared phones go to review for this flow |

Name, Instagram and contact number are currently required; the source choice is optional. No-phone identity support must not silently change this published form's required-phone validation. Form authors may deliberately revise that requirement later using normal revision/publishing. New identity-only forms can use other reliable identities through the reusable contract.

## Introduction-call proposal

| Stable key | Exact label | Type / section | Proposed destination and mode |
| --- | --- | --- | --- |
| field_8 | STATUS | select / section_1 | History: configured stage outcome; no buyer/contact inference until exact vocabulary is reviewed |
| field_2 | IF THE CLIENT HAS TO BE ASSIGNED TO THE AHMEDABAD BRANCH | select / section_2 | History: branch/handoff request evidence; never overwrite authorized branch assignment from arbitrary text |
| field_3 | DID YOU ASK BELOW QUESTIONS TO CLIENT? (First-Time Enquiries on Instagram) | checkbox / section_2 | History: checklist evidence; does not contain the customer's answers to the questions mentioned |
| field_4 | DID YOU ASK BELOW QUESTIONS TO CLIENT? (If Customer Requests to See More Options) | checkbox / section_2 | History: checklist evidence; no invented requirement/budget/product preferences |
| field_5 | TYPE OF APPOINTMENT | select / section_2 | History: appointment type attribute, option review required |
| field_6 | APPOINTMENT IS SET FOR | date / section_2 | History: planned appointment date; not an actual store visit/contact |
| field_7 | ASSIGNED TO SALES PERSON | user_dropdown / section_2 | Operational only; preserve actual selected/effective handoff separately |
| field_1 | NEXT FOLLOW UP DATE | date / section_3 | History: next action date; no automated CRM task/contact creation without reviewed semantics |
| field_9 | REMARK | text / section_3 | History: protected original remark; do not extract purchase facts from free text |

All later stages inherit the source workflow's verified customer link. No field on this form is a new customer identity. Repeated attempts have distinct visit/submission identities. A saved checklist is not sufficient proof of a successful phone call. Contact outcome mapping is a review blocker until the existing option vocabulary is inspected and approved.

## Proposal, negotiation and work-upload forms

| Template / stable key | Exact label | Type / section | Proposed destination and mode |
| --- | --- | --- | --- |
| Proposal / field_8 | STATUS | select / section_1 | History: configured stage outcome; vocabulary review required |
| Proposal / field_1 | CHECKLIST | select / section_2 | History: exact configured value/label; do not infer completed sale |
| Proposal / field_2 | NEXT FOLLOW UP DATE | date / section_2 | History: planned next action |
| Negotiation / field_8 | STATUS | select / section_1 | History: configured outcome only; no automatic commercial classification |
| Work and upload / field_8 | STATUS | select / section_1 | Operational until a customer workflow linkage is deliberately configured |
| Work and upload / field_2 | IF THE CLIENT HAS TO BE ASSIGNED TO THE AHMEDABAD BRANCH | select / section_2 | Operational until linkage/review |
| Work and upload / field_3 | DID YOU ASK BELOW QUESTIONS TO CLIENT? (First-Time Enquiries on Instagram) | checkbox / section_2 | Operational until linkage/review |
| Work and upload / field_4 | DID YOU ASK BELOW QUESTIONS TO CLIENT? (If Customer Requests to See More Options) | checkbox / section_2 | Operational until linkage/review |
| Work and upload / field_5 | TYPE OF APPOINTMENT | select / section_2 | Operational until linkage/review |
| Work and upload / field_6 | APPOINTMENT IS SET FOR | date / section_2 | Operational until linkage/review |
| Work and upload / field_7 | ASSIGNED TO SALES PERSON | user_dropdown / section_2 | Operational assignment only |

The title WORK AND UPLOAD FORM does not establish uploaded evidence; its captured question definitions contain no upload field. Do not fabricate media or customer attribution from a form title.

## Published workflow links

`INSTAGRAM LEADS` v17, UUID `58e1fe5b-2c1f-4c8e-a5f7-a505aee3e38e`, is published. v18 is draft; v1-v16 are archived and retained. The snapshot contains each version's actual stage IDs and keys. Current published links are:

| Stable stage key | Stage name | Linked form |
| --- | --- | --- |
| start_form | Start form | Instagram assignee |
| stage_2 | INTRODUCTION CALL | Introduction call |
| stage_3 | FOLLOW UP 1 | Introduction call |
| stage_4 | FOLLOW UP 2 | Introduction call |
| stage_5 | FOLLOW UP 3 | Introduction call |
| stage_6 | PROPOSAL (PRODUCT DEMONSTRATION) | Proposal |
| stage_7 | CLOSURE | None |
| stage_8 | FOLLOW UP 1 | Proposal |
| stage_11 | NEGOTIATION | Negotiation |
| stage_10 | FOLLOW UP 2 | Proposal |
| stage_12 | FOLLOW UP 3 | Proposal |

No section key is selected on v17's links. Conditions and sections still exist on the forms and must be honored; historical/future stage-specific section selection must also work. Same labels occur on distinct stages: neither label nor stage definition alone identifies an execution attempt.

## Actual option meanings: important compatibility constraint

Option values are reused across these forms with different labels. Neither a global `field_8` rule nor a global token-to-outcome rule is safe. Bind interpretation to the template UUID/version, field key, mapping version and original option snapshot.

| Form / field | Saved value | Actual configured label | Safe interpretation before approval |
| --- | --- | --- | --- |
| Starter / field_2 | option_1 | THROUGH ADVERTISEMENT | Source evidence, not the literal source name option_1 |
| Starter / field_2 | direct_message | DIRECT MESSAGE | Source evidence |
| Starter / field_2 | through_story | THROUGH STORY | Source evidence |
| Introduction / field_8 | option_1 | INTERESTED PROCEED TO NEXT STEP | Interest/outcome evidence; not a purchase |
| Introduction / field_8 | interested_follow_up_required | INTERESTED FOLLOW-UP REQUIRED | Planned follow-up evidence |
| Introduction / field_8 | not_interested | NOT INTERESTED | Outcome evidence |
| Introduction / field_8 | call_not_connected | CALL NOT CONNECTED | Failed contact attempt, not successful contact |
| Proposal / field_8 | option_1 | INTERESTED PROCEED TO NEXT STEP | Interest/outcome evidence |
| Proposal / field_8 | interested_follow_up_required | INTERESTED FOLLOW-UP REQUIRED | Planned follow-up evidence |
| Proposal / field_8 | not_interested | NOT INTERESTED CLOSE THIS LEAD | Closure intent; preserve configured workflow behavior |
| Proposal / field_8 | call_not_connected | CALL NOT CONNECTED | Failed contact attempt |
| Proposal / field_8 | price_inquiry_client_will_get_back | PRICE INQUIRY – CLIENT WILL GET BACK | Outcome evidence |
| Negotiation / field_8 | option_1 | YES, THE CLIENT BOUGHT THE PRODUCT | Self-reported purchase assertion; no verified invoice/amount/date supplied |
| Negotiation / field_8 | interested_follow_up_required | NO, THE CLIENT DID NOT BUY | Non-purchase assertion; token name is misleading |
| Negotiation / field_8 | not_interested | DECISION PENDING | Pending decision; MUST NOT globally translate to not interested |
| Negotiation / field_8 | price_inquiry_client_will_get_back | NOT INTERESTED CLOSE THIS LEAD | Closure intent; token name is misleading |
| Negotiation / field_8 | call_not_connected | CALL NOT CONNECTED | Failed contact attempt |
| Negotiation / field_8 | price_inquiry_client_will_get_back_2 | PRICE INQUIRY – CLIENT WILL GET BACK | Price enquiry outcome evidence |

The proposal CHECKLIST also reuses `interested_follow_up_required` for DETAILS EXPLAINED (PURITY / WEIGHT / DIAMOND QUALITY). It is not a follow-up outcome. Original labels and values must both survive export and timeline rendering. Complete appointment/checklist options and conditions are retained in the JSON configuration snapshot.

## Mapping acceptance gate

Before enabling integration: review exact source/status/appointment option values and labels, CRM destination types, source account/tenant mapping, identity policy and contact outcome semantics; publish an immutable mapping version; test both starter and runtime sections with synthetic values. Current forms do not collect explicit budget, requirement, DOB, anniversary or verified invoice evidence. The integration must preserve actual answers, not pretend those fields were supplied. Adding new questions is a separate deliberate authoring action, not an automatic migration of published forms.
