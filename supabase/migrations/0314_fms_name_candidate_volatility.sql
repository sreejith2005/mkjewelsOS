-- Candidate selection reads no tables, but calls PostgreSQL STABLE text helpers.
-- Match that volatility contract; callers are already statement-stable reads.
alter function public.fms_record_name_from_sources(jsonb,text,jsonb) stable;
