create table run_files (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references runs(id) on delete cascade,
  filename text not null,
  content_type text not null,
  size_bytes bigint not null,
  blob_path text not null,
  created_at timestamptz not null default now()
);
create index run_files_run_idx on run_files(run_id);
