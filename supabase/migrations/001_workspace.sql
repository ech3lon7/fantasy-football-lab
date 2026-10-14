-- Fantasy-only objects. Does not modify Trainwise tables or policies.
begin;
create table if not exists public.fantasy_workspaces (
 user_id uuid primary key references auth.users(id) on delete cascade,
 dataset jsonb,
 dataset_schema_version integer,
 adapter_version text,
 model_version text,
 dataset_hash text,
 dataset_revision bigint not null default 0,
 source_refresh_utc timestamptz,
 imported_at timestamptz,
 state jsonb not null,
 state_revision bigint not null default 0,
 last_dataset_request_id uuid,
 last_state_request_id uuid,
 updated_at timestamptz not null default now(),
 constraint fantasy_payload_size check (octet_length(coalesce(dataset::text,'')) <= 10485760 and octet_length(state::text)<=65536)
);
alter table public.fantasy_workspaces enable row level security;
revoke all on public.fantasy_workspaces from public,anon,authenticated;
grant select on public.fantasy_workspaces to authenticated;
drop policy if exists fantasy_read_own on public.fantasy_workspaces;
create policy fantasy_read_own on public.fantasy_workspaces for select to authenticated using ((select auth.uid())=user_id);

create or replace function public.validate_fantasy_state(p_state jsonb) returns void language plpgsql set search_path='' as $$
declare item record;
begin
 if p_state is null or jsonb_typeof(p_state)<>'object' or octet_length(p_state::text)>65536 or not(p_state?'preferredTeam' and p_state?'settings' and p_state?'draft' and p_state?'filters') then raise exception 'INVALID_STATE';end if;
 if jsonb_typeof(p_state->'settings')<>'object' or jsonb_typeof(p_state->'draft')<>'object' or jsonb_typeof(p_state->'filters')<>'object' then raise exception 'INVALID_STATE';end if;
 for item in select * from jsonb_each(p_state->'settings') loop if jsonb_typeof(item.value)<>'number' then raise exception 'INVALID_SETTING';end if;end loop;
 if not((p_state->'settings')?'Premium') or (p_state#>>'{settings,Premium}')::numeric not between .25 and .35 then raise exception 'INVALID_PREMIUM';end if;
 if coalesce(jsonb_typeof(p_state#>'{draft,give}'),'')<>'array' or coalesce(jsonb_typeof(p_state#>'{draft,get}'),'')<>'array' or coalesce(jsonb_typeof(p_state#>'{draft,teamA}'),'')<>'string' or coalesce(jsonb_typeof(p_state#>'{draft,teamB}'),'')<>'string' then raise exception 'INVALID_DRAFT';end if;
 if jsonb_array_length(p_state#>'{draft,give}')>5 or jsonb_array_length(p_state#>'{draft,get}')>5 then raise exception 'INVALID_DRAFT';end if;
end $$;

create or replace function public.get_fantasy_workspace() returns setof public.fantasy_workspaces language sql security invoker set search_path='' as $$
 select * from public.fantasy_workspaces where user_id=auth.uid();
$$;

create or replace function public.initialize_fantasy_workspace(p_state jsonb) returns public.fantasy_workspaces language plpgsql security definer set search_path='' as $$
declare who uuid:=auth.uid();result public.fantasy_workspaces;
begin
 if who is null then raise exception 'AUTH_REQUIRED';end if;
 perform public.validate_fantasy_state(p_state);
 insert into public.fantasy_workspaces(user_id,state) values(who,p_state) on conflict(user_id) do nothing;
 select * into result from public.fantasy_workspaces where user_id=who;
 return result;
end $$;

create or replace function public.replace_fantasy_dataset(p_expected_revision bigint,p_request_id uuid,p_dataset jsonb) returns public.fantasy_workspaces language plpgsql security definer set search_path='' as $$
declare who uuid:=auth.uid();old public.fantasy_workspaces;new_state jsonb;give jsonb;get jsonb;table_name text;allowed text[]:=array['ModelContext','ModelTeams','ModelPlayers','ModelHistory','ModelSchedule','ModelRosters'];
begin
 if who is null then raise exception 'AUTH_REQUIRED';end if;
 select * into old from public.fantasy_workspaces where user_id=who for update;
 if not found then raise exception 'WORKSPACE_MISSING';end if;
 if p_request_id is null or p_dataset is null or jsonb_typeof(p_dataset)<>'object' or octet_length(p_dataset::text)>10485760 then raise exception 'INVALID_DATASET';end if;
 if old.last_dataset_request_id=p_request_id then if old.dataset=p_dataset then return old;else raise exception 'REQUEST_ID_REUSED';end if;end if;
 if old.dataset_revision<>p_expected_revision then raise exception 'CONFLICT_DATASET';end if;
 if coalesce(p_dataset->>'schemaVersion','')<>'1' or coalesce(p_dataset->>'adapterVersion','')<>'v5.2' or coalesce(jsonb_typeof(p_dataset->'tables'),'')<>'object' or coalesce(length(p_dataset->>'hash'),0)<>64 then raise exception 'INVALID_DATASET_SCHEMA';end if;
 foreach table_name in array allowed loop
  if coalesce(jsonb_typeof(p_dataset->'tables'->table_name),'')<>'array' then raise exception 'INVALID_TABLE';end if;
  if jsonb_array_length(p_dataset->'tables'->table_name)>(case when table_name='ModelHistory' then 40000 else 10000 end) then raise exception 'TOO_MANY_ROWS';end if;
 end loop;
 if jsonb_array_length(p_dataset#>'{tables,ModelContext}')<>1 or jsonb_array_length(p_dataset#>'{tables,ModelPlayers}')<1 then raise exception 'MISSING_MODEL_DATA';end if;
 -- Retain only still-owned draft selections; state revision changes if reconciliation changes state.
 select coalesce(jsonb_agg(x.value),'[]'::jsonb) into give from jsonb_array_elements(old.state#>'{draft,give}') x where exists(select 1 from jsonb_array_elements(p_dataset#>'{tables,ModelPlayers}') p where p->>'PlayerID'=x.value#>>'{}' and p->>'OnTeamID'=old.state#>>'{draft,teamA}');
 select coalesce(jsonb_agg(x.value),'[]'::jsonb) into get from jsonb_array_elements(old.state#>'{draft,get}') x where exists(select 1 from jsonb_array_elements(p_dataset#>'{tables,ModelPlayers}') p where p->>'PlayerID'=x.value#>>'{}' and p->>'OnTeamID'=old.state#>>'{draft,teamB}');
 new_state=jsonb_set(jsonb_set(old.state,'{draft,give}',give),'{draft,get}',get);
 update public.fantasy_workspaces set dataset=p_dataset,dataset_schema_version=1,adapter_version=p_dataset->>'adapterVersion',model_version=p_dataset->>'modelVersion',dataset_hash=p_dataset->>'hash',dataset_revision=dataset_revision+1,source_refresh_utc=nullif(p_dataset->>'sourceUTC','')::timestamptz,imported_at=(p_dataset->>'importedAt')::timestamptz,state=new_state,state_revision=state_revision+case when state<>new_state then 1 else 0 end,last_dataset_request_id=p_request_id,updated_at=now() where user_id=who returning * into old;
 return old;
end $$;

create or replace function public.update_fantasy_state(p_expected_revision bigint,p_dataset_revision bigint,p_request_id uuid,p_state jsonb) returns public.fantasy_workspaces language plpgsql security definer set search_path='' as $$
declare who uuid:=auth.uid();old public.fantasy_workspaces;
begin
 if who is null then raise exception 'AUTH_REQUIRED';end if;
 perform public.validate_fantasy_state(p_state);
 select * into old from public.fantasy_workspaces where user_id=who for update;
 if not found then raise exception 'WORKSPACE_MISSING';end if;
 if p_request_id is null then raise exception 'REQUEST_ID_REQUIRED';end if;
 if old.last_state_request_id=p_request_id then if old.state=p_state then return old;else raise exception 'REQUEST_ID_REUSED';end if;end if;
 if old.state_revision<>p_expected_revision or old.dataset_revision<>p_dataset_revision then raise exception 'CONFLICT_STATE';end if;
 update public.fantasy_workspaces set state=p_state,state_revision=state_revision+1,last_state_request_id=p_request_id,updated_at=now() where user_id=who returning * into old;
 return old;
end $$;

create or replace function public.delete_fantasy_workspace() returns void language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null then raise exception 'AUTH_REQUIRED';end if;
 delete from public.fantasy_workspaces where user_id=auth.uid();
end $$;

revoke execute on function public.validate_fantasy_state(jsonb) from public,anon,authenticated;
revoke execute on function public.get_fantasy_workspace(), public.initialize_fantasy_workspace(jsonb),public.replace_fantasy_dataset(bigint,uuid,jsonb),public.update_fantasy_state(bigint,bigint,uuid,jsonb),public.delete_fantasy_workspace() from public,anon;
grant execute on function public.get_fantasy_workspace(), public.initialize_fantasy_workspace(jsonb),public.replace_fantasy_dataset(bigint,uuid,jsonb),public.update_fantasy_state(bigint,bigint,uuid,jsonb),public.delete_fantasy_workspace() to authenticated;
commit;
