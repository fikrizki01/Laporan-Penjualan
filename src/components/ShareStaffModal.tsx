import React, { useState, useEffect } from 'react';
import QRCode from 'qrcode';
import { X, Copy, Check, Lock, ShieldCheck, Smartphone, KeyRound, Plus } from 'lucide-react';

interface ShareStaffModalProps {
  isOpen: boolean;
  onClose: () => void;
  onCreateStaffToken: (label: string) => Promise<{ token: string; label: string } | null>;
  onChangePin: (newPin: string) => Promise<boolean>;
}

export const ShareStaffModal: React.FC<ShareStaffModalProps> = ({
  isOpen,
  onClose,
  onCreateStaffToken,
  onChangePin,
}) => {
  const [activeStaffToken, setActiveStaffToken] = useState<{ token: string; label: string } | null>(null);
  const [qrDataUrl, setQrDataUrl] = useState<string>('');
  const [copied, setCopied] = useState<boolean>(false);
  const [isEditingPin, setIsEditingPin] = useState<boolean>(false);
  const [newPinInput, setNewPinInput] = useState<string>('');
  const [pinMsg, setPinMsg] = useState<string>('');
  const [loadingToken, setLoadingToken] = useState<boolean>(false);

  // When modal opens and no active staff token yet, create or load one
  useEffect(() => {
    if (isOpen && !activeStaffToken) {
      setLoadingToken(true);
      onCreateStaffToken('HP Kasir')
        .then((res) => {
          if (res) setActiveStaffToken(res);
        })
        .finally(() => setLoadingToken(false));
    }
  }, [isOpen, activeStaffToken, onCreateStaffToken]);

  const staffUrl = typeof window !== 'undefined' && activeStaffToken
    ? `${window.location.origin}${window.location.pathname}?staffToken=${activeStaffToken.token}`
    : '';

  useEffect(() => {
    if (isOpen && staffUrl) {
      QRCode.toDataURL(staffUrl, {
        width: 240,
        margin: 2,
        color: {
          dark: '#1f7a4d',
          light: '#ffffff',
        },
      })
        .then((url) => setQrDataUrl(url))
        .catch((err) => console.error('QR code error:', err));
    }
  }, [isOpen, staffUrl]);

  if (!isOpen) return null;

  const handleCopy = () => {
    if (!staffUrl) return;
    navigator.clipboard.writeText(staffUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  };

  const handleGenerateNew = async () => {
    const label = prompt('Beri nama perangkat kasir ini (contoh: HP Kasir 2):', 'HP Kasir Toko');
    if (!label) return;
    setLoadingToken(true);
    try {
      const res = await onCreateStaffToken(label.trim());
      if (res) {
        setActiveStaffToken(res);
      }
    } finally {
      setLoadingToken(false);
    }
  };

  const handleSavePin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (newPinInput.length < 4) {
      setPinMsg('PIN minimal 4 angka');
      return;
    }
    const ok = await onChangePin(newPinInput);
    if (ok) {
      setPinMsg('PIN berhasil diperbarui!');
      setTimeout(() => {
        setIsEditingPin(false);
        setPinMsg('');
        setNewPinInput('');
      }, 1500);
    } else {
      setPinMsg('Gagal memperbarui PIN.');
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs animate-fadeIn">
      <div className="bg-[var(--card)] text-[var(--tx)] border border-[var(--bd)] rounded-2xl w-full max-w-md p-5 shadow-2xl space-y-4 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between border-b border-[var(--bd)] pb-3">
          <div className="flex items-center gap-2">
            <Smartphone className="text-[var(--ac)]" size={20} />
            <h2 className="text-base font-bold text-[var(--tx)] m-0">
              Bagi Akses ke HP Kasir (Staff Token)
            </h2>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-lg text-[var(--mut)] hover:text-[var(--tx)] hover:bg-[var(--bg)]"
          >
            <X size={18} />
          </button>
        </div>

        {/* Feature Highlights */}
        <div className="p-3 rounded-xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 text-xs text-[var(--tx)] space-y-1.5">
          <div className="font-bold text-[var(--ac)] flex items-center gap-1.5">
            <ShieldCheck size={15} /> Keamanan Token Kasir Kriptografis:
          </div>
          <ul className="list-disc pl-4 space-y-1 text-[var(--mut)] text-[12px]">
            <li>Akses menggunakan <b>Token Acak Unik</b> (hanya hash disimpan server).</li>
            <li>Hanya dapat mengakses tab <b>Penjualan</b> & catat <b>Telur Pecah</b>.</li>
            <li><b>Harga modal & keuntungan Anda disembunyikan 100%</b> oleh server.</li>
          </ul>
        </div>

        {/* QR Code */}
        <div className="flex flex-col items-center justify-center p-4 bg-[var(--bg)] rounded-xl border border-[var(--bd)]">
          <span className="text-xs text-[var(--mut)] mb-2 font-medium">
            Scan QR ini dengan kamera HP karyawan:
          </span>
          {qrDataUrl && !loadingToken ? (
            <img
              src={qrDataUrl}
              alt="QR Code Akses Karyawan"
              className="w-48 h-48 rounded-lg shadow-sm border border-[var(--bd)] bg-white p-1"
            />
          ) : (
            <div className="w-48 h-48 flex items-center justify-center text-xs text-[var(--mut)]">
              {loadingToken ? 'Membuat Token Kasir...' : 'Menyiapkan QR...'}
            </div>
          )}
          {activeStaffToken && (
            <span className="text-[11px] font-mono-numbers text-[var(--mut)] mt-2">
              Profil: <b>{activeStaffToken.label}</b>
            </span>
          )}
        </div>

        {/* Link Karyawan */}
        <div>
          <label className="block text-xs font-semibold text-[var(--mut)] uppercase mb-1">
            Link Khusus Karyawan (Kirim via WhatsApp):
          </label>
          <div className="flex gap-2">
            <input
              type="text"
              readOnly
              value={staffUrl}
              className="text-xs font-mono-numbers p-2.5 rounded-lg border border-[var(--bd)] bg-[var(--bg)] text-[var(--mut)] select-all flex-1"
            />
            <button
              type="button"
              onClick={handleCopy}
              disabled={!staffUrl}
              className="btn sm shrink-0 flex items-center gap-1 px-3"
            >
              {copied ? <Check size={14} className="text-[var(--ac)]" /> : <Copy size={14} />}
              <span>{copied ? 'Tersalin!' : 'Salin'}</span>
            </button>
          </div>
        </div>

        {/* Generate Fresh Token Button */}
        <div className="pt-2 border-t border-[var(--bd)] flex items-center justify-between text-xs">
          <span className="text-[var(--mut)] font-medium">
            Ingin buat akses baru untuk HP lain?
          </span>
          <button
            type="button"
            onClick={handleGenerateNew}
            disabled={loadingToken}
            className="text-[var(--ac)] font-bold hover:underline flex items-center gap-1"
          >
            <Plus size={14} /> Buat QR Kasir Baru
          </button>
        </div>

        {/* Security PIN Settings */}
        <div className="pt-3 border-t border-[var(--bd)]">
          <div className="flex items-center justify-between text-xs">
            <span className="font-semibold text-[var(--mut)] flex items-center gap-1.5">
              <Lock size={13} className="text-[var(--ac)]" />
              <span>PIN Pemilik Terenkripsi Hash (PBKDF2)</span>
            </span>
            <button
              type="button"
              onClick={() => setIsEditingPin(!isEditingPin)}
              className="text-[var(--ac)] hover:underline font-semibold"
            >
              {isEditingPin ? 'Tutup' : 'Ubah PIN'}
            </button>
          </div>

          {isEditingPin && (
            <form onSubmit={handleSavePin} className="mt-2 space-y-2 animate-fadeIn">
              <input
                type="password"
                inputMode="numeric"
                maxLength={6}
                placeholder="Masukkan PIN baru (minimal 4 angka)"
                value={newPinInput}
                onChange={(e) => setNewPinInput(e.target.value.replace(/\D/g, ''))}
                className="text-sm p-2 font-mono-numbers text-center w-full"
              />
              <button
                type="submit"
                className="btn w-full py-2 text-xs font-semibold"
              >
                Simpan & Enkripsi PIN Baru
              </button>
              {pinMsg && (
                <div className="text-xs text-center text-[var(--ac)] mt-1 font-medium">
                  {pinMsg}
                </div>
              )}
            </form>
          )}
        </div>
      </div>
    </div>
  );
};
