import React, { useState, useEffect } from 'react';
import { Item, Expense, Purchase } from '../types';
import { rp, kg, num, dec, formatQty, unitLabel, fifo, EGG_GRAM_PER_PIECE, getItemIcon, isEggItem, sortItemsFixedOrder } from '../utils/formatters';
import {
  CheckCircle2,
  PackagePlus,
  ReceiptText,
  UserCheck,
  ArrowRight,
  MinusCircle,
  AlertCircle,
  Egg,
  Truck,
  Building2,
  Layers,
} from 'lucide-react';

interface TabKeluarProps {
  items: Item[];
  purchases?: Purchase[];
  selectedItemId?: number | null;
  onSelectItem?: (id: number) => void;
  onAddPurchase: (params: {
    itemId: number;
    supplier: string;
    isIkat: boolean;
    ikatCount?: number;
    kgPerIkat?: number;
    qty?: number;
    costPerUnit: number;
    note?: string;
  }) => Promise<void> | void;
  onAddExpense: (expense: Omit<Expense, 'id'>) => Promise<void> | void;
  onAddStaffAllowance: (params: {
    itemId: number;
    amount: number;
    note: string;
    staffName: string;
  }) => { success: boolean; error?: string };
  onOpenEggModal?: (itemId?: number) => void;
}

const OPERATIONAL_CATS = [
  { id: 'Plastik', label: '🛍️ Plastik & Kresek' },
  { id: 'Listrik', label: '⚡ Listrik & Air' },
  { id: 'Gaji', label: '💵 Gaji / Uang Makan' },
  { id: 'Sewa toko', label: '🏪 Sewa Toko' },
  { id: 'Lainnya', label: '📝 Operasional Lainnya' },
];

