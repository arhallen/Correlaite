-- Shared catalog of files downloaded from Alpha Vantage. Readable by every signed-in user.
-- `params` holds only non-secret request parameters (never the API key).
create table market_data (
  id uuid primary key default gen_random_uuid(),
  function text not null,
  symbol text not null,
  market text,
  params jsonb not null default '{}',
  filename text not null,
  blob_path text not null,
  size_bytes bigint not null,
  row_count integer,
  requested_by uuid references users(id) on delete set null,
  created_at timestamptz not null default now()
);
create index market_data_created on market_data (created_at desc);
create index market_data_lookup on market_data (function, symbol, market);

-- Runs can use several sources: the user's own datasets and/or catalog files.
alter table runs add column dataset_ids uuid[] not null default '{}';
alter table runs add column market_data_ids uuid[] not null default '{}';
update runs set dataset_ids = array[dataset_id] where dataset_id is not null;
