-- Who may use/view which catalog file: the person who downloaded it, and anyone who bought access (1 credit, one time).
create table market_data_access (
  user_id uuid not null references users(id) on delete cascade,
  market_data_id uuid not null references market_data(id) on delete cascade,
  source text not null check (source in ('download', 'purchase')),
  created_at timestamptz not null default now(),
  primary key (user_id, market_data_id)
);
create index market_data_access_file on market_data_access (market_data_id);

insert into market_data_access(user_id, market_data_id, source, created_at)
select requested_by, id, 'download', created_at from market_data where requested_by is not null
on conflict do nothing;
