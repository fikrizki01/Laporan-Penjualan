import React, { useState, useEffect } from 'react';
import { Item, AdjustmentReason } from '../types';
import { rp, formatQty, unitLabel, EGG_GRAM_PER_PIECE } from '../utils/formatters';
import { X, Egg } from 'lucide-react';

interface EggAdjustmentModalProps {
  isOpen: boolean;
  onClose: () => void;
  items: Item[];
  defaultItemId?: number | null;
  isOwner?: boolean;
  onSubmit: (params: {
    itemId: number;
    piecesCount?: number;
    rawQty?: number;
    reason: AdjustmentReason;
    note: string;
  }) => Promise<void> | void;
}

export const EggAdjustmentModal: React.FC<EggAdjustmentModalProps> = ({
  isOpen,
  onClose,
  items,
  defaultItemId,
  isOwner = false,
  onSubmit,
}) => {
  const [selectedId, setSelectedId] = useState<number>(() => {
    if (defaultItemId && items.some((i) => i.id === defaultItemId)) return defaultItemId;
    const eggItem = items.find((i) => i.name.toLowerCase().includes('telur'));
    return eggItem ? eggItem.id : (items[0] ? items[0].id : 0);
  });

  const [inputMode, setInputMode] = useState<'butir' | 'kg'>('butir');
  const [piecesInput, setPiecesInput] = useState<string>('1');
  const [kgInput, setKgInput] = useState<string>('');
  const [reason, setReason] = useState<AdjustmentReason>('pecah');
  const [note, setNote] = useState<string>('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (isOpen) {
      if (defaultItemId && items.some((i) => i.id === defaultItemId)) {
        setSelectedId(defaultItemId);
      } else {
        const eggItem = items.find((i) => i.name.toLowerCase().includes('telur'));
        if (eggItem) setSelectedId(eggItem.id);
      }
      setReason('pecah');
    }
  }, [isOpen, defaultItemId, items]);

  if (!isOpen) return null;

  const currentItem = items.find((i) => i.id === selectedId) || items[0];
  const isPcs = currentItem?.unit === 'pcs';

  const piecesVal = parseInt(piecesInput, 10) || 0;
  const kgVal = parseFloat(kgInput.replace(',', '.')) || 0;

  // Use dynamic item-specific gram per piece if configured, fallback to standard 62.5g
  const gramPerPiece = currentItem?.estimatedGramPerPiece && currentItem.estimatedGramPerPiece > 0
    ? currentItem.estimatedGramPerPiece
    : EGG_GRAM_PER_PIECE;

  let estimatedGrams = 0;
  if (isPcs) {
    estimatedGrams = piecesVal;
  } else if (inputMode === 'butir') {
    estimatedGrams = Math.round(piecesVal * gramPerPiece);
  } else {
    estimatedGrams = Math.round(kgVal * 1000);
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentItem) return;
    if (inputMode === 'butir' && piecesVal <= 0) return;
    if (inputMode === 'kg' && kgVal <= 0) return;

    setSubmitting(true);
    try {
      await onSubmit({
        itemId: currentItem.id,
        piecesCount: inputMode === 'butir' && !isPcs ? piecesVal : undefined,
        rawQty: inputMode === 'kg' && !isPcs ? kgVal : (isPcs ? piecesVal : undefined),
        reason,
        note: note.trim() || (reason === 'pecah' ? 'Telur pecah / retak' : 'Penyesuaian stok'),
      });
      onClose();
    } finally {
      setSubmitting(false);
    }
  };

  // Staff can only select 'pecah' or 'rusak'. Owner can select all reasons.
  const reasonOptions = isOwner
    ? [
        { id: 'pecah', label: '🥚 Telur Pecah / Retak' },
        { id: 'rusak', label: '🍂 Rusak / Busuk' },
        { id: 'hilang', label: '⚖️ Susut Timbangan' },
        { id: 'koreksi_kurang', label: '📉 Koreksi Stok Kurang' },
      ]
    : [
        { id: 'pecah', label: '🥚 Telur Pecah / Retak' },
        { id: 'rusak', label: '🍂 Telur Rusak / Busuk' },
      ];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs animate-fadeIn">
      <div className="bg-[var(--card)] text-[var(--tx)] border border-[var(--bd)] rounded-2xl w-full max-w-md p-5 shadow-2xl space-y-4 max-h-[92vh] overflow-y-auto">
        <div className="flex items-center justify-between border-b border-[var(--bd)] pb-3">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-amber-50 dark:bg-amber-950/50 border border-amber-200 dark:border-amber-800 flex items-center justify-center text-amber-600">
              <Egg size={18} />
            </div>
            <div>
              <h2 className="text-base font-bold text-[var(--tx)] m-0 leading-tight">
                Catat Telur Pecah / Rusak
              </h2>
              <span className="text-[11px] text-[var(--mut)]">
                Stok fisik langsung disesuaikan secara otomatis
              </span>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-lg text-[var(--mut)] hover:text-[var(--tx)] hover:bg-[var(--bg)]"
          >
            <X size={18} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-3.5">
          {/* Item Selector */}
          <div>
            <label className="block text-xs font-semibold text-[var(--mut)] uppercase mb-1">
              Pilih Barang:
            </label>
            <select
              value={selectedId}
              onChange={(e) => setSelectedId(Number(e.target.value))}
              className="w-full p-2.5 rounded-lg border border-[var(--bd)] bg-[var(--bg)] text-[var(--tx)] text-sm font-medium"
            >
              {items
                .filter((it) => !it.archived)
                .map((it) => (
                  <option key={it.id} value={it.id}>
                    {it.name} — Sisa Stok: {formatQty(it.gram, it.unit)}
                  </option>
                ))}
            </select>
          </div>

          {/* Mode Selector for kg items */}
          {!isPcs && (
            <div className="flex gap-2 p-1 bg-[var(--bg)] rounded-xl border border-[var(--bd)]">
              <button
                type="button"
                onClick={() => setInputMode('butir')}
                className={`flex-1 py-1.5 px-3 rounded-lg text-xs font-bold transition-all ${
                  inputMode === 'butir'
                    ? 'bg-amber-500 text-white shadow-xs'
                    : 'text-[var(--mut)] hover:text-[var(--tx)]'
                }`}
              >
                Hitung Per Butir
              </button>
              <button
                type="button"
                onClick={() => setInputMode('kg')}
                className={`flex-1 py-1.5 px-3 rounded-lg text-xs font-bold transition-all ${
                  inputMode === 'kg'
                    ? 'bg-amber-500 text-white shadow-xs'
                    : 'text-[var(--mut)] hover:text-[var(--tx)]'
                }`}
              >
                Timbang Berat (Kg)
              </button>
            </div>
          )}

          {/* Amount Input */}
          <div>
            <label className="block text-xs font-semibold text-[var(--mut)] uppercase mb-1">
              {inputMode === 'butir' || isPcs ? 'Jumlah Butir Yang Pecah/Rusak:' : 'Berat Timbangan (Kg):'}
            </label>
            {inputMode === 'butir' || isPcs ? (
              <div className="space-y-2">
                <div className="flex gap-2">
                  <input
                    type="number"
                    min="1"
                    max="1000"
                    autoFocus
                    placeholder="Misal: 2 butir"
                    value={piecesInput}
                    onChange={(e) => setPiecesInput(e.target.value)}
                    className="text-lg font-mono-numbers p-2.5 rounded-lg border border-[var(--bd)] bg-[var(--bg)] text-[var(--tx)] flex-1 text-center font-bold"
                  />
                  <span className="flex items-center text-sm font-semibold text-[var(--mut)] px-2">
                    butir
                  </span>
                </div>
                {/* Quick Buttons for butir */}
                <div className="flex gap-1.5">
                  {[1, 2, 3, 5, 10, 16].map((n) => (
                    <button
                      key={n}
                      type="button"
                      onClick={() => setPiecesInput(String(n))}
                      className="flex-1 py-1 text-xs font-semibold rounded border border-[var(--bd)] bg-[var(--bg)] hover:bg-amber-50 hover:text-amber-700 text-[var(--tx)]"
                    >
                      {n === 16 ? '16 (1 kg)' : `${n}`}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <div className="flex gap-2">
                <input
                  type="text"
                  inputMode="decimal"
                  placeholder="Misal: 0.25 atau 0,5"
                  value={kgInput}
                  onChange={(e) => setKgInput(e.target.value)}
                  className="text-lg font-mono-numbers p-2.5 rounded-lg border border-[var(--bd)] bg-[var(--bg)] text-[var(--tx)] flex-1 text-center font-bold"
                />
                <span className="flex items-center text-sm font-semibold text-[var(--mut)] px-2">
                  kg
                </span>
              </div>
            )}
          </div>

          {/* Conversion Info */}
          {!isPcs && estimatedGrams > 0 && (
            <div className="p-2.5 rounded-xl bg-[var(--bg)] border border-[var(--bd)] text-xs flex items-center justify-between text-[var(--mut)]">
              <span>Pengurangan stok fisik:</span>
              <b className="text-amber-600 font-mono-numbers">
                {(estimatedGrams / 1000).toLocaleString('id-ID', { maximumFractionDigits: 3 })} kg ({estimatedGrams} g)
              </b>
            </div>
          )}

          {/* Reason Selector */}
          <div>
            <label className="block text-xs font-semibold text-[var(--mut)] uppercase mb-1">
              Alasan Penyesuaian:
            </label>
            <div className="grid grid-cols-2 gap-2 text-xs">
              {reasonOptions.map((r) => (
                <button
                  key={r.id}
                  type="button"
                  onClick={() => setReason(r.id as AdjustmentReason)}
                  className={`p-2 rounded-lg border text-left font-medium transition-colors ${
                    reason === r.id
                      ? 'border-amber-500 bg-amber-50/50 dark:bg-amber-950/30 text-amber-700 dark:text-amber-400 font-semibold'
                      : 'border-[var(--bd)] bg-[var(--bg)] text-[var(--mut)]'
                  }`}
                >
                  {r.label}
                </button>
              ))}
            </div>
          </div>

          {/* Note Input */}
          <div>
            <label className="block text-xs font-semibold text-[var(--mut)] uppercase mb-1">
              Keterangan Tambahan (Opsional):
            </label>
            <input
              type="text"
              placeholder="Misal: Pecah saat bongkar rak depan"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              className="w-full text-xs p-2.5 rounded-lg border border-[var(--bd)] bg-[var(--bg)] text-[var(--tx)]"
            />
          </div>

          {/* Submit Button */}
          <div className="pt-2 flex gap-2">
            <button
              type="button"
              onClick={onClose}
              className="btn sm flex-1 py-2 text-xs"
            >
              Batal
            </button>
            <button
              type="submit"
              disabled={submitting || (inputMode === 'butir' && piecesVal <= 0) || (inputMode === 'kg' && kgVal <= 0)}
              className="btn sm flex-1 py-2 text-xs bg-amber-600 hover:bg-amber-700 text-white border-amber-600 font-bold"
            >
              {submitting ? 'Menyimpan...' : 'Potong Stok'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
