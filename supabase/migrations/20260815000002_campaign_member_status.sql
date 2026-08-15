-- Campaign member disposition (Registered / Attended / …), chosen at run
-- start and passed to the Routine, which applies it to the CampaignMember.
alter table public.runs add column if not exists campaign_member_status text;
