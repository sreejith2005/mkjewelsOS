-- Metadata only. No customer rows, object paths, function bodies, or cron commands.
begin read only;
select jsonb_build_object(
 'captured_at', statement_timestamp(),
 'schemas', (select jsonb_agg(nspname order by nspname) from pg_namespace where nspname not like 'pg_%' and nspname <> 'information_schema'),
 'relations', (select jsonb_agg(jsonb_build_object(
   'schema',n.nspname,'name',c.relname,'kind',c.relkind,'rls',c.relrowsecurity,'force_rls',c.relforcerowsecurity,
   'anon_schema_usage',has_schema_privilege('anon',n.oid,'USAGE'),'authenticated_schema_usage',has_schema_privilege('authenticated',n.oid,'USAGE'),
   'anon_select',has_table_privilege('anon',c.oid,'SELECT'),'authenticated_select',has_table_privilege('authenticated',c.oid,'SELECT'),
   'estimated_rows',c.reltuples::bigint,'bytes',case when c.relkind in ('r','m','p') then pg_total_relation_size(c.oid) else null end,
   'last_analyze',s.last_analyze,'last_autoanalyze',s.last_autoanalyze,
   'policies',(select jsonb_agg(jsonb_build_object('name',pol.polname,'command',pol.polcmd)) from pg_policy pol where pol.polrelid=c.oid)
 ) order by n.nspname,c.relname)
 from pg_class c join pg_namespace n on n.oid=c.relnamespace left join pg_stat_all_tables s on s.relid=c.oid
 where n.nspname not like 'pg_%' and n.nspname <> 'information_schema' and c.relkind in ('r','p','v','m','f')),
 'functions', (select jsonb_agg(jsonb_build_object('schema',n.nspname,'name',p.proname,
   'arguments',oidvectortypes(p.proargtypes),'security_definer',p.prosecdef,'kind',p.prokind,
   'anon_execute',has_function_privilege('anon',p.oid,'EXECUTE'),'authenticated_execute',has_function_privilege('authenticated',p.oid,'EXECUTE'))
   order by n.nspname,p.proname,oidvectortypes(p.proargtypes))
 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname not like 'pg_%' and n.nspname <> 'information_schema'),
 'triggers', (select jsonb_agg(jsonb_build_object('schema',n.nspname,'table',c.relname,'name',t.tgname,
   'function_schema',pn.nspname,'function',p.proname,'enabled',t.tgenabled) order by n.nspname,c.relname,t.tgname)
 from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace
 join pg_proc p on p.oid=t.tgfoid join pg_namespace pn on pn.oid=p.pronamespace where not t.tgisinternal),
 'foreign_keys', (select jsonb_agg(jsonb_build_object('schema',n.nspname,'table',c.relname,'name',k.conname,
   'target_schema',tn.nspname,'target_table',tc.relname) order by n.nspname,c.relname,k.conname)
 from pg_constraint k join pg_class c on c.oid=k.conrelid join pg_namespace n on n.oid=c.relnamespace
 join pg_class tc on tc.oid=k.confrelid join pg_namespace tn on tn.oid=tc.relnamespace where k.contype='f'),
 'view_dependencies',(select jsonb_agg(distinct jsonb_build_object('schema',vn.nspname,'view',v.relname,'target_schema',tn.nspname,'target',t.relname))
 from pg_rewrite rw join pg_class v on v.oid=rw.ev_class join pg_namespace vn on vn.oid=v.relnamespace
 join pg_depend d on d.classid='pg_rewrite'::regclass and d.objid=rw.oid and d.refclassid='pg_class'::regclass
 join pg_class t on t.oid=d.refobjid join pg_namespace tn on tn.oid=t.relnamespace
 where v.relkind in ('v','m') and v.oid<>t.oid and vn.nspname not like 'pg_%' and vn.nspname<>'information_schema'),
 'buckets',(select jsonb_agg(jsonb_build_object('id',b.id,'public',b.public,'file_size_limit',b.file_size_limit,
    'allowed_mime_types',b.allowed_mime_types,'object_count',(select count(*) from storage.objects o where o.bucket_id=b.id),
    'reported_bytes',(select sum(case when o.metadata->>'size' ~ '^[0-9]+$' then (o.metadata->>'size')::numeric else 0 end) from storage.objects o where o.bucket_id=b.id))) from storage.buckets b)
) as catalog;
commit;
