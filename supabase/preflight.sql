-- Read-only inventory. Confirm this is Trainwise's project before migration.
select table_schema, table_name
from information_schema.tables
where table_schema = 'public'
  and (table_name like 'fitness\_%' escape '\'
       or table_name like 'fantasy\_%' escape '\')
order by table_name;

select n.nspname as schema_name, p.proname as function_name,
       pg_get_function_identity_arguments(p.oid) as arguments
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and (p.proname like '%fantasy%' or p.proname = 'apply_fitness_sync_change')
order by p.proname;

select schemaname, tablename, policyname, roles, cmd, qual, with_check
from pg_policies
where schemaname = 'public'
  and (tablename like 'fitness\_%' escape '\'
       or tablename like 'fantasy\_%' escape '\')
order by tablename, policyname;
