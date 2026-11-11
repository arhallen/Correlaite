create table users (
  id uuid primary key default gen_random_uuid(),
  email text not null unique,
  role text not null default 'user' check (role in ('user','admin')),
  disabled boolean not null default false,
  created_at timestamptz not null default now(),
  last_login_at timestamptz
);

create table login_tokens (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  token_hash text not null unique,
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);
create index login_tokens_email_created on login_tokens (email, created_at desc);

create table sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  token_hash text not null unique,
  expires_at timestamptz not null,
  user_agent text,
  created_at timestamptz not null default now()
);
create index sessions_user on sessions (user_id);

create table datasets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  filename text not null,
  blob_path text not null,
  size_bytes bigint not null,
  created_at timestamptz not null default now()
);
create index datasets_user on datasets (user_id, created_at desc);

create table runs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  dataset_id uuid references datasets(id) on delete set null,
  prompt text not null,
  code text,
  status text not null default 'running' check (status in ('running','success','error')),
  stdout text,
  stderr text,
  result text,
  duration_ms integer,
  created_at timestamptz not null default now()
);
create index runs_user on runs (user_id, created_at desc);
create index runs_created on runs (created_at desc);

create table usage_events (
  id bigserial primary key,
  user_id uuid references users(id) on delete set null,
  kind text not null,
  quantity integer not null default 1,
  meta jsonb,
  created_at timestamptz not null default now()
);
create index usage_events_kind_created on usage_events (kind, created_at desc);

create table admin_audit (
  id bigserial primary key,
  admin_id uuid references users(id) on delete set null,
  action text not null,
  target_user_id uuid,
  detail jsonb,
  created_at timestamptz not null default now()
);
