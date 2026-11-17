// Checks on contact details typed into forms, shared by the API and the screens.

/**
 * '' when a phone number is acceptable (or left empty), otherwise a message for the user.
 * Accepts Thai numbers (9 digits for landlines, 10 for mobiles, starting with 0) and
 * international ones (+ and 8–15 digits), written with spaces, dashes or brackets,
 * with an optional extension: "02-123-4567 ต่อ 12".
 */
export function phoneError(value) {
  const text = String(value ?? '').trim();
  if (!text) return '';
  const number = text.replace(/\s*(ต่อ|ext\.?|#)\s*\d{1,6}$/i, '');
  const digits = number.replace(/\D/g, '');
  const ok = /^\+?[\d\s\-()]+$/.test(number) && (number.startsWith('+') ? digits.length >= 8 && digits.length <= 15 : /^0\d{8,9}$/.test(digits));
  return ok ? '' : 'เบอร์โทรศัพท์ไม่ถูกต้อง กรุณากรอกตัวเลข 9–10 หลัก เช่น 081-234-5678';
}
