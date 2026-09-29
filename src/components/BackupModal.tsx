import React, { useState } from 'react';
import { AppData } from '../types';
import { calculateNextSafeId, CURRENT_SCHEMA_VERSION } from '../utils/storage';
import { Download, Upload, RotateCcw, X, Check, AlertCircle } from 'lucide-react';

interface BackupModalProps {
  isOpen: boolean;
  onClose: () => void;
  data: AppData;
  onRestoreData: (restored: AppData) => void;
  onResetDemo: () => void;
}

export const BackupModal: React.FC<BackupModalProps> = ({
  isOpen,
  onClose,
  data,
  onRestoreData,
  onResetDemo,
}) => {
  const [jsonText, setJsonText] = useState('');
  const [statusMsg, setStatusMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  if (!isOpen) return null;

  const handleExport = () => {
    try {
      const backupPayload = {
        schemaVersion: CURRENT_SCHEMA_VERSION,
        exportedAt: new Date().toISOString(),
        items: data.items,
        sales: data.sales || [],
        exp: data.exp || [],
        purchases: data.purchases || [],
        adjustments: data.adjustments || [],
        allowances: data.allowances || [],
        next: data.next || 1,
      };
      const dataStr = JSON.stringify(backupPayload, null, 2);
      const blob = new Blob([dataStr], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `backup-toko-almair-v3-${new Date().toISOString().slice(0, 10)}.json`;
      link.click();
      URL.revokeObjectURL(url);
      setStatusMsg({ type: 'ok', text: 'File cadangan JSON aman (v3) berhasil diunduh!' });
    } catch (e) {
      setStatusMsg({ type: 'err', text: 'Gagal mengekspor data.' });
    }
  };

  const normalizeRestored = (parsed: any): AppData => {
    const rawItems = Array.isArray(parsed.items) ? parsed.items : [];
    const rawSales = Array.isArray(parsed.sales) ? parsed.sales : [];
    const rawExp = Array.isArray(parsed.exp) ? parsed.exp : [];
    const rawPurchases = Array.isArray(parsed.purchases) ? parsed.purchases : [];
    const rawAdjustments = Array.isArray(parsed.adjustments) ? parsed.adjustments : [];
    const rawAllowances = Array.isArray(parsed.allowances) ? parsed.allowances : [];

    const nextSafe = calculateNextSafeId({
      items: rawItems,
      sales: rawSales,
      exp: rawExp,
      purchases: rawPurchases,
      adjustments: rawAdjustments,
      allowances: rawAllowances,
      next: parsed.next,
    });

    return {
      items: rawItems,
      sales: rawSales,
      exp: rawExp,
      purchases: rawPurchases,
      adjustments: rawAdjustments,
      allowances: rawAllowances,
      next: nextSafe,
      schemaVersion: CURRENT_SCHEMA_VERSION,
    };
  };

  const handleImportText = () => {
    try {
      if (!jsonText.trim()) {
        setStatusMsg({ type: 'err', text: 'Tempelkan teks JSON terlebih dahulu.' });
        return;
      }
      const parsed = JSON.parse(jsonText.trim());
      if (!parsed || !Array.isArray(parsed.items)) {
        throw new Error('Format JSON tidak sesuai format Kasir Nominal.');
      }
      onRestoreData(normalizeRestored(parsed));
      setStatusMsg({ type: 'ok', text: 'Data berhasil dipulihkan!' });
      setTimeout(() => {
        onClose();
      }, 1200);
    } catch (e: any) {
      setStatusMsg({ type: 'err', text: e?.message || 'JSON tidak valid.' });
    }
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const text = event.target?.result as string;
        const parsed = JSON.parse(text);
        if (!parsed || !Array.isArray(parsed.items)) {
          throw new Error('Format file cadangan tidak valid.');
        }
        onRestoreData(parsed);
        setStatusMsg({ type: 'ok', text: 'Data dari file berhasil dipulihkan!' });
        setTimeout(() => {
          onClose();
        }, 1200);
      } catch (err: any) {
        setStatusMsg({ type: 'err', text: err?.message || 'Gagal membaca file JSON.' });
      }
    };
    reader.readAsText(file);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs animate-fadeIn">
      <div className="bg-[var(--card)] text-[var(--tx)] border border-[var(--bd)] rounded-2xl w-full max-w-md p-5 shadow-2xl space-y-4">
        <div className="flex items-center justify-between border-b border-[var(--bd)] pb-3">
          <h2 className="text-base font-bold text-[var(--tx)] m-0">
            Cadangan & Pemulihan Data
          </h2>
          <button
            onClick={onClose}
            className="p-1 rounded-lg text-[var(--mut)] hover:text-[var(--tx)] hover:bg-[var(--bg)]"
          >
            <X size={18} />
          </button>
        </div>

        {statusMsg && (
          <div
            className={`p-2.5 rounded-lg text-xs flex items-center gap-1.5 ${
              statusMsg.type === 'ok'
                ? 'bg-emerald-50 dark:bg-emerald-950/60 text-[var(--ac)] border border-emerald-300 dark:border-emerald-800'
                : 'bg-red-50 dark:bg-red-950/60 text-[var(--red)] border border-red-300 dark:border-red-900'
            }`}
          >
            {statusMsg.type === 'ok' ? <Check size={14} /> : <AlertCircle size={14} />}
            <span>{statusMsg.text}</span>
          </div>
        )}

        <div className="space-y-3 text-sm">
          <div>
            <div className="font-semibold text-xs uppercase text-[var(--mut)] mb-1">
              1. Ekspor Cadangan
            </div>
            <p className="text-xs text-[var(--mut)] mb-2">
              Unduh seluruh daftar barang, stok, dan riwayat transaksi ke file JSON di perangkat Anda.
            </p>
            <button
              onClick={handleExport}
              className="btn flex items-center justify-center gap-1.5 w-full py-2.5 text-sm"
            >
              <Download size={15} /> Unduh File Cadangan (.json)
            </button>
          </div>

          <div className="pt-2 border-t border-[var(--bd)]">
            <div className="font-semibold text-xs uppercase text-[var(--mut)] mb-1">
              2. Pulihkan dari File JSON
            </div>
            <input
              type="file"
              accept=".json,application/json"
              onChange={handleFileUpload}
              className="w-full text-xs text-[var(--mut)] file:mr-2 file:py-1.5 file:px-3 file:rounded-lg file:border file:border-[var(--bd)] file:text-xs file:font-semibold file:bg-[var(--bg)] file:text-[var(--tx)] hover:file:bg-[var(--card)] cursor-pointer"
            />
          </div>

          <div className="pt-2 border-t border-[var(--bd)]">
            <div className="font-semibold text-xs uppercase text-[var(--mut)] mb-1">
              3. Tempel Teks Cadangan (Opsional)
            </div>
            <textarea
              rows={3}
              placeholder="Tempel teks JSON di sini..."
              value={jsonText}
              onChange={(e) => setJsonText(e.target.value)}
              className="w-full text-xs font-mono-numbers p-2 rounded-lg border border-[var(--bd)] bg-[var(--bg)]"
            />
            {jsonText && (
              <button
                onClick={handleImportText}
                className="btn w-full mt-1.5 py-2 text-xs flex items-center justify-center gap-1"
              >
                <Upload size={13} /> Pulihkan Data dari Teks
              </button>
            )}
          </div>

          <div className="pt-2 border-t border-[var(--bd)]">
            <div className="font-semibold text-xs uppercase text-[var(--mut)] mb-1">
              4. Reset Data ke Awal
            </div>
            <button
              onClick={() => {
                if (window.confirm('Yakin ingin mereset seluruh data kembali ke setelan awal Telur 10 kg?')) {
                  onResetDemo();
                  onClose();
                }
              }}
              className="text-xs text-[var(--red)] hover:underline flex items-center gap-1 py-1"
            >
              <RotateCcw size={12} /> Reset Data ke Setelan Awal
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
