import React, { useState } from 'react';
import { LogIn, Mail, UserPlus, Loader2 } from 'lucide-react';
import logoImage from 'figma:asset/21baad6507e62ba97c53b4e96400cc78fb54fe4c.png';
import { api, User } from '../lib/api';

export type AuthMode = 'login' | 'register' | 'forgot';

interface AuthScreenProps {
  onAuthenticated: (user: User) => void;
  initialMode?: AuthMode;
  onModeChange?: (mode: AuthMode) => void;
  onBack?: () => void;
}

export function AuthScreen({ onAuthenticated, initialMode = 'login', onModeChange, onBack }: AuthScreenProps) {
  const [mode, setMode] = useState<AuthMode>(initialMode);
  /** the address a reset link was just sent to */
  const [sentTo, setSentTo] = useState('');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      if (mode === 'forgot') {
        await api.forgotPassword(email);
        setSentTo(email);
        return;
      }
      const { user } = mode === 'login' ? await api.login(email, password) : await api.register(name, email, password);
      onAuthenticated(user);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const inputClass = 'pb-input';
  const switchMode = (m: AuthMode) => {
    setMode(m);
    setError('');
    setSentTo('');
    onModeChange?.(m);
  };

  return (
    <div className="relative min-h-screen flex items-center justify-center bg-canvas p-4">
      <div className="w-full max-w-sm pb-sheet p-7 md:p-9">
        <div className="flex flex-col items-center text-center mb-7">
          <img src={logoImage} alt="" className="w-14 h-14 object-contain mb-4" />
          <h1 className="text-xl font-semibold text-ink tracking-tight">
            {mode === 'login' ? 'เข้าสู่ ProfitBloom' : mode === 'register' ? 'สร้างบัญชี ProfitBloom' : 'ลืมรหัสผ่าน'}
          </h1>
          <p className="text-sm text-ink-muted mt-1">
            {mode === 'forgot' ? 'กรอกอีเมลที่ใช้สมัคร เราจะส่งลิงก์ตั้งรหัสผ่านใหม่ให้' : 'คำนวณต้นทุน กำไร และออกใบเสนอราคา'}
          </p>
        </div>

        {mode !== 'forgot' && (
        <div className="flex bg-canvas rounded-full p-1 mb-6">
          {(['login', 'register'] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => switchMode(m)}
              className={`flex-1 px-3 py-2 text-sm rounded-full transition-colors ${
                mode === m ? 'bg-white text-ink shadow-card font-medium' : 'text-ink-muted hover:text-ink'
              }`}
            >
              {m === 'login' ? 'เข้าสู่ระบบ' : 'สมัครสมาชิก'}
            </button>
          ))}
        </div>
        )}

        {sentTo ? (
          <div className="space-y-4">
            <div className="p-3 rounded-xl bg-emerald-50 text-sm text-emerald-700">
              ถ้า {sentTo} มีบัญชีอยู่ เราได้ส่งลิงก์ตั้งรหัสผ่านใหม่ไปให้แล้ว ลิงก์ใช้ได้ 1 ชั่วโมง ถ้าไม่เห็นอีเมล ลองดูในกล่องสแปม
            </div>
            <button type="button" onClick={() => switchMode('login')} className="pb-btn-secondary w-full !py-3">
              กลับไปเข้าสู่ระบบ
            </button>
          </div>
        ) : (
        <form onSubmit={handleSubmit} className="space-y-4">
          {mode === 'register' && (
            <div>
              <label className="pb-label">ชื่อ</label>
              <input className={inputClass} value={name} onChange={(e) => setName(e.target.value)} placeholder="เช่น สมใจ" required autoComplete="name" />
            </div>
          )}
          <div>
            <label className="pb-label">อีเมล</label>
            <input className={inputClass} type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@email.com" required autoComplete="email" />
          </div>
          {mode !== 'forgot' && (
          <div>
            <div className="flex items-baseline justify-between">
              <label className="pb-label">รหัสผ่าน</label>
              {mode === 'login' && (
                <button type="button" onClick={() => switchMode('forgot')} className="text-sm text-[#673AB7] hover:text-[#35235e] font-medium">
                  ลืมรหัสผ่าน?
                </button>
              )}
            </div>
            <input
              className={inputClass}
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={mode === 'register' ? 'อย่างน้อย 8 ตัวอักษร' : ''}
              required
              minLength={mode === 'register' ? 8 : undefined}
              autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
            />
          </div>
          )}

          {error && <div className="p-3 rounded-xl bg-rose-50 text-sm text-rose-700">{error}</div>}

          <button
            type="submit"
            disabled={loading}
            className="pb-btn-primary w-full !py-3 mt-2"
          >
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : mode === 'login' ? <LogIn className="w-4 h-4" /> : mode === 'register' ? <UserPlus className="w-4 h-4" /> : <Mail className="w-4 h-4" />}
            {mode === 'login' ? 'เข้าสู่ระบบ' : mode === 'register' ? 'สร้างบัญชี' : 'ส่งลิงก์ตั้งรหัสผ่านใหม่'}
          </button>
          {mode === 'forgot' && (
            <button type="button" onClick={() => switchMode('login')} className="w-full text-sm text-ink-muted hover:text-ink">
              ← กลับไปเข้าสู่ระบบ
            </button>
          )}
        </form>
        )}
      </div>
      {onBack && (
        <button onClick={onBack} className="absolute top-5 left-5 text-sm text-ink-muted hover:text-ink">
          ← กลับหน้าแรก
        </button>
      )}
    </div>
  );
}
