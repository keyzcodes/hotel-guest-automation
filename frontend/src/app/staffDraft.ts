// Whitelist draft fields. Never restore or persist a password.
export function staffDraft(raw: string | null): { name: string; email: string } | null {
  try {
    const value = JSON.parse(raw || 'null');
    if (!value || typeof value.name !== 'string' || typeof value.email !== 'string') return null;
    return { name: value.name.slice(0, 100), email: value.email.slice(0, 254) };
  } catch { return null; }
}
