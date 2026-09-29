import React, { useState } from 'react';
import { Item, ItemUnit } from '../types';
import { rp, num, dec, curCost, formatQty, unitLabel, getItemIcon, sortItemsFixedOrder } from '../utils/formatters';
import { Plus, Minus, Trash2 } from 'lucide-react';

interface TabBarangProps {
  items: Item[];
  onAddItem: (itemData: {
    name: string;
    price: number;
    modal: number;
    initialStockKg: number;
    unit: ItemUnit;
  }) => void;
  onUpdateItem: (updatedItem: Item) => void;
  onMoveItem: (itemId: number, direction: -1 | 1) => void;
  onDeleteItem: (id: number) => void | Promise<any>;
  onAddManualStock: (itemId: number, addedQty: number, cost?: number) => Promise<{ success: boolean; error?: string } | void> | void;
  onReduceManualStock: (itemId: number, reducedQty: number) => Promise<{ success: boolean; error?: string } | void> | void;
}

export const TabBarang: React.FC<TabBarangProps> = ({
  items,
  onAddItem,
  onUpdateItem,
  onMoveItem,
  onDeleteItem,
  onAddManualStock,
  onReduceManualStock,
}) => {
  // New item inputs
  const [name, setName] = useState('');
  const [unit, setUnit] = useState<ItemUnit>('kg');
  const [priceStr, setPriceStr] = useState('');
  const [modalStr, setModalStr] = useState('');
  const [stockStr, setStockStr] = useState('');

  // Per-item manual stock adjustment state
  const [manualStockInputs, setManualStockInputs] = useState<Record<number, string>>({});
  // Per-item local editing state for price and modal inputs (enables smooth backspacing & deleting all digits)
  const [priceInputs, setPriceInputs] = useState<Record<number, string>>({});
  const [modalInputs, setModalInputs] = useState<Record<number, string>>({});
  // Per-item delete confirm modal
  const [deleteItemModal, setDeleteItemModal] = useState<Item | null>(null);
  const [deleteLoading, setDeleteLoading] = useState(false);
  // Status message
  const [adjustFeedback, setAdjustFeedback] = useState<{ id: number; msg: string; isError?: boolean } | null>(null);

  const activeItems = sortItemsFixedOrder(items.filter((i) => !i.archived));

  const handlePriceChange = (itemId: number, raw: string, currentItem: Item) => {
    const digits = raw.replace(/\D/g, '');
    if (!digits) {
      setPriceInputs((prev) => ({ ...prev, [itemId]: '' }));
      return;
    }
    const val = parseInt(digits, 10) || 0;
    setPriceInputs((prev) => ({ ...prev, [itemId]: val.toLocaleString('id-ID') }));
    if (val > 0) {
      onUpdateItem({ ...currentItem, price: val });
    }
  };

  const handlePriceBlur = (itemId: number, currentItem: Item) => {
    const raw = priceInputs[itemId];
    if (raw === '' || raw === undefined) {
      setPriceInputs((prev) => {
        const copy = { ...prev };
        delete copy[itemId];
        return copy;
      });
    } else {
      const val = num(raw);
      if (val > 0 && val !== currentItem.price) {
        onUpdateItem({ ...currentItem, price: val });
      }
      setPriceInputs((prev) => {
        const copy = { ...prev };
        delete copy[itemId];
        return copy;
      });
    }
  };

  const handleModalChange = (itemId: number, raw: string, currentItem: Item) => {
    const digits = raw.replace(/\D/g, '');
    if (!digits) {
      setModalInputs((prev) => ({ ...prev, [itemId]: '' }));
      return;
    }
    const val = parseInt(digits, 10) || 0;
    setModalInputs((prev) => ({ ...prev, [itemId]: val.toLocaleString('id-ID') }));
    const updatedBatches = [...(currentItem.batches || [])];
    if (updatedBatches[0]) {
      updatedBatches[0].cost = val;
    }
    onUpdateItem({
      ...currentItem,
      modal: val,
      batches: updatedBatches,
    });
  };

  const handleModalBlur = (itemId: number, currentItem: Item) => {
    const raw = modalInputs[itemId];
    if (raw === '' || raw === undefined) {
      setModalInputs((prev) => {
        const copy = { ...prev };
        delete copy[itemId];
        return copy;
      });
    } else {
      const val = num(raw);
      const updatedBatches = [...(currentItem.batches || [])];
      if (updatedBatches[0]) {
        updatedBatches[0].cost = val;
      }
      onUpdateItem({
        ...currentItem,
        modal: val,
        batches: updatedBatches,
      });
      setModalInputs((prev) => {
        const copy = { ...prev };
        delete copy[itemId];
        return copy;
      });
    }
  };

  const handleNameChange = (val: string) => {
    setName(val);
    if (val.toLowerCase().includes('minyak')) {
      setUnit('pcs');
    }
  };

  const handleCreateItem = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmedName = name.trim();
    const price = num(priceStr);
    const modal = num(modalStr);
    const initialStock = dec(stockStr);

    if (!trimmedName || price <= 0) return;

    onAddItem({
      name: trimmedName,
      price,
      modal,
      initialStockKg: initialStock,
      unit,
    });

    setName('');
    setUnit('kg');
    setPriceStr('');
    setModalStr('');
    setStockStr('');
  };

  const handleManualStockChange = (itemId: number, val: string) => {
    setManualStockInputs((prev) => ({ ...prev, [itemId]: val }));
  };

  const handleAddStock = async (it: Item) => {
    const rawInput = manualStockInputs[it.id] || '';
    const val = dec(rawInput);
    if (val <= 0) {
      setAdjustFeedback({
        id: it.id,
        msg: 'Masukkan angka jumlah yang ingin ditambahkan',
        isError: true,
      });
      setTimeout(() => setAdjustFeedback(null), 3500);
      return;
    }

    const u = unitLabel(it.unit);
    const costPrompt = prompt(
      `Masukkan harga modal per ${u} untuk penambahan stok baru (${val} ${u}):`,
      it.modal ? String(it.modal) : ''
    );
    if (costPrompt === null) return; // user cancelled

    const cost = num(costPrompt);
    if (cost <= 0) {
      setAdjustFeedback({
        id: it.id,
        msg: 'Gagal: Harga modal wajib diisi dan harus lebih dari Rp0!',
        isError: true,
      });
      setTimeout(() => setAdjustFeedback(null), 3500);
      return;
    }

    const res = await onAddManualStock(it.id, val, cost);
    if (res && res.success === false) {
      setAdjustFeedback({
        id: it.id,
        msg: res.error || 'Gagal menambahkan stok',
        isError: true,
      });
      setTimeout(() => setAdjustFeedback(null), 3500);
      return;
    }

    setManualStockInputs((prev) => ({ ...prev, [it.id]: '' }));
    setAdjustFeedback({
      id: it.id,
      msg: `Berhasil! +${val} ${u} ditambahkan (Modal: ${rp(cost)}/${u})`,
    });
    setTimeout(() => setAdjustFeedback(null), 3500);
  };

  const handleReduceStock = async (it: Item) => {
    const rawInput = manualStockInputs[it.id] || '';
    const val = dec(rawInput);
    if (val <= 0) {
      setAdjustFeedback({
        id: it.id,
        msg: 'Masukkan angka jumlah yang ingin dikurangi',
        isError: true,
      });
      setTimeout(() => setAdjustFeedback(null), 3500);
      return;
    }

    const isPcs = it.unit === 'pcs';
    const currentQty = isPcs ? it.gram : it.gram / 1000;
    const u = unitLabel(it.unit);

    if (currentQty <= 0) {
      setAdjustFeedback({
        id: it.id,
        msg: `Stok saat ini 0 ${u}. Tidak ada stok yang bisa dikurangi. Gunakan '+ Tambah' atau catat Kulakan.`,
        isError: true,
      });
      setTimeout(() => setAdjustFeedback(null), 4000);
      return;
    }

    // Smart detection if user entered grams on a kg item (e.g. typing 500 meaning 500 grams when stock is 10 kg)
    if (!isPcs && val > currentQty && val >= 50 && val / 1000 <= currentQty) {
      const suggestedKg = val / 1000;
      setAdjustFeedback({
        id: it.id,
        msg: `Apakah maksud Anda ${suggestedKg} kg (${val} gram)? Masukkan dalam satuan kg (misal: ${suggestedKg.toString().replace('.', ',')})`,
        isError: true,
      });
      setTimeout(() => setAdjustFeedback(null), 5000);
      return;
    }

    if (val > currentQty) {
      setAdjustFeedback({
        id: it.id,
        msg: `Tidak bisa mengurangi ${val} ${u} karena melebihi stok yang ada (${formatQty(it.gram, it.unit)})`,
        isError: true,
      });
      setTimeout(() => setAdjustFeedback(null), 3500);
      return;
    }

    const res = await onReduceManualStock(it.id, val);
    if (res && res.success === false) {
      setAdjustFeedback({
        id: it.id,
        msg: res.error || 'Gagal mengurangi stok',
        isError: true,
      });
      setTimeout(() => setAdjustFeedback(null), 3500);
      return;
    }

    setManualStockInputs((prev) => ({ ...prev, [it.id]: '' }));
    setAdjustFeedback({
      id: it.id,
      msg: `Berhasil! Stok ${it.name} berkurang -${val} ${u}`,
    });
    setTimeout(() => setAdjustFeedback(null), 3500);
  };

  const handleSetActualStock = async (it: Item) => {
    const u = unitLabel(it.unit);
    const isPcs = it.unit === 'pcs';
    const currentQty = isPcs ? it.gram : it.gram / 1000;

    const input = prompt(
      `Koreksi Stok Fisik untuk ${it.name}:\nStok tercatat di sistem: ${formatQty(it.gram, it.unit)}\n\nMasukkan jumlah stok fisik aktual yang sebenarnya ada di toko (${u}):`,
      String(currentQty)
    );
    if (input === null) return; // user cancelled

    const targetQty = dec(input);
    if (targetQty < 0) {
      setAdjustFeedback({
        id: it.id,
        msg: 'Stok tidak boleh berupa angka negatif',
        isError: true,
      });
      setTimeout(() => setAdjustFeedback(null), 3500);
      return;
    }

    const diff = Math.round((targetQty - currentQty) * 1000) / 1000;
    if (Math.abs(diff) < 0.001) {
      setAdjustFeedback({
        id: it.id,
        msg: 'Jumlah stok fisik sama dengan stok sistem, tidak ada perubahan.',
      });
      setTimeout(() => setAdjustFeedback(null), 3000);
      return;
    }

    if (diff < 0) {
      // Need to reduce stock by Math.abs(diff)
      const reduceVal = Math.abs(diff);
      const res = await onReduceManualStock(it.id, reduceVal);
      if (res && res.success === false) {
        setAdjustFeedback({
          id: it.id,
          msg: res.error || 'Gagal mengoreksi stok',
          isError: true,
        });
        setTimeout(() => setAdjustFeedback(null), 3500);
        return;
      }
      setAdjustFeedback({
        id: it.id,
        msg: `Koreksi berhasil! Stok ${it.name} disesuaikan berkurang ${reduceVal} ${u} menjadi ${targetQty} ${u}`,
      });
      setTimeout(() => setAdjustFeedback(null), 4000);
    } else {
      // Need to add stock by diff
      const addVal = diff;
      const costPrompt = prompt(
        `Penyesuaian stok bertambah ${addVal} ${u}.\nMasukkan harga modal per ${u}:`,
        it.modal ? String(it.modal) : ''
      );
      if (costPrompt === null) return;
      const cost = num(costPrompt);
      if (cost <= 0) {
        setAdjustFeedback({
          id: it.id,
          msg: 'Gagal: Harga modal wajib diisi dan harus lebih dari Rp0!',
          isError: true,
        });
        setTimeout(() => setAdjustFeedback(null), 3500);
        return;
      }
      const res = await onAddManualStock(it.id, addVal, cost);
      if (res && res.success === false) {
        setAdjustFeedback({
          id: it.id,
          msg: res.error || 'Gagal menambahkan stok',
          isError: true,
        });
        setTimeout(() => setAdjustFeedback(null), 3500);
        return;
      }
      setAdjustFeedback({
        id: it.id,
        msg: `Koreksi berhasil! Stok ${it.name} disesuaikan bertambah ${addVal} ${u} menjadi ${targetQty} ${u}`,
      });
      setTimeout(() => setAdjustFeedback(null), 4000);
    }
  };

  return (
    <section className="space-y-3">
      {/* Tambah barang */}
      <form onSubmit={handleCreateItem} className="card">
        <h2>TAMBAH BARANG</h2>
        <input
          type="text"
          placeholder="Nama barang (mis. Minyak, Telur, Gula)"
          value={name}
          onChange={(e) => handleNameChange(e.target.value)}
        />

        {/* Satuan Selector */}
        <div className="flex gap-2 mt-2 items-center">
          <span className="text-xs text-[var(--mut)] font-semibold uppercase">
            Satuan:
          </span>
          {(['kg', 'pcs'] as const).map((u) => (
            <button
              key={u}
              type="button"
              onClick={() => setUnit(u)}
              className={`py-1.5 px-3 rounded-lg text-xs font-bold border transition-all ${
                unit === u
                  ? 'bg-[var(--ac)] text-[var(--acx)] border-[var(--ac)]'
                  : 'bg-[var(--bg)] text-[var(--tx)] border-[var(--bd)]'
              }`}
            >
              {u === 'pcs' ? 'Pcs (Minyak, Botol, dll)' : 'Kg (Telur, Gula, dll)'}
            </button>
          ))}
        </div>

        <div className="row">
          <input
            type="text"
            inputMode="numeric"
            placeholder={`Harga jual per ${unit}`}
            value={priceStr ? (parseInt(priceStr.replace(/\D/g, ''), 10) || '').toLocaleString('id-ID') : ''}
            onChange={(e) => {
              const digits = e.target.value.replace(/\D/g, '');
              setPriceStr(digits);
            }}
            className="font-mono-numbers"
          />
          <input
            type="text"
            inputMode="numeric"
            placeholder={`Harga modal per ${unit}`}
            value={modalStr ? (parseInt(modalStr.replace(/\D/g, ''), 10) || '').toLocaleString('id-ID') : ''}
            onChange={(e) => {
              const digits = e.target.value.replace(/\D/g, '');
              setModalStr(digits);
            }}
            className="font-mono-numbers"
          />
        </div>

        <div className="row">
          <input
            type="text"
            inputMode="decimal"
            placeholder={`Stok awal (${unit})`}
            value={stockStr}
            onChange={(e) => setStockStr(e.target.value)}
            className="font-mono-numbers"
          />
        </div>

        <button
          type="submit"
          disabled={!name.trim() || num(priceStr) <= 0}
          className="btn p"
        >
          Tambah Barang ({unit})
        </button>
      </form>

      {/* Daftar barang */}
      <div className="card">
        <h2>DAFTAR BARANG</h2>
        <div className="mut text-[13px] -mt-1 mb-2 leading-tight">
          Urutan tetap toko (#1 Telur Biasa, #2 Telur Omega, #3 Telur Puyuh, #4 Minyak Kita 1 L, #5 Minyak Kita 2 L, #6 Minyak Premium).
        </div>

        <div className="divide-y divide-[var(--bd)]">
          {activeItems.length === 0 ? (
            <div className="py-4 text-center text-sm text-[var(--mut)]">
              Belum ada barang terdaftar
            </div>
          ) : (
            activeItems.map((it, idx) => {
              const u = unitLabel(it.unit);
              const cc = curCost(it);
              const margin = it.price > 0 ? Math.round(((it.price - cc) / it.price) * 100) : 0;
              const feedback = adjustFeedback?.id === it.id ? adjustFeedback : null;

              return (
                <div key={it.id} className="item">
                  {/* Top Bar */}
                  <div className="top">
                    <span className="flex items-center gap-1.5">
                      <span className="text-[11px] font-bold px-1.5 py-0.5 rounded bg-[var(--bd)] text-[var(--mut)]">
                        #{idx + 1}
                      </span>
                      <span className="text-base ml-1 mr-0.5 shrink-0">{getItemIcon(it.name)}</span>
                      <b className="text-base text-[var(--tx)]">{it.name}</b>
                      <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-[var(--bg)] border border-[var(--bd)] text-[var(--mut)] uppercase">
                        {u}
                      </span>
                    </span>
                    <span className="flex items-center gap-2">
                      <span className="mut font-mono-numbers text-sm">
                        Stok: <b className="text-[var(--tx)]">{formatQty(it.gram, it.unit)}</b>
                      </span>
                      <button
                        type="button"
                        onClick={() => handleSetActualStock(it)}
                        className="py-1 px-2 rounded-lg border border-[var(--bd)] bg-[var(--card)] hover:border-[var(--ac)] text-[11px] font-semibold text-[var(--mut)] hover:text-[var(--tx)] transition-colors"
                        title="Sesuaikan langsung dengan jumlah stok fisik di toko"
                      >
                        Set Stok
                      </button>
                      <button
                        type="button"
                        onClick={() => setDeleteItemModal(it)}
                        className="p-1.5 rounded-lg text-rose-500 hover:text-rose-700 hover:bg-rose-50 dark:hover:bg-rose-950/40 transition-colors"
                        title="Hapus barang dari daftar"
                      >
                        <Trash2 size={16} />
                      </button>
                    </span>
                  </div>

                  {/* Price Row */}
                  <div className="row">
                    <input
                      type="text"
                      inputMode="numeric"
                      value={
                        priceInputs[it.id] !== undefined
                          ? priceInputs[it.id]
                          : it.price > 0
                          ? it.price.toLocaleString('id-ID')
                          : ''
                      }
                      placeholder={`Harga jual per ${u}`}
                      aria-label={`Harga jual per ${u}`}
                      onChange={(e) => handlePriceChange(it.id, e.target.value, it)}
                      onBlur={() => handlePriceBlur(it.id, it)}
                      className="font-mono-numbers"
                    />
                    <span className="mut text-sm shrink-0 whitespace-nowrap">jual/{u}</span>
                  </div>

                  {/* Modal / Cost Row */}
                  <div className="row">
                    <input
                      type="text"
                      inputMode="numeric"
                      value={
                        modalInputs[it.id] !== undefined
                          ? modalInputs[it.id]
                          : cc > 0
                          ? cc.toLocaleString('id-ID')
                          : ''
                      }
                      placeholder={`Harga modal per ${u}`}
                      aria-label={`Harga modal per ${u}`}
                      onChange={(e) => handleModalChange(it.id, e.target.value, it)}
                      onBlur={() => handleModalBlur(it.id, it)}
                      className="font-mono-numbers"
                    />
                    <span className="mut text-sm shrink-0 whitespace-nowrap">
                      modal/{u} (stok aktif)
                    </span>
                  </div>

                  {/* Profit Margin Info */}
                  <div className="mut text-sm mt-1.5 font-mono-numbers">
                    {cc > 0 ? (
                      <span>
                        Untung {rp(it.price - cc)}/{u} · margin {margin}%
                      </span>
                    ) : (
                      <span className="err">Isi harga modal untuk melihat margin</span>
                    )}
                  </div>

                  {/* Batches Queue Info */}
                  <div className="mut text-[13px] mt-1.5 font-mono-numbers bg-[var(--bg)] p-2 rounded-lg border border-[var(--bd)]">
                    Antrean stok:{' '}
                    {it.batches && it.batches.length > 0
                      ? it.batches
                          .map((b) => `${formatQty(b.gram, it.unit)} @ ${rp(b.cost)}`)
                          .join(' → ')
                      : 'kosong'}
                  </div>

                  {/* Manual Stock Adjustment (Tambah & Kurang) */}
                  <div className="mt-2.5 p-2 bg-[var(--bg)] rounded-xl border border-[var(--bd)] space-y-1.5">
                    <div className="flex items-center justify-between text-xs font-semibold text-[var(--mut)] uppercase">
                      <span>Penyesuaian Stok Manual ({u})</span>
                      <span className="text-[11px] font-normal normal-case opacity-80">
                        Tambah stok baru atau kurangi stok rusak/hilang
                      </span>
                    </div>

                    <div className="flex gap-1.5 items-center">
                      <input
                        type="text"
                        inputMode="decimal"
                        placeholder={`Jumlah (${u})`}
                        value={manualStockInputs[it.id] || ''}
                        onChange={(e) => handleManualStockChange(it.id, e.target.value)}
                        className="font-mono-numbers text-sm flex-1 py-1.5 px-2.5"
                      />

                      {/* Tambah Button */}
                      <button
                        type="button"
                        onClick={() => handleAddStock(it)}
                        className="btn sm shrink-0 flex items-center gap-1 text-xs py-1.5 px-3 bg-emerald-600 hover:bg-emerald-700 text-white border-emerald-600"
                        title="Tambah stok manual"
                      >
                        <Plus size={14} /> Tambah
                      </button>

                      {/* Kurangi Button */}
                      <button
                        type="button"
                        onClick={() => handleReduceStock(it)}
                        className="btn sm shrink-0 flex items-center gap-1 text-xs py-1.5 px-3 bg-amber-600 hover:bg-amber-700 text-white border-amber-600"
                        title="Kurangi stok manual (pecah/rusak/susut)"
                      >
                        <Minus size={14} /> Kurang
                      </button>

                      {/* Delete Item Button */}
                      <button
                        type="button"
                        onClick={() => setDeleteItemModal(it)}
                        className="btn sm red shrink-0 text-xs py-1.5 px-2.5 flex items-center gap-1"
                        title="Hapus barang dari daftar"
                      >
                        <Trash2 size={13} /> Hapus
                      </button>
                    </div>

                    {/* Feedback message */}
                    {feedback && (
                      <div
                        className={`text-xs font-semibold py-1 px-2 rounded-lg animate-fadeIn ${
                          feedback.isError
                            ? 'bg-red-50 dark:bg-red-950/60 text-red-600 border border-red-300 dark:border-red-900'
                            : 'bg-emerald-50 dark:bg-emerald-950/60 text-[var(--ac)] border border-emerald-300 dark:border-emerald-800'
                        }`}
                      >
                        {feedback.msg}
                      </div>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* Safe In-App Confirmation Modal for Deleting Item */}
      {deleteItemModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs animate-in fade-in duration-200">
          <div className="bg-[var(--card)] border border-[var(--bd)] rounded-2xl w-full max-w-sm p-5 shadow-2xl space-y-4">
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-xl bg-rose-50 dark:bg-rose-950/40 text-rose-600 flex items-center justify-center shrink-0">
                <Trash2 size={20} />
              </div>
              <div className="min-w-0">
                <h3 className="font-bold text-base text-[var(--tx)]">Hapus Barang dari Stok</h3>
                <p className="text-xs text-[var(--mut)] mt-0.5 break-words">
                  {deleteItemModal.name} ({unitLabel(deleteItemModal.unit)}) • Stok: {formatQty(deleteItemModal.gram, deleteItemModal.unit)}
                </p>
              </div>
            </div>

            <p className="text-xs text-[var(--tx)]">
              Yakin ingin menghapus <b>{deleteItemModal.name}</b> dari daftar produk? Barang akan dinonaktifkan dari kasir dan inventaris.
            </p>

            <div className="flex flex-col gap-2 pt-1">
              <button
                type="button"
                disabled={deleteLoading}
                onClick={async () => {
                  setDeleteLoading(true);
                  try {
                    await onDeleteItem(deleteItemModal.id);
                  } finally {
                    setDeleteLoading(false);
                    setDeleteItemModal(null);
                  }
                }}
                className="w-full py-2.5 px-3 rounded-xl bg-rose-600 hover:bg-rose-700 active:scale-[0.98] text-white font-semibold text-xs flex items-center justify-center gap-1.5 transition-all shadow-sm"
              >
                <Trash2 size={14} /> Ya, Hapus Barang
              </button>

              <button
                type="button"
                disabled={deleteLoading}
                onClick={() => setDeleteItemModal(null)}
                className="w-full py-2 px-3 rounded-xl border border-[var(--bd)] text-[var(--tx)] hover:bg-[var(--bg)] font-medium text-xs transition-colors"
              >
                Batal
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
};
