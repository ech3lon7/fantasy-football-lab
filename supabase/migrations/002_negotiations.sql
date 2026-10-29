begin;
-- Private negotiation history has its own limits/revisions and never touches Trainwise or the player dataset contract.
create table if not exists public.fantasy_negotiation_records (
 user_id uuid not null references public.fantasy_workspaces(user_id) on delete cascade,
 record_id text not null check(length(record_id) between 1 and 150),
 kind text not null check(kind in ('offer','profile','forecast','context')),
 payload jsonb not null check(jsonb_typeof(payload)='object' and octet_length(payload::text)<=524288),
 revision bigint not null default 1, request_id uuid not null, updated_at timestamptz not null default now(),
 primary key(user_id,record_id)
);
-- Authenticated access is always scoped to the caller; forecasts are written only through the immutable RPC.
alter table public.fantasy_negotiation_records enable row level security;
drop policy if exists fantasy_negotiation_read on public.fantasy_negotiation_records;
create policy fantasy_negotiation_read on public.fantasy_negotiation_records for select to authenticated using(user_id=auth.uid());
revoke all on public.fantasy_negotiation_records from public,anon,authenticated;
grant select on public.fantasy_negotiation_records to authenticated;
create or replace function public.get_fantasy_negotiations(p_owner uuid) returns setof public.fantasy_negotiation_records
language sql security invoker set search_path='' as $$ select * from public.fantasy_negotiation_records where user_id=auth.uid() and user_id=p_owner; $$;
-- Lock each account/record identity before insertion or revision checks, including concurrent first writes.
create or replace function public.put_fantasy_negotiation(p_owner uuid,p_id text,p_kind text,p_payload jsonb,p_expected_revision bigint,p_request_id uuid)
returns public.fantasy_negotiation_records language plpgsql security definer set search_path='' as $$
declare who uuid:=auth.uid(); old public.fantasy_negotiation_records;
begin
 if who is null or who is distinct from p_owner then raise exception 'AUTH_REQUIRED'; end if;
 if p_id is null or length(p_id) not between 1 and 150 or p_kind not in ('offer','profile','forecast','context') or p_kind is null or p_payload is null or jsonb_typeof(p_payload)<>'object' or octet_length(p_payload::text)>524288 or p_request_id is null then raise exception 'INVALID_NEGOTIATION';end if;
 if not exists(select 1 from public.fantasy_workspaces where user_id=who) then raise exception 'WORKSPACE_MISSING';end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(who::text||':'||p_id,0));
 select * into old from public.fantasy_negotiation_records where user_id=who and record_id=p_id for update;
 if found then
  if old.request_id=p_request_id then if old.kind=p_kind and old.payload=p_payload then return old;else raise exception 'REQUEST_ID_REUSED';end if;end if;
  if old.kind<>p_kind or (old.kind='forecast' and old.payload<>p_payload) then raise exception 'IMMUTABLE_FORECAST';end if;
  if old.revision<>p_expected_revision then raise exception 'CONFLICT_NEGOTIATION';end if;
  update public.fantasy_negotiation_records set payload=p_payload,revision=revision+1,request_id=p_request_id,updated_at=now() where user_id=who and record_id=p_id returning * into old;
 else
  if p_expected_revision<>0 or p_expected_revision is null then raise exception 'CONFLICT_NEGOTIATION';end if;
  insert into public.fantasy_negotiation_records(user_id,record_id,kind,payload,request_id) values(who,p_id,p_kind,p_payload,p_request_id) returning * into old;
 end if;
 return old;
end $$;
revoke execute on function public.get_fantasy_negotiations(uuid),public.put_fantasy_negotiation(uuid,text,text,jsonb,bigint,uuid) from public,anon;
grant execute on function public.get_fantasy_negotiations(uuid),public.put_fantasy_negotiation(uuid,text,text,jsonb,bigint,uuid) to authenticated;
commit;
