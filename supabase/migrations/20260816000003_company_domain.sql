-- Company domain travels with each row: mappable from the CSV, passed to
-- the routine (sharply better company-match rates), enriched back.
alter table public.run_rows add column if not exists company_domain text;
