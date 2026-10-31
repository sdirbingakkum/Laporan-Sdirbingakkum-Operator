-- SIM TNI: normalized 5 x 5 operator input with atomic summary projection.
-- This migration is additive. Existing imported summary rows are not modified.

create table public.sim_activity_records (
  id uuid primary key default gen_random_uuid(),
  report_submission_id uuid not null
    references public.report_submissions(id) on delete restrict,
  period_id uuid not null
    references public.report_periods(id) on delete restrict,
  pomdam_id uuid not null
    references public.pomdams(id) on delete restrict,
  sim_activity_type_id uuid not null
    references public.sim_activity_types(id) on delete restrict,
  sim_type_id uuid not null
    references public.sim_types(id) on delete restrict,
  value bigint,
  data_status text not null default 'VALID',
  source_report_id uuid
    references public.source_reports(id) on delete restrict,
  source_cell_id uuid
    references private.source_cells(id) on delete restrict,
  ingestion_method text not null default 'FORM',
  notes text,
  created_by uuid not null default auth.uid()
    references auth.users(id) on delete restrict,
  updated_by uuid not null default auth.uid()
    references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint sim_activity_records_status_check
    check (data_status in ('VALID', 'NOT_REPORTED')),
  constraint sim_activity_records_value_check
    check (
      (data_status = 'VALID' and value is not null and value >= 0)
      or
      (data_status = 'NOT_REPORTED' and value is null)
    ),
  constraint sim_activity_records_ingestion_check
    check (ingestion_method in ('FORM', 'EXCEL', 'SYSTEM')),
  constraint sim_activity_records_period_pomdam_activity_type_key
    unique (period_id, pomdam_id, sim_activity_type_id, sim_type_id)
);

comment on table public.sim_activity_records is
  'Fakta rinci SIM TNI per periode x Pomdam x kegiatan x golongan. Input operator disimpan sebagai FORM; fakta impor tetap memiliki source_report_id/source_cell_id.';
comment on column public.sim_activity_records.value is
  'Bilangan non-negatif. NULL hanya untuk data_status NOT_REPORTED; angka nol adalah nilai terlapor.';
comment on column public.sim_activity_records.source_cell_id is
  'Jika terisi, fakta berasal dari sel sumber dan harus diperlakukan terkunci.';
comment on column public.sim_activity_records.report_submission_id is
  'Pengiriman laporan induk yang menaungi satu set lengkap 25 fakta SIM TNI.';

create index sim_activity_records_submission_idx
  on public.sim_activity_records (report_submission_id);

alter table public.sim_activity_records enable row level security;
alter table public.sim_activity_records force row level security;

grant select, insert, update on public.sim_activity_records to authenticated;

create policy sim_activity_records_read_authorized
  on public.sim_activity_records
  for select
  to authenticated
  using (
    (select private.can_read_pomdam(pomdam_id))
    and (
      (select private.has_current_capability('VIEW_REPORTS'))
      or (select private.has_current_capability('MANAGE_REPORT_DATA'))
    )
  );

create policy sim_activity_records_managed_insert
  on public.sim_activity_records
  for insert
  to authenticated
  with check (
    (select private.has_current_capability('MANAGE_REPORT_DATA'))
    and (select private.can_read_pomdam(pomdam_id))
    and source_report_id is null
    and source_cell_id is null
    and ingestion_method = 'FORM'
    and created_by = (select auth.uid())
    and updated_by = (select auth.uid())
    and (
      (data_status = 'VALID' and value is not null and value >= 0)
      or (data_status = 'NOT_REPORTED' and value is null)
    )
  );

create policy sim_activity_records_managed_update
  on public.sim_activity_records
  for update
  to authenticated
  using (
    (select private.has_current_capability('MANAGE_REPORT_DATA'))
    and (select private.can_read_pomdam(pomdam_id))
    and source_report_id is null
    and source_cell_id is null
    and created_by = (select auth.uid())
  )
  with check (
    (select private.has_current_capability('MANAGE_REPORT_DATA'))
    and (select private.can_read_pomdam(pomdam_id))
    and source_report_id is null
    and source_cell_id is null
    and ingestion_method = 'FORM'
    and created_by = (select auth.uid())
    and updated_by = (select auth.uid())
    and (
      (data_status = 'VALID' and value is not null and value >= 0)
      or (data_status = 'NOT_REPORTED' and value is null)
    )
  );

