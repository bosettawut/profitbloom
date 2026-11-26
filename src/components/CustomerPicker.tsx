import React, { useEffect, useRef, useState } from 'react';
import { Plus } from 'lucide-react';
import { api, type PickedCustomer } from '../lib/api';
import { CustomerForm } from './Customers';

interface CustomerPickerProps {
  /** the client name shown in the box */
  value: string;
  /** typing a name by hand: the job is no longer tied to the customer picked before */
  onChange: (name: string) => void;
  /** a customer chosen from the list (or just added): fill in their contact details */
  onPick: (customer: PickedCustomer) => void;
  placeholder?: string;
  className?: string;
}

/**
 * The "client name" box on projects and quotes. It is the same text field as before; while typing,
 * the shop's matching customers drop down underneath, with a row to add a new one.
 * A name typed without picking is still saved: the server matches it to a customer or creates one.
 */
export function CustomerPicker({ value, onChange, onPick, placeholder = '', className = 'pb-input' }: CustomerPickerProps) {
  const [customers, setCustomers] = useState<PickedCustomer[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [adding, setAdding] = useState(false);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    api.customers().then(setCustomers).catch(() => {});
  }, []);

  useEffect(() => {
    if (!open) return;
    const outside = (e: MouseEvent) => {
      if (!box.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', outside);
    return () => document.removeEventListener('mousedown', outside);
  }, [open]);

  const term = value.trim().toLowerCase();
  const matches = customers
    .filter((c) => !term || c.name.toLowerCase().includes(term) || c.phone.replace(/\D/g, '').includes(term.replace(/\D/g, '') || '~'))
    .slice(0, 8);
  const exact = customers.some((c) => c.name.trim().toLowerCase() === term);
  const canAdd = !!term && !exact;
  const rows = matches.length + (canAdd ? 1 : 0);

  const pick = (c: PickedCustomer) => {
    onPick(c);
    setOpen(false);
    setActive(-1);
  };
  const choose = (index: number) => {
    if (index < matches.length) pick(matches[index]);
    else {
      setOpen(false);
      setAdding(true);
    }
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (!open || rows === 0) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((i) => (i + 1) % rows);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((i) => (i <= 0 ? rows - 1 : i - 1));
    } else if (e.key === 'Enter' && active >= 0) {
      e.preventDefault();
      choose(active);
    } else if (e.key === 'Escape') {
      setOpen(false);
    }
  };

  return (
    <div ref={box} className="relative">
      <input
        type="text"
        role="combobox"
        aria-expanded={open && rows > 0}
        aria-autocomplete="list"
        autoComplete="off"
        className={className}
        placeholder={placeholder}
        value={value}
        onFocus={() => setOpen(true)}
        onKeyDown={onKeyDown}
        onChange={(e) => {
          onChange(e.target.value);
          setOpen(true);
          setActive(-1);
        }}
      />
      {open && rows > 0 && (
        <ul role="listbox" className="absolute z-30 left-0 min-w-full w-56 mt-1.5 bg-white rounded-2xl border border-line shadow-soft-xl max-h-64 overflow-y-auto p-1.5">
          {matches.map((c, i) => (
            <li key={c.id} role="option" aria-selected={active === i}>
              <button
                type="button"
                onMouseEnter={() => setActive(i)}
                onClick={() => pick(c)}
                className={`w-full px-3 py-2 rounded-xl text-left ${active === i ? 'bg-[#F7F6FA]' : ''}`}
              >
                <span className="block text-sm font-medium text-ink truncate">{c.name}</span>
                {c.phone && <span className="block text-xs text-ink-muted truncate">{c.phone}</span>}
              </button>
            </li>
          ))}
          {canAdd && (
            <li role="option" aria-selected={active === matches.length}>
              <button
                type="button"
                onMouseEnter={() => setActive(matches.length)}
                onClick={() => choose(matches.length)}
                className={`w-full flex items-center gap-2 px-3 py-2 rounded-xl text-left text-sm font-medium text-[#673AB7] ${active === matches.length ? 'bg-[#F7F6FA]' : ''}`}
              >
                <Plus className="w-4 h-4 shrink-0" />
                <span className="truncate">เพิ่มลูกค้าใหม่ “{value.trim()}”</span>
              </button>
            </li>
          )}
        </ul>
      )}
      {adding && (
        <CustomerForm
          initialName={value.trim()}
          onClose={() => setAdding(false)}
          onSaved={(c) => {
            setAdding(false);
            setCustomers((list) => [...list, c]);
            onPick(c);
          }}
        />
      )}
    </div>
  );
}
