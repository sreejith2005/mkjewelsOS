// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import type { UserProfile } from '@/types';
const access = vi.hoisted(() => ({ delete: false, manage: true }));
vi.mock('@/auth/AuthContext', () => ({ useAuth: () => ({ access: { permissions: { 'users.manage': access.manage, 'users.delete': access.delete } } }) }));
vi.mock('@jewelos/api-client', () => ({ supabase: {} }));
import { AddUserForm, EditUser } from './UserManagementPage';
const employee: UserProfile = {
 id:'person',auth_user_id:'auth',tenant_id:'tenant',branch_id:'branch',department_id:'department',employee_name:'Synthetic employee',employee_code:'TEST',email:'employee@example.in',user_role:'staff',account_status:'active',working_status:'active',is_login_enabled:true,week_off:[],
 buddy_id:null,secondary_buddy_id:null,reports_to_user_id:null,designation_id:null,first_name:null,last_name:null,username:null,personal_email:null,official_email:null,personal_mobile:null,official_mobile:null,created_at:null,updated_at:null,created_by:null,updated_by:null,
};
const data = { profiles:[employee], branches:[], departments:[], dropdowns:[] };
afterEach(() => { cleanup(); access.delete=false; access.manage=true; });
it('offers Delete user to an HR user explicitly granted the delete permission', () => {
 access.delete=true;
 render(<EditUser user={employee} data={data} superAdmin={false} onClose={() => {}} onSaved={async () => {}} />);
 expect(screen.getByRole('button',{name:'Delete user'})).toBeTruthy();
 expect(screen.queryByRole('button',{name:'Set password'})).toBeNull();
});
it('hides Delete user when the permission is denied', () => {
 render(<EditUser user={employee} data={data} superAdmin={false} onClose={() => {}} onSaved={async () => {}} />);
 expect(screen.queryByRole('button',{name:'Delete user'})).toBeNull();
});
it('keeps a delete-only account from editing profile fields', () => {
 access.delete=true; access.manage=false;
 render(<EditUser user={employee} data={data} superAdmin={false} onClose={() => {}} onSaved={async () => {}} />);
 expect(screen.getByRole('button',{name:'Delete user'})).toBeTruthy();
 expect(screen.queryByRole('button',{name:'Save user'})).toBeNull();
 expect(screen.getByLabelText('Employee name').closest('fieldset')?.disabled).toBe(true);
});
it('accepts .in personal and official emails in the real Add user form', () => {
 render(<AddUserForm data={data} role="hr" onClose={() => {}} onDone={async () => {}} />);
 for (const label of ['Personal email','Official email']) {
  const field=screen.getByLabelText(label);
  fireEvent.change(field,{target:{value:'employee@example.in'}});
  expect(field).toBeInstanceOf(HTMLInputElement);
  if (!(field instanceof HTMLInputElement)) throw new Error('Expected an email input');
  expect(field.checkValidity()).toBe(true);
 }
});
it('explains and focuses missing fields instead of silently blocking submission', () => {
 render(<AddUserForm data={data} role="hr" onClose={() => {}} onDone={async () => {}} />);
 const field=screen.getByLabelText('First name');
 fireEvent.invalid(field);
 expect(screen.getByText(/Complete the required fields: First name/)).toBeTruthy();
 expect(document.activeElement).toBe(field);
 expect(field.getAttribute('aria-invalid')).toBe('true');
 fireEvent.change(field,{target:{value:'Employee'}});
 fireEvent.input(field);
 expect(field.getAttribute('aria-invalid')).toBeNull();
});
