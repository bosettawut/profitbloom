import React from 'react';
import { Ban, Check, CircleCheck, Clock, FileText, Flag, PencilLine, Send, ThumbsDown, X, type LucideIcon } from 'lucide-react';
import type { Project, ProjectStatus, QuoteStatus } from '../lib/api';
import { statusPill } from './ProjectItem';

export interface StatusOption<T extends string = string> {
  id: T;
  name: string;
  description: string;
  icon: LucideIcon;
}

export const PROJECT_STATUS_OPTIONS: StatusOption<ProjectStatus>[] = [
  { id: 'draft', name: 'ร่าง', description: 'ยังเตรียมงานอยู่ ยังไม่ได้ส่งราคา', icon: PencilLine },
  { id: 'quote_created', name: 'สร้างใบเสนอราคาแล้ว', description: 'มีใบเสนอราคาแล้ว พร้อมส่งให้ลูกค้า', icon: FileText },
  { id: 'pending', name: 'รอการอนุมัติ', description: 'ส่งใบเสนอราคาแล้ว รอลูกค้าตอบกลับ', icon: Clock },
  { id: 'approved', name: 'อนุมัติแล้ว', description: 'ลูกค้าตกลงแล้ว เริ่มทำงานได้', icon: CircleCheck },
  { id: 'rejected', name: 'ลูกค้าปฏิเสธ', description: 'ลูกค้าไม่ตกลงราคา แก้ราคาที่โปรเจ็กต์แล้วส่งใบเสนอราคาใหม่', icon: ThumbsDown },
  { id: 'completed', name: 'เสร็จสิ้น', description: 'จัดงานเสร็จและปิดงานแล้ว', icon: Flag },
  { id: 'cancelled', name: 'ยกเลิก', description: 'ไม่ทำงานนี้แล้ว (ใบเสนอราคายกเลิกด้วย)', icon: Ban },
];

export const QUOTE_STATUS_OPTIONS: StatusOption<QuoteStatus>[] = [
  { id: 'draft', name: 'ร่าง', description: 'ยังไม่ได้ส่งให้ลูกค้า', icon: PencilLine },
  { id: 'sent', name: 'ส่งแล้ว', description: 'ส่งให้ลูกค้าแล้ว รอลูกค้าตอบกลับ', icon: Send },
  { id: 'approved', name: 'อนุมัติแล้ว', description: 'ลูกค้าตกลงราคาแล้ว', icon: CircleCheck },
  { id: 'rejected', name: 'ปฏิเสธ', description: 'ลูกค้าไม่ตกลงราคา แก้ราคาแล้วส่งใหม่ได้', icon: ThumbsDown },
  { id: 'cancelled', name: 'ยกเลิก', description: 'ไม่ทำงานนี้แล้ว', icon: Ban },
];

const QUOTE_STAGE: ProjectStatus[] = ['quote_created', 'pending', 'rejected'];

/**
 * Why a job cannot be put in a status (null when it can), as the server decides it: a job with its quote is past the
 * draft, the quote statuses need a quote, and a job is only finished once the customer has approved it.
 */
export const projectStatusBlock = (project: Pick<Project, 'status' | 'quote'>) => (next: ProjectStatus): string | null => {
  if (next === project.status) return null;
  const hasQuote = !!project.quote;
  if (next === 'draft' && hasQuote) return 'มีใบเสนอราคาแล้ว';
  if (QUOTE_STAGE.includes(next) && !hasQuote) return 'ยังไม่มีใบเสนอราคา';
  if (next === 'completed' && project.status !== 'approved') return 'ได้เมื่อลูกค้าอนุมัติแล้ว';
  return null;
};

interface StatusDialogProps<T extends string> {
  title: string;
  /** what is having its status changed, e.g. the job's name */
  subject: string;
  options: StatusOption<T>[];
  current: string;
  /** why an option cannot be picked (it is shown faded, with the reason), or null */
  blocked?: (id: T) => string | null;
  /** a line above the options: what else the change does ('info'), or something to know first ('warn', e.g. a quote past its date) */
  note?: string;
  noteTone?: 'info' | 'warn';
  onPick: (id: T) => void;
  onClose: () => void;
}

/** The dialog that changes a job's or a quote's status: one row per status, with its icon and what it means. */
export function StatusDialog<T extends string>({ title, subject, options, current, blocked, note, noteTone = 'info', onPick, onClose }: StatusDialogProps<T>) {
  return (
    <div className="fixed inset-0 z-50 bg-[#221A33]/40 backdrop-blur-[2px] flex items-center justify-center p-4" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-label={title} className="bg-white rounded-[24px] shadow-soft-2xl max-w-md w-full max-h-[90vh] overflow-y-auto p-6" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-4 mb-1">
          <h3 className="text-lg font-semibold text-ink">{title}</h3>
          <button type="button" onClick={onClose} aria-label="ปิด" className="p-1.5 rounded-full text-ink-muted hover:bg-[#F1F0F5]"><X className="w-4 h-4" /></button>
        </div>
        <p className="text-sm text-ink-muted mb-4 line-clamp-2">{subject}</p>
        {note && <p className={`text-sm rounded-xl px-3 py-2 mb-3 ${noteTone === 'warn' ? 'text-orange-700 bg-orange-50' : 'text-ink-muted bg-[#F7F6FA]'}`}>{note}</p>}

        <div className="flex flex-col gap-1">
          {options.map((option) => {
            const isCurrent = current === option.id;
            const reason = isCurrent ? null : blocked?.(option.id) ?? null;
            const Icon = option.icon;
            return (
              <button
                key={option.id}
                type="button"
                onClick={() => !reason && !isCurrent && onPick(option.id)}
                disabled={!!reason}
                aria-current={isCurrent || undefined}
                title={reason ?? undefined}
                className={`flex items-center gap-3 w-full text-left px-3 py-2.5 rounded-2xl transition-colors disabled:cursor-not-allowed ${
                  isCurrent ? 'bg-[#F1F0F5]' : reason ? 'opacity-45' : 'hover:bg-[#F1F0F5]/60'
                }`}
              >
                <span className={`flex items-center justify-center w-9 h-9 shrink-0 rounded-full border ${statusPill(option.id)}`}>
                  <Icon className="w-4 h-4" />
                </span>
                <span className="flex-1 min-w-0">
                  <span className="block text-sm font-medium text-ink">{option.name}</span>
                  <span className="block text-xs text-ink-muted">{reason ? `เลือกไม่ได้: ${reason}` : option.description}</span>
                </span>
                {isCurrent && <Check className="w-4 h-4 shrink-0 text-[#673AB7]" aria-label="สถานะปัจจุบัน" />}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
