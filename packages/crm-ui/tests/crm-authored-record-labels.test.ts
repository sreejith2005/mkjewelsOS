// @vitest-environment jsdom
import {expect,it} from 'vitest';
import {labelTableCells} from '@/crm-port/mobile-tables';
it('preserves authored responsive labels while retaining desktop listing support',()=>{
 const root=document.createElement('div');
 root.innerHTML='<table class="crm-record-table"><thead><tr><th>CRM/DOER</th><th>REFERRAL NAME</th><th>REFERRAL NUMBER</th><th>ACTION</th></tr></thead><tbody><tr><td data-label="Staff">A</td><td data-label="Referral name">Person</td><td data-label="Phone">Phone</td><td data-label="Action">Action</td></tr></tbody></table>';
 labelTableCells(root);
 expect(root.querySelectorAll('td')[1].getAttribute('data-label')).toBe('Referral name');
 expect(root.querySelector('table')?.hasAttribute('data-crm-cards')).toBe(true);
});
