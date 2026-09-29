import React from 'react';
import { Sun, Moon, Database, Share2, Lock, Smartphone, UserCheck } from 'lucide-react';

interface HeaderProps {
  theme: 'light' | 'dark';
  toggleTheme?: () => void;
  onToggleTheme?: () => void;
  syncMsg?: string;
  role: 'owner' | 'karyawan' | 'unauthenticated';
  onOpenBackup: () => void;
  onOpenShareStaff: () => void;
  onOpenPinUnlock: () => void;
  onSwitchToStaffView: () => void;
}

export const Header: React.FC<HeaderProps> = ({
  theme,
  toggleTheme,
  onToggleTheme,
  syncMsg = 'Tersambung ke server',
  role,
  onOpenBackup,
  onOpenShareStaff,
  onOpenPinUnlock,
  onSwitchToStaffView,
}) => {
  const isOwner = role === 'owner';

  const handleToggle = () => {
    if (toggleTheme) toggleTheme();
    else if (onToggleTheme) onToggleTheme();
  };

  return (
    <header className="mb-3">
      <div className="flex items-center justify-between py-1">
        <div className="flex items-center gap-2">
          <h1 className="text-xl font-bold tracking-tight text-[var(--tx)] flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full bg-[var(--ac)] inline-block"></span>
            Kasir Nominal
          </h1>
          <span
            className={`text-[11px] font-semibold px-2 py-0.5 rounded-full border ${
              isOwner
                ? 'bg-emerald-50 dark:bg-emerald-950/60 text-[var(--ac)] border-emerald-300 dark:border-emerald-800'
                : 'bg-amber-50 dark:bg-amber-950/60 text-amber-600 dark:text-amber-400 border-amber-300 dark:border-amber-800'
            }`}
          >
            {isOwner ? 'Pemilik' : 'Karyawan'}
          </span>
        </div>

        <div className="flex items-center gap-1.5">
          {isOwner ? (
            <>
              <button
                onClick={onOpenShareStaff}
                title="Bagi akses kasir ke HP Karyawan (QR Code / Link)"
                className="py-1.5 px-2.5 rounded-lg border border-emerald-400 dark:border-emerald-700 bg-emerald-50 dark:bg-emerald-950/60 text-[var(--ac)] hover:bg-emerald-100 dark:hover:bg-emerald-900 transition-colors text-xs font-semibold flex items-center gap-1.5"
              >
                <Share2 size={14} />
                <span>Bagi ke Karyawan</span>
              </button>

              <button
                onClick={onOpenBackup}
                title="Cadangkan / Pulihkan Data"
                className="p-2 rounded-lg border border-[var(--bd)] bg-[var(--card)] text-[var(--mut)] hover:text-[var(--tx)] transition-colors text-xs"
              >
                <Database size={15} />
              </button>

              <button
                onClick={onSwitchToStaffView}
                title="Kunci / Keluar ke Mode Kasir"
                className="py-1.5 px-2 rounded-lg border border-[var(--bd)] bg-[var(--card)] text-[var(--tx)] hover:bg-rose-50 dark:hover:bg-rose-950/40 hover:text-rose-600 transition-colors text-xs font-semibold flex items-center gap-1"
              >
                <Lock size={13} />
                <span>Kunci</span>
              </button>
            </>
          ) : (
            <button
              onClick={onOpenPinUnlock}
              title="Buka Mode Pemilik dengan PIN"
              className="py-1.5 px-2.5 rounded-lg border border-[var(--bd)] bg-[var(--card)] text-[var(--tx)] hover:border-[var(--ac)] transition-colors text-xs font-semibold flex items-center gap-1.5"
            >
              <Lock size={13} />
              <span>Masuk Pemilik</span>
            </button>
          )}

          <button
            onClick={handleToggle}
            title={theme === 'dark' ? 'Ganti ke Mode Terang' : 'Ganti ke Mode Gelap'}
            className="p-2 rounded-lg border border-[var(--bd)] bg-[var(--card)] text-[var(--mut)] hover:text-[var(--tx)] transition-colors"
          >
            {theme === 'dark' ? <Sun size={15} /> : <Moon size={15} />}
          </button>
        </div>
      </div>

      <div className="flex items-center justify-between text-xs text-[var(--mut)] min-h-[18px] px-1">
        <span>
          {isOwner
            ? 'Akses Penuh Pemilik (Stok, Laba, Pengeluaran)'
            : 'Mode Kasir Karyawan (Khusus Tab Penjualan)'}
        </span>
        <span className="text-right truncate">{syncMsg}</span>
      </div>
    </header>
  );
};
