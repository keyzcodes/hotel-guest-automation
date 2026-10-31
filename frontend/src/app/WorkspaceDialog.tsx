'use client';
import { useEffect, useRef } from 'react';
import styles from './operations.module.css';
// Native modal dialogs keep keyboard focus inside the form and make the
// background workspace inert. Closing returns focus to the original control.
export default function WorkspaceDialog({ children, label, busy = false, onClose }: { children: React.ReactNode; label: string; busy?: boolean; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const trigger = document.activeElement as HTMLElement | null;
    const dialog = ref.current;
    dialog?.showModal();
    return () => { dialog?.close(); if (trigger?.isConnected) trigger.focus(); };
  }, []);
  return <dialog ref={ref} className={styles.overlay} aria-label={label} onCancel={event => { event.preventDefault(); if (!busy) onClose(); }}>{children}</dialog>;
}