export const TabKeluar: React.FC<TabKeluarProps> = ({
  items,
  purchases = [],
  selectedItemId,
  onSelectItem,
  onAddPurchase,
  onAddExpense,
  onAddStaffAllowance,
  onOpenEggModal,
}) => {
  // Sub-tabs: 'kulakan' | 'operasional' | 'jatah' | 'pecah'
  const [activeSubTab, setActiveSubTab] = useState<'kulakan' | 'operasional' | 'jatah' | 'pecah'>('kulakan');

  // Active items (excluding archived, sorted in canonical fixed order)
  const activeItems = sortItemsFixedOrder(items.filter((i) => !i.archived));

  // Currently selected item for restocking or allowance
  const [activeItemId, setActiveItemId] = useState<number | null>(() => {
    if (selectedItemId && activeItems.some((i) => i.id === selectedItemId)) {
      return selectedItemId;
    }
    return activeItems[0] ? activeItems[0].id : null;
  });

  // Only suppliers the user has actually bought from
  const pastSuppliers = React.useMemo(() => {
    const set = new Set<string>();
    if (purchases && purchases.length > 0) {
      for (const p of purchases) {
        if (p.supplier && p.supplier.trim() && p.supplier.trim().toLowerCase() !== 'stok awal') {
          set.add(p.supplier.trim());
        }
      }
    }
    if (items && items.length > 0) {
      for (const item of items) {
        if (item.batches) {
          for (const b of item.batches) {
            if (b.supplier && b.supplier.trim() && b.supplier.trim().toLowerCase() !== 'stok awal') {
              set.add(b.supplier.trim());
            }
          }
        }
      }
    }
    return Array.from(set);
  }, [purchases, items]);

  // Kulakan (Purchase) Form States - starts clean, no default fake supplier
  const [supplierInput, setSupplierInput] = useState<string>('');
  const [purchaseUnitType, setPurchaseUnitType] = useState<'ikat' | 'kg'>('ikat');
  const [ikatCountStr, setIkatCountStr] = useState<string>('10');
  const [kgPerIkatStr, setKgPerIkatStr] = useState<string>('15');
  const [rawQtyKgStr, setRawQtyKgStr] = useState<string>('150');
  const [costPerUnitStr, setCostPerUnitStr] = useState<string>('23.000');
  const [purchaseNote, setPurchaseNote] = useState<string>('');

  // Operational Form States
  const [selectedOpCat, setSelectedOpCat] = useState<string>('Plastik');
  const [opNominalStr, setOpNominalStr] = useState<string>('');
  const [opNoteStr, setOpNoteStr] = useState<string>('');

  // Jatah Karyawan States
  const [allowanceAmountStr, setAllowanceAmountStr] = useState<string>('1');
  const [staffNameStr, setStaffNameStr] = useState<string>('');
  const [allowanceNoteStr, setAllowanceNoteStr] = useState<string>('Jatah mingguan');

  const [toastMsg, setToastMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (activeItems.length > 0) {
      if (!activeItemId || !activeItems.some((i) => i.id === activeItemId)) {
        setActiveItemId(activeItems[0].id);
      }
    } else {
      setActiveItemId(null);
    }
  }, [items, activeItemId]);

  const currentItem = activeItems.find((i) => i.id === activeItemId) || items.find((i) => i.id === activeItemId) || null;
  const isPcs = currentItem?.unit === 'pcs';
  const unit = unitLabel(currentItem?.unit);

  // Sync default purchase cost with current item modal reference
  useEffect(() => {
    if (currentItem && currentItem.modal > 0) {
      setCostPerUnitStr(currentItem.modal.toLocaleString('id-ID'));
    }
  }, [activeItemId]);

  // Calculations for Kulakan
  const costPerUnitVal = num(costPerUnitStr);
  const ikatCountVal = parseInt(ikatCountStr, 10) || 0;
  const kgPerIkatVal = parseFloat(kgPerIkatStr.replace(',', '.')) || 15;
  const rawQtyKgVal = dec(rawQtyKgStr);

  let totalPurchaseQtyText = '';
  let totalPurchaseCost = 0;
  let computedKgOrPcs = 0;

  if (isPcs) {
    computedKgOrPcs = rawQtyKgVal;
    totalPurchaseCost = Math.round(computedKgOrPcs * costPerUnitVal);
    totalPurchaseQtyText = `${computedKgOrPcs} pcs`;
  } else if (purchaseUnitType === 'ikat') {
    const totalKg = ikatCountVal * kgPerIkatVal;
    computedKgOrPcs = totalKg;
    totalPurchaseCost = Math.round(totalKg * costPerUnitVal);
    totalPurchaseQtyText = `${totalKg} kg (${ikatCountVal} ikat @${kgPerIkatVal} kg)`;
  } else {
    computedKgOrPcs = rawQtyKgVal;
    totalPurchaseCost = Math.round(rawQtyKgVal * costPerUnitVal);
    totalPurchaseQtyText = `${rawQtyKgVal} kg`;
  }

  // Jatah Karyawan calculations
  const currentStock = currentItem ? currentItem.gram : 0;
  const allowanceVal = dec(allowanceAmountStr);
  const allowanceGramsOrPcs = isPcs ? Math.round(allowanceVal * 100) / 100 : Math.round(allowanceVal * 1000);
  const isAllowanceInsufficient = currentItem ? allowanceGramsOrPcs > currentItem.gram : false;
  let allowanceModalCost = 0;
  if (currentItem && allowanceGramsOrPcs > 0 && !isAllowanceInsufficient) {
    const sim = fifo(currentItem, allowanceGramsOrPcs, false);
    allowanceModalCost = sim.hpp;
  }

  const handleSelectItem = (id: number) => {
    setActiveItemId(id);
    const sel = items.find((i) => i.id === id);
    if (sel) {
      if (sel.name.toLowerCase().includes('puyuh')) {
        setPurchaseUnitType('kg');
        setRawQtyKgStr('5');
      } else if (sel.unit !== 'pcs') {
        setPurchaseUnitType('ikat');
      }
      if (sel.modal > 0) {
        setCostPerUnitStr(sel.modal.toLocaleString('id-ID'));
      }
    }
    if (onSelectItem) {
      onSelectItem(id);
    }
  };

  // Submit Kulakan / Pembelian
  const handlePurchaseSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentItem || costPerUnitVal <= 0) return;
    if (!isPcs && purchaseUnitType === 'ikat' && ikatCountVal <= 0) return;
    if ((isPcs || purchaseUnitType === 'kg') && rawQtyKgVal <= 0) return;

    setSubmitting(true);
    try {
      await onAddPurchase({
        itemId: currentItem.id,
        supplier: supplierInput.trim() || 'Supplier Umum',
        isIkat: !isPcs && purchaseUnitType === 'ikat',
        ikatCount: !isPcs && purchaseUnitType === 'ikat' ? ikatCountVal : undefined,
        kgPerIkat: !isPcs && purchaseUnitType === 'ikat' ? kgPerIkatVal : undefined,
        qty: isPcs || purchaseUnitType === 'kg' ? rawQtyKgVal : undefined,
        costPerUnit: costPerUnitVal,
        note: purchaseNote.trim() || undefined,
      });

      setToastMsg({
        type: 'ok',
        text: `Kulakan berhasil disimpan! Masuk batch baru: ${totalPurchaseQtyText} @ ${rp(costPerUnitVal)}/${unit}.`,
      });
      setPurchaseNote('');
      setTimeout(() => setToastMsg(null), 5000);
    } catch {
      setToastMsg({ type: 'err', text: 'Gagal mencatat pembelian stok' });
    } finally {
      setSubmitting(false);
    }
  };

  // Submit Biaya Operasional
  const handleOperationalSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const nominal = num(opNominalStr);
    if (nominal <= 0) return;

    setSubmitting(true);
    try {
      await onAddExpense({
        nominal,
        t: Date.now(),
        cat: selectedOpCat,
        note: opNoteStr.trim() || selectedOpCat,
      });

      setToastMsg({
        type: 'ok',
        text: `Biaya operasional ${selectedOpCat} (${rp(nominal)}) berhasil dicatat!`,
      });
      setOpNominalStr('');
      setOpNoteStr('');
      setTimeout(() => setToastMsg(null), 4000);
    } catch {
      setToastMsg({ type: 'err', text: 'Gagal mencatat biaya operasional' });
    } finally {
      setSubmitting(false);
    }
  };

  // Submit Jatah Karyawan
  const handleAllowanceSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentItem || allowanceVal <= 0 || isAllowanceInsufficient) return;

    const res = onAddStaffAllowance({
      itemId: currentItem.id,
      amount: allowanceGramsOrPcs,
      note: allowanceNoteStr.trim(),
      staffName: staffNameStr.trim() || 'Karyawan',
    });

    if (res.success) {
      setToastMsg({
        type: 'ok',
        text: `Jatah karyawan tercatat! Stok ${currentItem.name} berkurang -${formatQty(allowanceGramsOrPcs, currentItem.unit)} (Nilai modal: ${rp(allowanceModalCost)}).`,
      });
      setAllowanceAmountStr('1');
      setStaffNameStr('');
      setTimeout(() => setToastMsg(null), 5000);
    } else {
      setToastMsg({ type: 'err', text: res.error || 'Gagal memotong stok jatah' });
    }
  };

  return (
    <div className="space-y-4">
      {/* Toast */}
      {toastMsg && (
        <div
          className={`p-3 rounded-xl text-xs font-semibold flex items-center gap-2 animate-fadeIn shadow-md ${
            toastMsg.type === 'ok'
              ? 'bg-emerald-50 dark:bg-emerald-950/50 text-emerald-800 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-800'
              : 'bg-rose-50 dark:bg-rose-950/50 text-rose-800 dark:text-rose-300 border border-rose-300 dark:border-rose-800'
          }`}
        >
          {toastMsg.type === 'ok' ? (
            <CheckCircle2 size={16} className="text-emerald-600 shrink-0" />
          ) : (
            <AlertCircle size={16} className="text-rose-600 shrink-0" />
          )}
          <span>{toastMsg.text}</span>
        </div>
      )}

      {/* Sub-Tab Navigation */}
      <div className="grid grid-cols-4 gap-1.5 p-1 rounded-xl bg-[var(--card)] border border-[var(--bd)]">
        <button
          type="button"
          onClick={() => setActiveSubTab('kulakan')}
          className={`py-2 px-1 rounded-lg text-xs font-bold transition-all flex flex-col items-center gap-1 ${
            activeSubTab === 'kulakan'
              ? 'bg-[var(--ac)] text-white shadow-sm'
              : 'text-[var(--mut)] hover:text-[var(--tx)]'
          }`}
        >
          <Truck size={15} />
          <span className="truncate">Kulakan Stok</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveSubTab('operasional')}
          className={`py-2 px-1 rounded-lg text-xs font-bold transition-all flex flex-col items-center gap-1 ${
            activeSubTab === 'operasional'
              ? 'bg-[var(--ac)] text-white shadow-sm'
              : 'text-[var(--mut)] hover:text-[var(--tx)]'
          }`}
        >
          <ReceiptText size={15} />
          <span className="truncate">Operasional</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveSubTab('pecah')}
          className={`py-2 px-1 rounded-lg text-xs font-bold transition-all flex flex-col items-center gap-1 ${
            activeSubTab === 'pecah'
              ? 'bg-amber-600 text-white shadow-sm'
              : 'text-[var(--mut)] hover:text-amber-600'
          }`}
        >
          <Egg size={15} />
          <span className="truncate">Telur Pecah</span>
        </button>

        <button
          type="button"
          onClick={() => setActiveSubTab('jatah')}
          className={`py-2 px-1 rounded-lg text-xs font-bold transition-all flex flex-col items-center gap-1 ${
            activeSubTab === 'jatah'
              ? 'bg-[var(--ac)] text-white shadow-sm'
              : 'text-[var(--mut)] hover:text-[var(--tx)]'
          }`}
        >
          <UserCheck size={15} />
          <span className="truncate">Jatah Karyawan</span>
        </button>
      </div>

      {/* 1. KULAKAN / PEMBELIAN STOK */}
      {activeSubTab === 'kulakan' && (
        <form onSubmit={handlePurchaseSubmit} className="space-y-4">
          {/* Item Selector */}
          <div className="card p-3.5 space-y-2.5">
            <div className="flex items-center justify-between">
              <label className="block text-xs font-semibold text-[var(--mut)] uppercase tracking-wide">
                Pilih Telur / Barang Yang Dibeli:
              </label>
              <span className="text-[11px] text-[var(--mut)] font-medium">
                {activeItems.length} jenis tersedia
              </span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              {activeItems.map((it) => {
                const isSelected = it.id === activeItemId;
                const isPuyuh = it.name.toLowerCase().includes('puyuh');
                const isOmega = it.name.toLowerCase().includes('omega');
                const isMinyak = it.name.toLowerCase().includes('minyak') || it.name.toLowerCase().includes('oil');
                const icon = getItemIcon(it.name);

                return (
                  <button
                    key={it.id}
                    type="button"
                    onClick={() => handleSelectItem(it.id)}
                    className={`p-3 rounded-xl border text-left transition-all relative flex items-center justify-between gap-2 ${
                      isSelected
                        ? 'border-[var(--ac)] bg-emerald-50/60 dark:bg-emerald-950/40 ring-2 ring-[var(--ac)] shadow-sm'
                        : 'border-[var(--bd)] bg-[var(--bg)] hover:border-[var(--ac)] hover:bg-[var(--card)]'
                    }`}
                  >
                    <div className="flex items-center gap-2.5 min-w-0">
                      <div className={`w-9 h-9 rounded-lg flex items-center justify-center text-lg shrink-0 ${
                        isSelected
                          ? 'bg-[var(--ac)] text-white'
                          : 'bg-[var(--card)] border border-[var(--bd)]'
                      }`}>
                        {icon}
                      </div>
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5">
                          <b className={`text-xs truncate ${isSelected ? 'text-[var(--ac)] font-bold' : 'text-[var(--tx)]'}`}>
                            {it.name}
                          </b>
                          {isMinyak && (
                            <span className="text-[9px] px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300 font-bold">
                              Minyak
                            </span>
                          )}
                          {isOmega && (
                            <span className="text-[9px] px-1 py-0.2 rounded bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300 font-bold">
                              Omega
                            </span>
                          )}
                          {isPuyuh && (
                            <span className="text-[9px] px-1 py-0.2 rounded bg-indigo-100 text-indigo-800 dark:bg-indigo-950/60 dark:text-indigo-300 font-bold">
                              Puyuh
                            </span>
                          )}
                        </div>
                        <div className="text-[11px] text-[var(--mut)] mt-0.5">
                          Stok: <b className="text-[var(--tx)] font-mono-numbers">{formatQty(it.gram, it.unit)}</b>
                        </div>
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {currentItem && (
            <div className="card p-4 space-y-3.5">
              <div className="flex items-center justify-between border-b border-[var(--bd)] pb-2.5">
                <div className="flex items-center gap-2">
                  <div className="w-8 h-8 rounded-lg bg-emerald-50 dark:bg-emerald-950/40 text-[var(--ac)] flex items-center justify-center font-bold text-base">
                    {getItemIcon(currentItem.name)}
                  </div>
                  <div>
                    <h3 className="text-sm font-bold text-[var(--tx)] m-0">
                      Kulakan: {currentItem.name}
                    </h3>
                    <p className="text-[11px] text-[var(--mut)] m-0">
                      Sisa stok saat ini: {formatQty(currentItem.gram, currentItem.unit)}
                    </p>
                  </div>
                </div>
              </div>

              {/* Supplier Input */}
              <div>
                <label className="block text-xs font-semibold text-[var(--mut)] uppercase mb-1">
                  Nama Supplier / Peternak:
                </label>
                <input
                  type="text"
                  placeholder="Ketik nama supplier / peternak..."
                  value={supplierInput}
                  onChange={(e) => setSupplierInput(e.target.value)}
                  className="w-full text-xs p-2.5 rounded-lg border border-[var(--bd)] bg-[var(--bg)] text-[var(--tx)] font-semibold"
                />
                {pastSuppliers.length > 0 && (
                  <div className="mt-2">
                    <span className="text-[11px] text-[var(--mut)] block mb-1">
                      Pernah beli di:
                    </span>
                    <div className="flex gap-1.5 overflow-x-auto pb-0.5">
                      {pastSuppliers.map((s) => (
                        <button
                          key={s}
                          type="button"
                          onClick={() => setSupplierInput(s)}
                          className={`text-[11px] py-1 px-2.5 rounded-lg border text-xs font-medium transition-colors shrink-0 ${
                            supplierInput === s
                              ? 'border-[var(--ac)] bg-emerald-50 dark:bg-emerald-950/40 text-[var(--ac)] font-bold'
                              : 'border-[var(--bd)] bg-[var(--bg)] text-[var(--tx)] hover:border-[var(--ac)]'
                          }`}
                        >
                          {s}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {/* Unit Type Selection for Eggs */}
              {!isPcs && (
                <div>
                  <label className="block text-xs font-semibold text-[var(--mut)] uppercase mb-1">
                    Cara Beli Telur:
                  </label>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => setPurchaseUnitType('ikat')}
                      className={`p-2.5 rounded-xl border text-xs font-bold flex items-center justify-center gap-1.5 transition-colors ${
                        purchaseUnitType === 'ikat'
                          ? 'border-[var(--ac)] bg-emerald-50 dark:bg-emerald-950/30 text-[var(--ac)]'
                          : 'border-[var(--bd)] bg-[var(--bg)] text-[var(--mut)]'
                      }`}
                    >
                      <Layers size={15} />
                      <span>Per Ikat (15 Kg/ikat)</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setPurchaseUnitType('kg')}
                      className={`p-2.5 rounded-xl border text-xs font-bold flex items-center justify-center gap-1.5 transition-colors ${
                        purchaseUnitType === 'kg'
                          ? 'border-[var(--ac)] bg-emerald-50 dark:bg-emerald-950/30 text-[var(--ac)]'
                          : 'border-[var(--bd)] bg-[var(--bg)] text-[var(--mut)]'
                      }`}
                    >
                      <span>⚖️ Per Kilogram (Kg)</span>
                    </button>
                  </div>
                </div>
              )}

              {/* Quantity Input */}
              {!isPcs && purchaseUnitType === 'ikat' ? (
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block text-xs font-semibold text-[var(--mut)] uppercase mb-1">
                      Jumlah Ikat:
                    </label>
                    <div className="flex gap-1.5">
                      <input
                        type="number"
                        min="1"
                        placeholder="10"
                        value={ikatCountStr}
                        onChange={(e) => setIkatCountStr(e.target.value)}
                        className="text-base font-mono-numbers font-bold p-2.5 rounded-lg border border-[var(--bd)] bg-[var(--bg)] text-[var(--tx)] text-center flex-1"
                      />
                      <span className="flex items-center text-xs text-[var(--mut)] font-semibold">
                        ikat
                      </span>
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-[var(--mut)] uppercase mb-1">
                      Isi per Ikat (Kg):
                    </label>
                    <div className="flex gap-1.5">
                      <input
                        type="number"
                        step="0.5"
                        placeholder="15"
                        value={kgPerIkatStr}
                        onChange={(e) => setKgPerIkatStr(e.target.value)}
                        className="text-base font-mono-numbers font-bold p-2.5 rounded-lg border border-[var(--bd)] bg-[var(--bg)] text-[var(--tx)] text-center flex-1"
                      />
                      <span className="flex items-center text-xs text-[var(--mut)] font-semibold">
                        kg
                      </span>
                    </div>
                  </div>
                </div>
              ) : (
                <div>
                  <label className="block text-xs font-semibold text-[var(--mut)] uppercase mb-1">
                    {isPcs ? 'Jumlah Pcs Dibeli:' : 'Jumlah Berat Timbangan (Kg):'}
                  </label>
                  <input
                    type="text"
                    inputMode="decimal"
                    placeholder={isPcs ? 'Misal: 24' : 'Misal: 150'}
                    value={rawQtyKgStr}
                    onChange={(e) => setRawQtyKgStr(e.target.value)}
                    className="w-full text-base font-mono-numbers font-bold p-2.5 rounded-lg border border-[var(--bd)] bg-[var(--bg)] text-[var(--tx)] text-center"
                  />
                </div>
              )}

              {/* Cost per Kg / Pcs */}
              <div>
                <label className="block text-xs font-semibold text-[var(--mut)] uppercase mb-1">
                  Harga Modal / Beli (per {unit}):
                </label>
                <div className="flex gap-2">
                  <span className="flex items-center text-sm font-bold text-[var(--mut)] pl-1">
                    Rp
                  </span>
                  <input
                    type="text"
                    inputMode="numeric"
                    placeholder="23.000"
                    value={costPerUnitStr}
                    onChange={(e) => {
                      const val = num(e.target.value);
                      setCostPerUnitStr(val ? val.toLocaleString('id-ID') : '');
                    }}
                    className="text-lg font-mono-numbers font-bold p-2.5 rounded-lg border border-[var(--bd)] bg-[var(--bg)] text-[var(--tx)] flex-1"
                  />
                </div>
              </div>

              {/* Note */}
              <div>
                <label className="block text-xs font-semibold text-[var(--mut)] uppercase mb-1">
                  Catatan Pembelian (Opsional):
                </label>
                <input
                  type="text"
                  placeholder="Contoh: Nota #8821 / Kondisi telur mulus"
                  value={purchaseNote}
                  onChange={(e) => setPurchaseNote(e.target.value)}
                  className="w-full text-xs p-2 rounded-lg border border-[var(--bd)] bg-[var(--bg)] text-[var(--tx)]"
                />
              </div>

              {/* Purchase Calculation Summary */}
              <div className="p-3 rounded-xl bg-emerald-50/70 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800 space-y-1.5 text-xs">
                <div className="flex justify-between items-center text-[var(--tx)]">
                  <span>Total Stok Masuk:</span>
                  <b className="font-mono-numbers text-sm text-[var(--ac)]">{totalPurchaseQtyText}</b>
                </div>
                <div className="flex justify-between items-center text-[var(--tx)]">
                  <span>Harga Beli Modal:</span>
                  <b className="font-mono-numbers">{rp(costPerUnitVal)} / {unit}</b>
                </div>
                <div className="border-t border-emerald-200 dark:border-emerald-800/80 pt-1.5 flex justify-between items-center font-bold text-sm text-[var(--tx)]">
                  <span>Total Pembayaran:</span>
                  <span className="font-mono-numbers text-base text-[var(--ac)]">{rp(totalPurchaseCost)}</span>
                </div>
              </div>

              {/* Submit Button */}
              <button
                type="submit"
                disabled={submitting || totalPurchaseCost <= 0}
                className="btn p w-full py-3 text-sm font-bold flex items-center justify-center gap-1.5 shadow-md"
              >
                <PackagePlus size={16} />
                <span>{submitting ? 'Menyimpan...' : 'Simpan Kulakan & Buat Batch FIFO'}</span>
              </button>
            </div>
          )}
        </form>
      )}

      {/* 2. BIAYA OPERASIONAL TOKO */}
      {activeSubTab === 'operasional' && (
        <form onSubmit={handleOperationalSubmit} className="card p-4 space-y-4">
          <div className="border-b border-[var(--bd)] pb-2.5">
            <h3 className="text-sm font-bold text-[var(--tx)] m-0 flex items-center gap-1.5">
              <ReceiptText size={16} className="text-[var(--ac)]" />
              <span>Pencatatan Biaya Operasional Toko</span>
            </h3>
            <p className="text-[11px] text-[var(--mut)] m-0">
              Pengeluaran operasional di luar belanja stok (pengurang laba bersih)
            </p>
          </div>

          {/* Operational Category */}
          <div>
            <label className="block text-xs font-semibold text-[var(--mut)] uppercase mb-1">
              Kategori Beban:
            </label>
            <div className="grid grid-cols-2 gap-2">
              {OPERATIONAL_CATS.map((cat) => (
                <button
                  key={cat.id}
                  type="button"
                  onClick={() => setSelectedOpCat(cat.id)}
                  className={`p-2.5 rounded-xl border text-xs font-semibold text-left transition-colors ${
                    selectedOpCat === cat.id
                      ? 'border-[var(--ac)] bg-emerald-50 dark:bg-emerald-950/40 text-[var(--ac)]'
                      : 'border-[var(--bd)] bg-[var(--bg)] text-[var(--mut)]'
                  }`}
                >
                  {cat.label}
                </button>
              ))}
            </div>
          </div>

          {/* Nominal Input */}
          <div>
            <label className="block text-xs font-semibold text-[var(--mut)] uppercase mb-1">
              Nominal Pengeluaran:
            </label>
            <div className="flex gap-2">
              <span className="flex items-center text-sm font-bold text-[var(--mut)] pl-1">
                Rp
              </span>
              <input
                type="text"
                inputMode="numeric"
                autoFocus
                placeholder="0"
                value={opNominalStr}
                onChange={(e) => {
                  const val = num(e.target.value);
                  setOpNominalStr(val ? val.toLocaleString('id-ID') : '');
                }}
                className="text-xl font-mono-numbers font-bold p-2.5 rounded-lg border border-[var(--bd)] bg-[var(--bg)] text-[var(--tx)] flex-1 text-center"
              />
            </div>
          </div>

          {/* Quick buttons */}
          <div className="flex gap-1.5">
            {[10000, 25000, 50000, 100000, 200000].map((v) => (
              <button
                key={v}
                type="button"
                onClick={() => setOpNominalStr(v.toLocaleString('id-ID'))}
                className="flex-1 py-1 text-[11px] font-semibold rounded border border-[var(--bd)] bg-[var(--bg)] text-[var(--tx)] hover:bg-[var(--card)]"
              >
                {v >= 1000 ? v / 1000 + 'rb' : v}
              </button>
            ))}
          </div>

          {/* Note Input */}
          <div>
            <label className="block text-xs font-semibold text-[var(--mut)] uppercase mb-1">
              Keterangan:
            </label>
            <input
              type="text"
              placeholder="Contoh: Beli kantong kresek 2 pak / Token listrik toko"
              value={opNoteStr}
              onChange={(e) => setOpNoteStr(e.target.value)}
              className="w-full text-xs p-2.5 rounded-lg border border-[var(--bd)] bg-[var(--bg)] text-[var(--tx)]"
            />
          </div>

          <button
            type="submit"
            disabled={submitting || num(opNominalStr) <= 0}
            className="btn p w-full py-3 text-sm font-bold flex items-center justify-center gap-1.5 shadow-md"
          >
            <CheckCircle2 size={16} />
            <span>{submitting ? 'Menyimpan...' : 'Simpan Biaya Operasional'}</span>
          </button>
        </form>
      )}

      {/* 3. TELUR PECAH / SUSUT TIMBANGAN */}
      {activeSubTab === 'pecah' && (
        <div className="card p-4 space-y-4">
          <div className="flex items-center gap-2 border-b border-[var(--bd)] pb-2.5">
            <div className="w-8 h-8 rounded-lg bg-amber-50 dark:bg-amber-950/40 text-amber-600 flex items-center justify-center font-bold">
              <Egg size={18} />
            </div>
            <div>
              <h3 className="text-sm font-bold text-[var(--tx)] m-0">
                Pencatatan Telur Pecah / Rusak / Susut
              </h3>
              <p className="text-[11px] text-[var(--mut)] m-0">
                Mengurangi stok & menghitung kerugian HPP otomatis
              </p>
            </div>
          </div>

          <p className="text-xs text-[var(--mut)] leading-relaxed">
            Setiap ada telur yang pecah di tray, retak pas bongkar muat, atau susut timbangan, Anda bisa langsung mencatatnya di sini tanpa perlu menimbang manual.
          </p>

          <button
            type="button"
            onClick={() => onOpenEggModal && onOpenEggModal(activeItemId || undefined)}
            className="btn w-full py-3 bg-amber-600 hover:bg-amber-700 text-white font-bold flex items-center justify-center gap-2 shadow-md"
          >
            <Egg size={18} />
            <span>Buka Form Catat Telur Pecah / Susut</span>
          </button>
        </div>
      )}

      {/* 4. JATAH KARYAWAN */}
      {activeSubTab === 'jatah' && currentItem && (
        <form onSubmit={handleAllowanceSubmit} className="card p-4 space-y-4">
          <div className="flex items-center gap-2 border-b border-[var(--bd)] pb-2.5">
            <div className="w-8 h-8 rounded-lg bg-emerald-50 dark:bg-emerald-950/40 text-[var(--ac)] flex items-center justify-center font-bold">
              <UserCheck size={18} />
            </div>
            <div>
              <h3 className="text-sm font-bold text-[var(--tx)] m-0">
                Jatah Karyawan (Stok Toko)
              </h3>
              <p className="text-[11px] text-[var(--mut)] m-0">
                Potong stok & hitung modal jatah otomatis via FIFO
              </p>
            </div>
          </div>

          {/* Item Selector */}
          <div>
            <label className="block text-xs font-semibold text-[var(--mut)] uppercase mb-1">
              Barang Yang Diberikan:
            </label>
            <select
              value={activeItemId || ''}
              onChange={(e) => handleSelectItem(Number(e.target.value))}
              className="w-full text-xs p-2.5 rounded-lg border border-[var(--bd)] bg-[var(--bg)] text-[var(--tx)] font-semibold"
            >
              {activeItems.map((it) => (
                <option key={it.id} value={it.id}>
                  {it.name} (Sisa stok: {formatQty(it.gram, it.unit)})
                </option>
              ))}
            </select>
          </div>

          {/* Amount */}
          <div>
            <label className="block text-xs font-semibold text-[var(--mut)] uppercase mb-1">
              Jumlah Jatah ({unit}):
            </label>
            <input
              type="text"
              inputMode="decimal"
              placeholder="1"
              value={allowanceAmountStr}
              onChange={(e) => setAllowanceAmountStr(e.target.value)}
              className="w-full text-lg font-mono-numbers font-bold p-2.5 rounded-lg border border-[var(--bd)] bg-[var(--bg)] text-[var(--tx)] text-center"
            />
          </div>

          {/* Staff Name */}
          <div>
            <label className="block text-xs font-semibold text-[var(--mut)] uppercase mb-1">
              Nama Karyawan Penerima:
            </label>
            <input
              type="text"
              placeholder="Misal: Budi / Siti"
              value={staffNameStr}
              onChange={(e) => setStaffNameStr(e.target.value)}
              className="w-full text-xs p-2.5 rounded-lg border border-[var(--bd)] bg-[var(--bg)] text-[var(--tx)]"
            />
          </div>

          {/* Note */}
          <div>
            <label className="block text-xs font-semibold text-[var(--mut)] uppercase mb-1">
              Keterangan:
            </label>
            <input
              type="text"
              placeholder="Jatah mingguan"
              value={allowanceNoteStr}
              onChange={(e) => setAllowanceNoteStr(e.target.value)}
              className="w-full text-xs p-2 rounded-lg border border-[var(--bd)] bg-[var(--bg)] text-[var(--tx)]"
            />
          </div>

          {/* Value preview */}
          {allowanceModalCost > 0 && (
            <div className="p-2.5 rounded-xl bg-[var(--bg)] border border-[var(--bd)] text-xs flex justify-between items-center text-[var(--mut)]">
              <span>Beban modal jatah ini:</span>
              <b className="text-[var(--tx)] font-mono-numbers">{rp(allowanceModalCost)}</b>
            </div>
          )}

          <button
            type="submit"
            disabled={allowanceVal <= 0 || isAllowanceInsufficient}
            className="btn p w-full py-3 text-sm font-bold flex items-center justify-center gap-1.5 shadow-md"
          >
            <UserCheck size={16} />
            <span>Keluarkan Jatah & Potong Stok FIFO</span>
          </button>
        </form>
      )}
    </div>
  );
};
