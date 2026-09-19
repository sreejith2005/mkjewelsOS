-- Voice-assigned tasks: a dedicated, configurable permission.
--
-- The interpret-task-voice worker first borrowed `tasks.manage_team`, an
-- `authority` key that follows dashboard authority (super_admin, admin,
-- manager) and cannot be overridden. The owner wants HR to record task voice
-- notes as well. Widening `tasks.manage_team` would widen HR's authority
-- everywhere that key is read, so voice capture gets its own `action` key:
-- defaulting to super_admin, admin, manager and hr, and adjustable per role,
-- designation and user from Settings -> Permissions.
--
-- The key only decides who may *interpret* a voice note into a draft. Creating
-- the task still goes through create_manual_task_with_mode_with_audit, which
-- applies each author's existing assignee scope unchanged.

-- The web client mirrors this list in packages/core/src/permissions/catalog.ts;
-- catalog.migration.test.ts parses the block below to keep them in parity.
-- permission-catalog:begin
insert into permission_catalog(key, kind, page_id, default_roles, sort_order) values
('tasks.voice_assign', 'action', null, '{super_admin,admin,manager,hr}', 45);
-- permission-catalog:end

notify pgrst, 'reload schema';
