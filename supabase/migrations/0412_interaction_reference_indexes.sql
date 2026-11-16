-- 0412: indexes on the columns that point at an interaction.
--
-- Found 2026-11-16: migration 0411 timed out on production while deleting
-- 4,097 interactions. Postgres checks every column that references
-- customer.interactions for each deleted row, and these columns had no index,
-- so each check read a whole table. Measured on a copy-sized dataset (33,000
-- live interactions, 4,100 to delete, 263,800 answers): over 170 seconds
-- without the indexes, 3.5 seconds with them.
--
-- "if not exists" because the owner creates the same indexes by hand on
-- production before re-running 0411 there; this file is the record and brings
-- every other database in line.

create index if not exists interactions_parent_idx on customer.interactions (parent_interaction_id) where parent_interaction_id is not null;
create index if not exists follow_ups_closed_by_idx on customer.follow_ups (closed_by_interaction_id) where closed_by_interaction_id is not null;
create index if not exists appointments_visit_idx on customer.appointments (visit_interaction_id) where visit_interaction_id is not null;
create index if not exists client_field_values_interaction_idx on customer.client_field_values (interaction_id) where interaction_id is not null;
create index if not exists ingest_rows_interaction_idx on customer.ingest_rows (interaction_id) where interaction_id is not null;
create index if not exists interaction_products_interaction_idx on customer.interaction_products (interaction_id);
