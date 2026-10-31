-- Add covering indexes for the SIM TNI activity fact foreign keys.
create index sim_activity_records_pomdam_idx
  on public.sim_activity_records (pomdam_id);

create index sim_activity_records_activity_type_idx
  on public.sim_activity_records (sim_activity_type_id);

create index sim_activity_records_sim_type_idx
  on public.sim_activity_records (sim_type_id);

create index sim_activity_records_source_report_idx
  on public.sim_activity_records (source_report_id);

create index sim_activity_records_source_cell_idx
  on public.sim_activity_records (source_cell_id);

create index sim_activity_records_created_by_idx
  on public.sim_activity_records (created_by);

create index sim_activity_records_updated_by_idx
  on public.sim_activity_records (updated_by);
