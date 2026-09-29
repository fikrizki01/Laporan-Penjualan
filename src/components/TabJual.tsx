import React, { useState, useEffect } from 'react';
import { Item, Sale } from '../types';
import { rp, kg, num, fifo, formatQty, unitLabel, getItemIcon, isEggItem, sortItemsFixedOrder } from '../utils/formatters';
import { CheckCircle2, AlertCircle } from 'lucide-react';

interface TabJualProps {
  items: Item[];
  selectedItemId: number | null;
  role: 'owner' | 'karyawan';
  onSelectItem: (id: number) => void;
  onCompleteSale: (sale: {
    itemId: number;
    nominal: number;
    name?: string;
    gram?: number;
    hpp?: number;
    used?: any[];
    unit?: any;
    t?: number;
    by?: any;
  }) => void;
  onOpenEggModal?: (itemId?: number) => void;
}

export const TabJual: React.FC<TabJualProps> = ({
  items,
  selectedItemId,
  role,
  onSelectItem,
  onCompleteSale,
  onOpenEggModal,
}) => {
  const [nominalStr, setNominalStr] = useState<string>('');
  const [successToast, setSuccessToast] = useState<string | null>(null);

  const isOwner = role === 'owner';
  const activeItems = sortItemsFixedOrder(items.filter((i) => !i.archived));
  const selectedItem = activeItems.find((i) => i.id === selectedItemId) || activeItems[0] || null;
  const isPcs = selectedItem?.unit === 'pcs';

  useEffect(() => {
    if ((!selectedItemId || !activeItems.some((i) => i.id === selectedItemId)) && activeItems.length > 0) {
      onSelectItem(activeItems[0].id);
    }
  }, [activeItems, selectedItemId, onSelectItem]);

  const nominalVal = num(nominalStr);

  const handleNominalChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value;
    const val = num(raw);
    setNominalStr(val ? val.toLocaleString('id-ID') : '');
  };

  const handleQuickNominal = (val: number) => {
    setNominalStr(val.toLocaleString('id-ID'));
  };

  const handleQuickPcs = (pcsCount: number) => {
    if (selectedItem) {
      const total = pcsCount * selectedItem.price;
      setNominalStr(total.toLocaleString('id-ID'));
    }
  };

  // Calculation details
  let isStockInsufficient = false;
  let amountNeeded = 0; // grams if kg, or pcs if pcs
  let remainingAmount = 0;
  let profit = 0;
  let hasCostConfigured = true;
  let canSell = false;

  if (selectedItem && nominalVal > 0) {
    if (isPcs) {
      amountNeeded = Math.round((nominalVal / selectedItem.price) * 100) / 100;
      if (amountNeeded > selectedItem.gram) {
        isStockInsufficient = true;
      } else {
        canSell = true;
        remainingAmount = selectedItem.gram - amountNeeded;
        if (isOwner) {
          const sim = fifo(selectedItem, amountNeeded, false);
          profit = nominalVal - sim.hpp;
          hasCostConfigured = sim.hpp > 0;
        }
      }
    } else {
      amountNeeded = Math.round((nominalVal / selectedItem.price) * 1000);
      if (amountNeeded > selectedItem.gram) {
        isStockInsufficient = true;
      } else {
        canSell = true;
        remainingAmount = selectedItem.gram - amountNeeded;
        if (isOwner) {
          const sim = fifo(selectedItem, amountNeeded, false);
          profit = nominalVal - sim.hpp;
          hasCostConfigured = sim.hpp > 0;
        }
      }
    }
  }

  const handleJual = () => {
    if (!canSell || !selectedItem || nominalVal <= 0) return;

    onCompleteSale({
      itemId: selectedItem.id,
      name: selectedItem.name,
      nominal: nominalVal,
      gram: amountNeeded,
      hpp: 0,
      used: [],
      unit: selectedItem.unit || 'kg',
      t: Date.now(),
      by: role,
    });

    const qtyDisplay = isPcs
      ? `${amountNeeded} pcs`
      : `${kg(amountNeeded)} kg`;

    setSuccessToast(`Terjual ${selectedItem.name} ${qtyDisplay} (${rp(nominalVal)})`);
    setTimeout(() => {
      setSuccessToast(null);
    }, 3000);

    setNominalStr('');
  };

  const quickNominals = [5000, 10000, 15000, 20000, 25000, 50000];
  const quickPcsList = [1, 2, 3, 4, 5, 10];

  return (
    <section className="space-y-3">
      {successToast && (
        <div className="flex items-center gap-2 p-3 rounded-xl bg-emerald-50 dark:bg-emerald-950/60 border border-emerald-300 dark:border-emerald-800 text-[var(--ac)] text-sm font-medium animate-fadeIn">
          <CheckCircle2 size={18} className="shrink-0" />
          <span>{successToast}</span>
        </div>
      )}

      {/* Pilih barang */}
      <div className="card">
        <h2>PILIH BARANG PENJUALAN</h2>
        {activeItems.length === 0 ? (
          <div className="text-sm text-[var(--mut)] py-2">
            Belum ada barang terdaftar di sistem.
          </div>
        ) : (
          <div className="chips">
            {activeItems.map((it) => {
              const isSelected = selectedItem?.id === it.id;
              const unit = unitLabel(it.unit);
              const icon = getItemIcon(it.name);
              return (
                <button
                  key={it.id}
                  onClick={() => onSelectItem(it.id)}
                  className={`chip ${isSelected ? 'on' : ''}`}
                >
                  <span className="mr-1">{icon}</span>
                  {it.name} · {rp(it.price)}/{unit}
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Nominal pembeli */}
      <div className="card">
        <div className="flex justify-between items-center mb-2">
          <h2 className="m-0">NOMINAL PEMBELI (RP)</h2>
          {selectedItem && (
            <span className="text-xs text-[var(--mut)] font-mono-numbers">
              Satuan: <b className="text-[var(--tx)] uppercase">{unitLabel(selectedItem.unit)}</b>
            </span>
          )}
        </div>

        <div className="relative">
          <input
            id="nom"
            type="text"
            inputMode="numeric"
            value={nominalStr}
            onChange={handleNominalChange}
            placeholder="contoh: 15.000"
            autoComplete="off"
            className="w-full text-xl font-mono-numbers font-semibold"
          />
          {nominalStr && (
            <button
              onClick={() => setNominalStr('')}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-[var(--mut)] hover:text-[var(--tx)] text-sm px-1.5 py-0.5"
            >
              ✕
            </button>
          )}
        </div>

        {/* Quick buttons: If pcs, show quick pcs counts; else show quick Rp */}
        {isPcs ? (
          <div className="space-y-1.5 mt-2.5">
            <div className="text-[11px] text-[var(--mut)] font-semibold uppercase">
              Pilihan Jumlah (Pcs):
            </div>
            <div className="q">
              {quickPcsList.map((pcs) => {
                const totalRp = selectedItem ? pcs * selectedItem.price : 0;
                return (
                  <button
                    key={pcs}
                    type="button"
                    onClick={() => handleQuickPcs(pcs)}
                    className="font-mono-numbers hover:border-[var(--ac)] active:scale-95 transition-transform text-xs py-2"
                  >
                    <b>{pcs} pcs</b>
                    <span className="block text-[10px] opacity-75 font-normal">
                      {rp(totalRp)}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        ) : (
          <div className="q">
            {quickNominals.map((val) => (
              <button
                key={val}
                type="button"
                onClick={() => handleQuickNominal(val)}
                className="font-mono-numbers hover:border-[var(--ac)] active:scale-95 transition-transform"
              >
                {val / 1000}rb
              </button>
            ))}
          </div>
        )}

        {/* Calculation Result */}
        <div className="res">
          {!selectedItem ? (
            <span className="text-[var(--mut)] text-sm">Pilih barang dulu</span>
          ) : !nominalVal ? (
            <span className="text-[var(--mut)] text-sm">Ketik nominal</span>
          ) : isStockInsufficient ? (
            <div>
              <span className="err font-bold text-base flex items-center justify-center gap-1">
                <AlertCircle size={16} /> Stok tidak cukup
              </span>
              <small className="block text-[var(--mut)] mt-1 font-mono-numbers">
                Butuh {formatQty(amountNeeded, selectedItem.unit)}, stok {formatQty(selectedItem.gram, selectedItem.unit)}
              </small>
            </div>
          ) : (
            <div>
              <div className="big font-mono-numbers tracking-tight text-[var(--tx)]">
                {formatQty(amountNeeded, selectedItem.unit)}
              </div>
              <small className="block text-[var(--mut)] mt-1 font-mono-numbers">
                {isPcs
                  ? `${amountNeeded} pcs · sisa stok setelah jual ${formatQty(remainingAmount, 'pcs')}`
                  : `${amountNeeded.toLocaleString('id-ID')} gram · sisa stok setelah jual ${kg(remainingAmount)} kg`}
              </small>
              {/* Only show profit if Owner */}
              {isOwner && (
                hasCostConfigured ? (
                  <small className="block text-[var(--ac)] font-semibold mt-1 font-mono-numbers">
                    Untung {rp(profit)}
                  </small>
                ) : (
                  <small className="err block mt-1">
                    Harga modal belum diisi (tab Barang)
                  </small>
                )
              )}
            </div>
          )}
        </div>

        {/* Jual Button */}
        <button
          type="button"
          onClick={handleJual}
          disabled={!canSell}
          className="btn p"
        >
          Catat Penjualan
        </button>

        {/* Quick Telur Pecah button - only show if an egg item is selected */}
        {onOpenEggModal && selectedItem && isEggItem(selectedItem.name) && (
          <button
            type="button"
            onClick={() => onOpenEggModal(selectedItem.id)}
            className="w-full py-2 px-3 rounded-xl border border-amber-300 dark:border-amber-800/80 bg-amber-50/60 dark:bg-amber-950/20 text-amber-700 dark:text-amber-400 hover:bg-amber-100/60 transition-colors text-xs font-semibold flex items-center justify-center gap-1.5"
          >
            <span>🥚</span>
            <span>Ada Telur Pecah / Rusak? Klik untuk catat</span>
          </button>
        )}
      </div>
    </section>
  );
};
