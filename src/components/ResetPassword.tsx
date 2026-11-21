import React, { useEffect, useState } from 'react';
import { KeyRound, Loader2 } from 'lucide-react';
import logoImage from 'figma:asset/21baad6507e62ba97c53b4e96400cc78fb54fe4c.png';
import { api, User } from '../lib/api';

interface ResetPasswordProps {
  /** from the link in the email */
  token: string;
  onDone: (user: User) => void;
  onRequestNew: () => void;
  onBack: () => void;
}

/** The page the emailed link opens: choose a new password, then straight into the app. */
export function ResetPassword({ token, onDone, onRequestNew, onBack }: ResetPasswordProps) {
  const [valid, setValid] = useState<boolean | null>(null);
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    api.resetCheck(token).then(({ valid }) => setValid(valid)).catch(() => setValid(false));
  }, [token]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (password !== confirm) return setError('รหัสผ่านทั้งสองช่องไม่ตรงกัน');
    setLoading(true);
    try {
      const { user } = await api.resetPassword(token, password);
      onDone(user);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="relative min-h-screen flex items-center justify-center bg-canvas p-4">
      <div className="w-full max-w-sm pb-sheet p-7 md:p-9">
        <div className="flex flex-col items-center text-center mb-7">
          <img src={logoImage} alt="" className="w-14 h-14 object-contain mb-4" />
          <h1 className="text-xl font-semibold text-ink tracking-tight">ตั้งรหัสผ่านใหม่</h1>
          <p className="text-sm text-ink-muted mt-1">
            {valid === false ? 'ลิงก์นี้ใช้ไม่ได้แล้ว' : 'ตั้งรหัสผ่านใหม่สำหรับบัญชี ProfitBloom ของคุณ'}
          </p>
        </div>

        {valid === null && (
          <div className="flex justify-center py-6">
            <Loader2 className="w-6 h-6 text-[#673AB7] animate-spin" />
          </div>
        )}

        {valid === false && (
          <div className="space-y-4">
            <div className="p-3 rounded-xl bg-rose-50 text-sm text-rose-700">
              ลิงก์ตั้งรหัสผ่านใช้ได้ครั้งเดียวและหมดอายุใน 1 ชั่วโมง กรุณาขอลิงก์ใหม่
            </div>
            <button type="button" onClick={onRequestNew} className="pb-btn-primary w-full !py-3">
              ขอลิงก์ใหม่
            </button>
          </div>
        )}

        {valid && (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="pb-label">รหัสผ่านใหม่</label>
              <input className="pb-input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="อย่างน้อย 8 ตัวอักษร" required minLength={8} autoComplete="new-password" autoFocus />
            </div>
            <div>
              <label className="pb-label">ยืนยันรหัสผ่านใหม่</label>
              <input className="pb-input" type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} required minLength={8} autoComplete="new-password" />
            </div>

            {error && <div className="p-3 rounded-xl bg-rose-50 text-sm text-rose-700">{error}</div>}

            <button type="submit" disabled={loading} className="pb-btn-primary w-full !py-3 mt-2">
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <KeyRound className="w-4 h-4" />}
              บันทึกรหัสผ่านใหม่
            </button>
            <p className="text-xs text-ink-muted text-center">เมื่อบันทึกแล้ว เครื่องอื่นที่เข้าสู่ระบบค้างไว้จะถูกออกจากระบบ</p>
          </form>
        )}
      </div>
      <button onClick={onBack} className="absolute top-5 left-5 text-sm text-ink-muted hover:text-ink">
        ← กลับหน้าแรก
      </button>
    </div>
  );
}
