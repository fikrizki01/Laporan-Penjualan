import React, { useState } from 'react';
import { X, Lock, CheckCircle2, AlertCircle } from 'lucide-react';

interface PinModalProps {
  isOpen: boolean;
  onClose: () => void;
  onUnlock: (enteredPin: string) => Promise<{ success: boolean; error?: string } | boolean>;
}

export const PinModal: React.FC<PinModalProps> = ({
  isOpen,
  onClose,
  onUnlock,
}) => {
  const [pin, setPin] = useState('');
  const [err, setErr] = useState('');
  const [loading, setLoading] = useState(false);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!pin) return;
    setLoading(true);
    setErr('');
    try {
      const res = await onUnlock(pin);
      if (typeof res === 'boolean' ? res : res.success) {
        setPin('');
        onClose();
      } else {
        const errorMsg = typeof res === 'object' && res.error ? res.error : 'PIN salah, silakan coba lagi';
        setErr(errorMsg);
      }
    } catch {
      setErr('Terjadi kesalahan koneksi server');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs animate-fadeIn">
      <div className="bg-[var(--card)] text-[var(--tx)] border border-[var(--bd)] rounded-2xl w-full max-w-sm p-5 shadow-2xl space-y-4">
        <div className="flex items-center justify-between border-b border-[var(--bd)] pb-3">
          <div className="flex items-center gap-2">
            <Lock className="text-[var(--ac)]" size={18} />
            <h2 className="text-base font-bold text-[var(--tx)] m-0">
              Masuk Mode Pemilik
            </h2>
          </div>
          <button
            onClick={() => {
              setPin('');
              setErr('');
              onClose();
            }}
            className="p-1 rounded-lg text-[var(--mut)] hover:text-[var(--tx)] hover:bg-[var(--bg)]"
          >
            <X size={18} />
          </button>
        </div>

        <p className="text-xs text-[var(--mut)]">
          Masukkan nomor PIN pemilik untuk membuka akses penuh ke stok, pembelian, dan laporan laba/rugi.
        </p>

        <form onSubmit={handleSubmit} className="space-y-3">
          <input
            type="password"
            inputMode="numeric"
            maxLength={6}
            autoFocus
            placeholder="••••"
            value={pin}
            onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))}
            className="text-center font-mono-numbers text-3xl tracking-widest py-3"
          />

          {err && (
            <div className="text-xs text-red-500 font-medium flex items-center justify-center gap-1 text-center px-2">
              <AlertCircle size={14} className="shrink-0" /> <span>{err}</span>
            </div>
          )}

          <button
            type="submit"
            disabled={pin.length < 4 || loading}
            className="btn p text-base py-3"
          >
            {loading ? 'Memverifikasi...' : 'Buka Akses Pemilik'}
          </button>
        </form>
      </div>
    </div>
  );
};