create or replace function public.submit_sim_tni_pomdam_report(
  p_period_id uuid,
  p_pomdam_id uuid,
  p_facts jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  v_user_id uuid;
  v_period_year integer;
  v_period_type text;
  v_report_type_id uuid;
  v_submission_id uuid;
  v_existing_submitter uuid;
  v_revision integer;
  v_unique_facts integer;
  v_detail_rows integer;
  v_summary_rows integer;
begin
  v_user_id := (select auth.uid());

  if v_user_id is null then
    raise exception 'Authentication is required to submit SIM TNI data'
      using errcode = '42501';
  end if;

  if not (select private.has_current_capability('MANAGE_REPORT_DATA')) then
    raise exception 'MANAGE_REPORT_DATA capability is required'
      using errcode = '42501';
  end if;

  if not (select private.can_read_pomdam(p_pomdam_id)) then
    raise exception 'Access to the requested POMDAM is not authorized'
      using errcode = '42501';
  end if;

  select rp.report_year, rp.period_type
    into v_period_year, v_period_type
  from public.report_periods rp
  where rp.id = p_period_id
  for key share;

  if not found then
    raise exception 'The requested reporting period does not exist'
      using errcode = '22023';
  end if;

  if v_period_type <> 'MONTH' or v_period_year <> 2026 then
    raise exception 'SIM TNI operator input is limited to monthly periods in 2026'
      using errcode = '22023';
  end if;

  select rc.report_type_id
    into v_report_type_id
  from public.sim_report_contracts rc
  join public.sim_data_contracts dc
    on dc.id = rc.data_contract_id
  join public.report_types rt
    on rt.id = rc.report_type_id
  where rc.code = 'SIM_TNI_POMDAM_LAMPIRAN6_2026'
    and rc.status = 'ACTIVE'
    and dc.code = 'SIM_TNI_POMDAM_INPUT_2026'
    and dc.status = 'ACTIVE'
    and rt.code = 'SIM_TNI'
  limit 1;

  if v_report_type_id is null then
    raise exception 'The active SIM TNI input/report contracts are not correctly linked'
      using errcode = '55000';
  end if;

  if (select count(*) from public.sim_activity_types where active = true) <> 5
     or (select count(*) from public.sim_activity_types
         where active = true
           and code = any (array['NEW','RENEWAL','TRANSFER','LOST','REVOKED']::text[])) <> 5 then
    raise exception 'The active SIM TNI activity master must contain exactly the five contracted activities'
      using errcode = '55000';
  end if;

  if (select count(*) from public.sim_types where active = true) <> 5
     or (select count(*) from public.sim_types
         where active = true
           and code = any (array['A','BI','BII','BII_KHUSUS','C']::text[])) <> 5 then
    raise exception 'The active SIM type master must contain exactly the five contracted SIM types'
      using errcode = '55000';
  end if;

  if pg_catalog.jsonb_typeof(p_facts) is distinct from 'array' then
    raise exception 'p_facts must be a JSON array containing all 25 SIM inputs'
      using errcode = '22023';
  end if;

  if pg_catalog.jsonb_array_length(p_facts) <> 25 then
    raise exception 'Exactly 25 SIM activity/type values are required'
      using errcode = '22023';
  end if;

  if exists (
    select 1
    from pg_catalog.jsonb_array_elements(p_facts) as item(fact)
    where pg_catalog.jsonb_typeof(item.fact) is distinct from 'object'
  ) then
    raise exception 'Each SIM fact must be a JSON object'
      using errcode = '22023';
  end if;

  if exists (
    select 1
    from pg_catalog.jsonb_array_elements(p_facts) as item(fact)
    where pg_catalog.jsonb_typeof(item.fact -> 'activity_code') is distinct from 'string'
       or pg_catalog.jsonb_typeof(item.fact -> 'sim_type_code') is distinct from 'string'
       or pg_catalog.jsonb_typeof(item.fact -> 'value') is distinct from 'number'
  ) then
    raise exception 'Each SIM fact must include string activity_code, string sim_type_code, and numeric value'
      using errcode = '22023';
  end if;

  if exists (
    select 1
    from pg_catalog.jsonb_array_elements(p_facts) as item(fact)
    where (item.fact ->> 'activity_code') not in ('NEW','RENEWAL','TRANSFER','LOST','REVOKED')
       or (item.fact ->> 'sim_type_code') not in ('A','BI','BII','BII_KHUSUS','C')
  ) then
    raise exception 'The submitted activity or SIM type code is outside the active 5 x 5 contract'
      using errcode = '22023';
  end if;

  if exists (
    select 1
    from pg_catalog.jsonb_array_elements(p_facts) as item(fact)
    where (item.fact ->> 'value') !~ '^(0|[1-9][0-9]*)$'
  ) then
    raise exception 'SIM values must be explicit non-negative integers; blank is not zero'
      using errcode = '22023';
  end if;

  if exists (
    select 1
    from pg_catalog.jsonb_array_elements(p_facts) as item(fact)
    where (item.fact ->> 'value')::numeric > 9223372036854775807::numeric
  ) then
    raise exception 'A SIM value exceeds the supported bigint range'
      using errcode = '22003';
  end if;

  select count(*)
    into v_unique_facts
  from (
    select distinct
      item.fact ->> 'activity_code' as activity_code,
      item.fact ->> 'sim_type_code' as sim_type_code
    from pg_catalog.jsonb_array_elements(p_facts) as item(fact)
  ) combinations;

  if v_unique_facts <> 25 then
    raise exception 'Each of the 25 activity/type combinations must appear exactly once'
      using errcode = '22023';
  end if;

  if exists (
    select 1
    from pg_catalog.jsonb_array_elements(p_facts) as item(fact)
    group by item.fact ->> 'sim_type_code'
    having sum((item.fact ->> 'value')::numeric) > 9223372036854775807::numeric
  ) then
    raise exception 'A calculated SIM type summary exceeds the supported bigint range'
      using errcode = '22003';
  end if;

  -- Imported summary facts are immutable. Jan-Sep 2026 remain read-only
  -- because their summary rows are linked to imported source cells.
  perform 1
  from public.sim_records sr
  where sr.period_id = p_period_id
    and sr.pomdam_id = p_pomdam_id
    and sr.source_cell_id is not null
  limit 1
  for update;

  if found then
    raise exception 'This period/POMDAM already contains Excel-linked SIM summaries and is read-only'
      using errcode = '55000';
  end if;

  -- Lock existing detail rows and reject imported or other-owner facts.
  perform 1
  from public.sim_activity_records ar
  where ar.period_id = p_period_id
    and ar.pomdam_id = p_pomdam_id
    and (ar.source_report_id is not null or ar.source_cell_id is not null)
  limit 1
  for update;

  if found then
    raise exception 'This period/POMDAM contains source-linked SIM activity facts and cannot be overwritten'
      using errcode = '55000';
  end if;

  perform 1
  from public.sim_activity_records ar
  where ar.period_id = p_period_id
    and ar.pomdam_id = p_pomdam_id
    and ar.created_by <> v_user_id
  limit 1
  for update;

  if found then
    raise exception 'This SIM report was created by another account; ask an authorized manager to reopen it'
      using errcode = '42501';
  end if;

  -- Only the original submitter can revise an existing submission.
  select rs.id, rs.submitted_by
    into v_submission_id, v_existing_submitter
  from public.report_submissions rs
  where rs.report_type_id = v_report_type_id
    and rs.period_id = p_period_id
    and rs.pomdam_id = p_pomdam_id
  for update;

  if found and v_existing_submitter <> v_user_id then
    raise exception 'This SIM report has already been submitted by another account'
      using errcode = '42501';
  end if;

  insert into public.report_submissions (
    report_type_id,
    period_id,
    pomdam_id,
    submitted_by,
    status,
    revision,
    submitted_at,
    updated_at
  )
  values (
    v_report_type_id,
    p_period_id,
    p_pomdam_id,
    v_user_id,
    'SUBMITTED',
    1,
    pg_catalog.now(),
    pg_catalog.now()
  )
  on conflict (report_type_id, period_id, pomdam_id)
  do update set
    submitted_by = excluded.submitted_by,
    status = 'SUBMITTED',
    revision = public.report_submissions.revision + 1,
    submitted_at = pg_catalog.now(),
    updated_at = pg_catalog.now()
  returning id, revision
    into v_submission_id, v_revision;

  insert into public.sim_activity_records (
    report_submission_id,
    period_id,
    pomdam_id,
    sim_activity_type_id,
    sim_type_id,
    value,
    data_status,
    source_report_id,
    source_cell_id,
    ingestion_method,
    created_by,
    updated_by
  )
  select
    v_submission_id,
    p_period_id,
    p_pomdam_id,
    activity.id,
    sim_type.id,
    (item.fact ->> 'value')::bigint,
    'VALID',
    null,
    null,
    'FORM',
    v_user_id,
    v_user_id
  from pg_catalog.jsonb_array_elements(p_facts) as item(fact)
  join public.sim_activity_types activity
    on activity.code = item.fact ->> 'activity_code'
   and activity.active = true
  join public.sim_types sim_type
    on sim_type.code = item.fact ->> 'sim_type_code'
   and sim_type.active = true
  on conflict (period_id, pomdam_id, sim_activity_type_id, sim_type_id)
  do update set
    report_submission_id = excluded.report_submission_id,
    value = excluded.value,
    data_status = 'VALID',
    updated_by = excluded.updated_by,
    updated_at = pg_catalog.now()
  where public.sim_activity_records.source_report_id is null
    and public.sim_activity_records.source_cell_id is null
    and public.sim_activity_records.created_by = v_user_id;

  get diagnostics v_detail_rows = row_count;

  if v_detail_rows <> 25 then
    raise exception 'Expected to save 25 detail facts, but saved %; the transaction was rolled back', v_detail_rows
      using errcode = '40001';
  end if;

  insert into public.sim_records (
    period_id,
    pomdam_id,
    sim_type_id,
    value,
    data_status,
    source_cell_id
  )
  select
    p_period_id,
    p_pomdam_id,
    sim_type.id,
    sum((item.fact ->> 'value')::bigint)::bigint,
    'VALID',
    null
  from pg_catalog.jsonb_array_elements(p_facts) as item(fact)
  join public.sim_types sim_type
    on sim_type.code = item.fact ->> 'sim_type_code'
   and sim_type.active = true
  group by sim_type.id
  on conflict (period_id, pomdam_id, sim_type_id)
  do update set
    value = excluded.value,
    data_status = 'VALID',
    source_cell_id = null
  where public.sim_records.source_cell_id is null;

  get diagnostics v_summary_rows = row_count;

  if v_summary_rows <> 5 then
    raise exception 'Expected to update five SIM summary rows, but updated %; the transaction was rolled back', v_summary_rows
      using errcode = '40001';
  end if;

  return pg_catalog.jsonb_build_object(
    'status', 'SUBMITTED',
    'submission_id', v_submission_id,
    'revision', v_revision,
    'detail_rows', v_detail_rows,
    'summary_rows', v_summary_rows,
    'period_id', p_period_id,
    'pomdam_id', p_pomdam_id
  );
end;
$function$;

revoke all on function public.submit_sim_tni_pomdam_report(uuid, uuid, jsonb) from public, anon;
grant execute on function public.submit_sim_tni_pomdam_report(uuid, uuid, jsonb) to authenticated;

comment on function public.submit_sim_tni_pomdam_report(uuid, uuid, jsonb) is
  'Atomically validates and saves 25 SIM TNI activity facts, records the report submission, and derives five sim_records rows. Refuses source-linked/imported rows and cross-account revisions.';
