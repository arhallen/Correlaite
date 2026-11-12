-- Credit balance per user plus an append-only ledger of everything that changed it.
alter table users add column credits integer not null default 100 check (credits >= 0);
alter table runs add column credits_charged integer not null default 0;

create table credit_transactions (
  id bigserial primary key,
  user_id uuid not null references users(id) on delete cascade,
  amount integer not null,            -- positive = added, negative = spent
  balance_after integer not null,
  kind text not null,                 -- signup_bonus | purchase | download | run | refund
  description text not null,
  meta jsonb,
  created_at timestamptz not null default now()
);
create index credit_transactions_user on credit_transactions (user_id, created_at desc, id desc);

-- Existing users received the default balance when the column was added; record it in the ledger.
insert into credit_transactions(user_id, amount, balance_after, kind, description)
select id, 100, 100, 'signup_bonus', 'Welcome credits' from users;
