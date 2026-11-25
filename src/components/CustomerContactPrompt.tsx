import React, { useRef, useState } from 'react';
import { api, type Customer } from '../lib/api';

/** the contact details on a project or quote that is about to be saved */
export interface TypedContact {
  /** the customer picked from the list, if one was */
  customerId: string | null;
  name: string;
  phone: string;
  email: string;
  /** a quote's days of credit (a project has none) */
  creditDays?: number;
}

interface Difference {
  label: string;
  kept: string;
  typed: string;
}

const samePhone = (a: string, b: string) => a.replace(/\D/g, '') === b.replace(/\D/g, '');
const sameEmail = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

/** what the customer's record says differently; a field the customer has empty is not a difference (it is simply filled in) */
function differences(customer: Customer, typed: TypedContact): Difference[] {
  const out: Difference[] = [];
  if (typed.phone.trim() && customer.phone && !samePhone(typed.phone, customer.phone)) out.push({ label: 'เบอร์โทรศัพท์', kept: customer.phone, typed: typed.phone.trim() });
  if (typed.email.trim() && customer.email && !sameEmail(typed.email, customer.email)) out.push({ label: 'อีเมล', kept: customer.email, typed: typed.email.trim() });
  const credit = typed.creditDays ?? 0;
  if (credit > 0 && customer.creditDays > 0 && credit !== customer.creditDays) out.push({ label: 'เครดิต', kept: `${customer.creditDays} วัน`, typed: `${credit} วัน` });
  return out;
}

/**
 * Before saving a project or quote: when its phone number or email (or a quote's days of credit) differs from what
 * the customer's record holds, asks whether the customer should be updated or the new details are for this job only.
 *
 * `ask` resolves to true (update the customer), false (this job only, or nothing to ask) or
 * null (the dialog was closed: do not save). Pass `unchangedFrom` when editing, so a document whose
 * contact details were left as they were does not ask again every time it is saved.
 */
export function useCustomerContactPrompt() {
  const [open, setOpen] = useState<{ customer: Customer; diffs: Difference[] } | null>(null);
  const answer = useRef<(value: boolean | null) => void>(() => {});

  const ask = async (typed: TypedContact, unchangedFrom?: TypedContact): Promise<boolean | null> => {
    if (
      unchangedFrom && unchangedFrom.customerId === typed.customerId && unchangedFrom.name === typed.name && unchangedFrom.phone === typed.phone && unchangedFrom.email === typed.email &&
      (unchangedFrom.creditDays ?? 0) === (typed.creditDays ?? 0)
    ) return false;
    let customers: Customer[];
    try {
      customers = await api.customers();
    } catch {
      return false; // the save itself will report a lost connection
    }
    const name = typed.name.trim().toLowerCase();
    // a name typed without picking is matched to a customer by the server the same way
    const customer = typed.customerId ? customers.find((c) => c.id === typed.customerId) : name ? customers.find((c) => c.name.trim().toLowerCase() === name) : undefined;
    const diffs = customer ? differences(customer, typed) : [];
    if (!customer || diffs.length === 0) return false;
    return new Promise((resolve) => {
      answer.current = (value) => {
        setOpen(null);
        resolve(value);
      };
      setOpen({ customer, diffs });
    });
  };

  const node = open ? (
    <div className="fixed inset-0 z-50 bg-[#221A33]/40 backdrop-blur-[2px] flex items-center justify-center p-4" onClick={() => answer.current(null)}>
      <div role="dialog" aria-modal="true" aria-label="อัปเดตข้อมูลลูกค้า" className="bg-white rounded-[24px] shadow-soft-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto p-6" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-lg font-semibold text-ink mb-1">{open.diffs.some((d) => d.label === 'เครดิต') ? 'ข้อมูลลูกค้าไม่ตรงกับที่จำไว้' : 'ข้อมูลติดต่อไม่ตรงกับที่จำไว้'}</h3>
        <p className="text-sm text-ink-muted mb-4">
          ข้อมูลที่กรอกต่างจากที่บันทึกไว้ของ <span className="font-medium text-ink">{open.customer.name}</span> ต้องการให้จำข้อมูลใหม่กับลูกค้ารายนี้ด้วยหรือไม่
        </p>
        <div className="space-y-3">
          {open.diffs.map((d) => (
            <div key={d.label} className="rounded-2xl bg-[#F7F6FA] p-4 text-sm">
              <p className="pb-label">{d.label}</p>
              <p className="text-ink-muted break-words">ที่จำไว้: {d.kept}</p>
              <p className="text-ink font-medium break-words">ที่กรอก: {d.typed}</p>
            </div>
          ))}
        </div>
        <p className="text-xs text-ink-muted mt-4">โปรเจ็กต์และใบเสนอราคาเก่าของลูกค้ารายนี้จะไม่ถูกแก้</p>
        <div className="flex flex-col sm:flex-row gap-2 justify-end mt-6">
          <button type="button" onClick={() => answer.current(false)} className="pb-btn-secondary">ใช้กับงานนี้เท่านั้น</button>
          <button type="button" onClick={() => answer.current(true)} className="pb-btn-primary">อัปเดตข้อมูลลูกค้า</button>
        </div>
      </div>
    </div>
  ) : null;

  return { ask, node };
}
