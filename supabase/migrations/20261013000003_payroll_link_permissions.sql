-- Explicit least-privilege capability for payroll-to-payslip linking.
-- No existing role gains general station.write access from this permission.
insert into public.fuelpro_role_permissions (role, permission)
values
  ('manager', 'payroll.manage'),
  ('accountant', 'payroll.manage')
on conflict do nothing;
