import React, { useState } from 'react';
import { Item, Sale, Expense, Purchase, StockAdjustment, StaffAllowance, PeriodType } from '../types';
import { rp, stokVal, hppOf, formatQty, unitLabel, getItemIcon } from '../utils/formatters';
import {
  Download,
  AlertTriangle,
  User,
  Shield,
  Gift,
  Truck,
  Egg,
  ReceiptText,
  DollarSign,
  TrendingUp,
  Package,
  Boxes,
  Trash2,
  Wallet,
} from 'lucide-react';

interface TabRiwayatProps {
  items: Item[];
  sales: Sale[];
  expenses: Expense[];
  purchases: Purchase[];
  adjustments: StockAdjustment[];
  allowances?: StaffAllowance[];
  onCancelSale: (saleId: number) => void | Promise<any>;
  onDeleteSale?: (saleId: number) => void | Promise<any>;
  onCancelExpense: (expenseId: number) => void | Promise<any>;
  onDeleteExpense?: (expenseId: number) => void | Promise<any>;
  onCancelPurchase?: (purchaseId: number) => void | Promise<any>;
  onDeletePurchase?: (purchaseId: number) => void | Promise<any>;
  onCancelAdjustment?: (adjId: number) => void | Promise<any>;
  onDeleteAdjustment?: (adjId: number) => void | Promise<any>;
  onCancelAllowance?: (allowanceId: number) => void | Promise<any>;
  onDeleteAllowance?: (allowanceId: number) => void | Promise<any>;
  onResetDemo: () => void;
}

export const TabRiwayat: React.FC<TabRiwayatProps> = ({
  items,
  sales,
  expenses,
  purchases = [],
  adjustments = [],
  allowances = [],
  onCancelSale,
  onDeleteSale,
  onCancelExpense,
  onDeleteExpense,
  onCancelPurchase,
  onDeletePurchase,
  onCancelAdjustment,
  onDeleteAdjustment,
  onCancelAllowance,
  onDeleteAllowance,
  onResetDemo,
}) => {
  const [per, setPer] = useState<PeriodType>('hari');
  const [filterType, setFilterType] = useState<'all' | 'sale' | 'purchase' | 'op' | 'pecah' | 'jatah'>('all');
  const [errorMessage, setErrorMessage] = useState<string>('');
  const [dlStatus, setDlStatus] = useState<string>('');
  const [actionLoading, setActionLoading] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState<{
    type: 'sale' | 'purchase' | 'allowance' | 'expense' | 'adjustment';
    id: number;
    title: string;
    details: string;
    isCancelled?: boolean;
  } | null>(null);

  const inRange = (t: number): boolean => {
    const d = new Date(t);
    const n = new Date();
    if (per === 'hari') {
      return d.toDateString() === n.toDateString();
    }
    if (per === 'bulan') {
      return d.getMonth() === n.getMonth() && d.getFullYear() === n.getFullYear();
    }
    return true;
  };

  type HistoryRow =
    | ({ k: 'sale' } & Sale)
    | ({ k: 'expense' } & Expense)
    | ({ k: 'purchase' } & Purchase)
    | ({ k: 'adjustment' } & StockAdjustment)
    | ({ k: 'allowance' } & StaffAllowance);

  const allRows: HistoryRow[] = [
    ...sales.map((x) => ({ ...x, k: 'sale' as const })),
    ...expenses.map((x) => ({ ...x, k: 'expense' as const })),
    ...purchases.map((x) => ({ ...x, k: 'purchase' as const })),
    ...adjustments.map((x) => ({ ...x, k: 'adjustment' as const })),
    ...allowances.map((x) => ({ ...x, k: 'allowance' as const })),
  ];

  const filteredPeriodRows = allRows
    .filter((x) => inRange(x.t))
    .sort((a, b) => b.t - a.t);

  // Financial Calculations for the selected period
  const periodSales = filteredPeriodRows.filter((x): x is { k: 'sale' } & Sale => x.k === 'sale' && x.status !== 'cancelled');
  const periodExpenses = filteredPeriodRows.filter((x): x is { k: 'expense' } & Expense => x.k === 'expense' && x.status !== 'cancelled');
  const periodPurchases = filteredPeriodRows.filter((x): x is { k: 'purchase' } & Purchase => x.k === 'purchase' && x.status !== 'cancelled');
  const periodAdjustments = filteredPeriodRows.filter((x): x is { k: 'adjustment' } & StockAdjustment => x.k === 'adjustment' && x.status !== 'cancelled');
  const periodAllowances = filteredPeriodRows.filter((x): x is { k: 'allowance' } & StaffAllowance => x.k === 'allowance' && x.status !== 'cancelled');

  // 1. Omzet & HPP (Permanent Historical FIFO)
  const omzet = periodSales.reduce((a, x) => a + x.nominal, 0);
  const totalHppSold = periodSales.reduce((a, x) => a + (x.hpp || hppOf(x, items)), 0);
  const grossProfit = omzet - totalHppSold;

  // 2. Beban Operasional Kas Murni (Plastik, Listrik, Gaji)
  const opex = periodExpenses.reduce((a, x) => a + x.nominal, 0);

  // 3. Beban Konsumsi Non-Penjualan (Kerugian Telur Pecah & Modal Jatah Karyawan)
  const brokenEggsLoss = periodAdjustments
    .filter((x) => x.qty < 0)
    .reduce((a, x) => a + (x.hppValue || 0), 0);

  const jatahModalCost = periodAllowances.reduce((a, x) => a + (x.hppCost || 0), 0);
  const totalLossNonSales = brokenEggsLoss + jatahModalCost;

  // 4. Laba Bersih Real Toko (Akuntansi P&L)
  const netProfit = grossProfit - opex - totalLossNonSales;

  // 5. Arus Kas Toko (Cash Flow)
  const totalPurchaseSpent = periodPurchases.reduce((a, x) => a + x.totalCost, 0);
  const cashIn = omzet;
  const cashOut = totalPurchaseSpent + opex;
  const netCashflow = cashIn - cashOut;

  // 6. Total Nilai Stok di Toko Saat Ini (Aset Persediaan)
  let totalStockVal = 0;
  items.forEach((i) => {
    totalStockVal += stokVal(i);
  });

  // Filtered rows for the list
  const displayRows = filteredPeriodRows.filter((x) => {
    if (filterType === 'sale') return x.k === 'sale';
    if (filterType === 'purchase') return x.k === 'purchase';
    if (filterType === 'op') return x.k === 'expense';
    if (filterType === 'pecah') return x.k === 'adjustment';
    if (filterType === 'jatah') return x.k === 'allowance';
    return true;
  });

  // CSV Export
  const handleDownloadCsv = () => {
    try {
      const P: Record<PeriodType, string> = {
        hari: 'Hari ini',
        bulan: 'Bulan ini',
        semua: 'Semua Waktu',
      };

      const q = (v: any) => `"${String(v == null ? '' : v).replace(/"/g, '""')}"`;

      const L: any[][] = [
        ['LAPORAN PEMBUKUAN TOKO ALMAIR'],
        ['Periode', P[per]],
        ['Tanggal Cetak', new Date().toLocaleString('id-ID')],
        [],
        ['1. LAPORAN LABA / RUGI REAL (P&L)'],
        ['Omzet Penjualan', omzet],
        ['HPP Modal Telur Terjual (FIFO)', totalHppSold],
        ['LABA KOTOR', grossProfit],
        ['Biaya Operasional Toko', opex],
        ['Kerugian Modal Telur Pecah', brokenEggsLoss],
        ['Modal Jatah Karyawan', jatahModalCost],
        ['LABA BERSIH REAL', netProfit],
        [],
        ['2. LAPORAN ARUS KAS (CASH FLOW)'],
        ['Uang Masuk Kasir (Omzet)', cashIn],
        ['Uang Belanja Kulakan Stok', totalPurchaseSpent],
        ['Uang Operasional Toko', opex],
        ['NET CASH FLOW (Selisih Kas)', netCashflow],
        [],
        ['3. STATUS STOK GUDANG SAAT INI'],
        ['Nama Barang', 'Satuan', 'Sisa Stok', 'Nilai Modal Persediaan (Rp)'],
        ...items.map((i) => [
          i.name,
          unitLabel(i.unit),
          i.unit === 'pcs' ? i.gram : i.gram / 1000,
          stokVal(i),
        ]),
        [],
        ['4. RINCIAN TRANSAKSI DETAIL'],
        ['Waktu', 'Jenis', 'Nama / Keterangan', 'Oleh', 'Jumlah', 'Satuan', 'Nominal / Nilai (Rp)', 'Modal HPP (Rp)', 'Laba Kotor (Rp)'],
      ];

      filteredPeriodRows.forEach((r) => {
        const timeStr = new Date(r.t).toLocaleString('id-ID');
        if (r.k === 'sale') {
          const hpp = r.hpp || hppOf(r, items);
          L.push([timeStr, 'Penjualan', r.name, r.by === 'karyawan' ? 'Kasir' : 'Pemilik', r.unit === 'pcs' ? r.gram : r.gram / 1000, unitLabel(r.unit), r.nominal, hpp, r.nominal - hpp]);
        } else if (r.k === 'purchase') {
          L.push([timeStr, 'Kulakan Stok', `${r.itemName} (${r.supplier})`, 'Pemilik', r.qty / 1000, unitLabel(r.unit), r.totalCost, r.totalCost, 0]);
        } else if (r.k === 'adjustment') {
          L.push([timeStr, `Penyesuaian (${r.reason})`, r.itemName, r.by === 'karyawan' ? 'Kasir' : 'Pemilik', Math.abs(r.qty) / 1000, unitLabel(r.unit), 0, r.hppValue, -r.hppValue]);
        } else if (r.k === 'allowance') {
          L.push([timeStr, 'Jatah Karyawan', `${r.itemName} (${r.staffName})`, 'Pemilik', r.gram / 1000, unitLabel(r.unit), 0, r.hppCost, -r.hppCost]);
        } else if (r.k === 'expense') {
          L.push([timeStr, `Operasional (${r.cat})`, r.note || r.cat, 'Pemilik', '', '', r.nominal, r.nominal, 0]);
        }
      });

      const csvContent = L.map((row) => row.map(q).join(';')).join('\r\n');
      const blob = new Blob(['\uFEFF' + csvContent], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `laporan-almair-${per}-${new Date().toISOString().slice(0, 10)}.csv`;
      link.click();
      URL.revokeObjectURL(url);
      setDlStatus('Laporan CSV berhasil diunduh!');
      setTimeout(() => setDlStatus(''), 3000);
    } catch {
      setErrorMessage('Gagal mengunduh CSV');
    }
  };

  return (
    <div className="space-y-4">
      {/* Error / Feedback Message */}
      {errorMessage && (
        <div className="p-3 rounded-xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900 text-xs text-rose-700 dark:text-rose-300 flex items-center justify-between">
          <span>{errorMessage}</span>
          <button
            type="button"
            onClick={() => setErrorMessage('')}
            className="text-xs font-bold hover:underline ml-2"
          >
            Tutup
          </button>
        </div>
      )}

      {/* Period Filter */}
      <div className="flex items-center justify-between">
        <div className="flex gap-1.5 p-1 rounded-xl bg-[var(--card)] border border-[var(--bd)]">
          {(['hari', 'bulan', 'semua'] as PeriodType[]).map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => setPer(p)}
              className={`py-1 px-3 rounded-lg text-xs font-bold transition-all capitalize ${
                per === p
                  ? 'bg-[var(--ac)] text-white shadow-sm'
                  : 'text-[var(--mut)] hover:text-[var(--tx)]'
              }`}
            >
              {p === 'hari' ? 'Hari Ini' : p === 'bulan' ? 'Bulan Ini' : 'Semua'}
            </button>
          ))}
        </div>

        <button
          type="button"
          onClick={handleDownloadCsv}
          className="btn sm flex items-center gap-1.5 text-xs font-semibold py-1.5 px-3"
          title="Unduh Laporan Excel / CSV"
        >
          <Download size={14} />
          <span>Unduh CSV</span>
        </button>
      </div>

      {dlStatus && (
        <div className="text-xs text-center font-medium text-[var(--ac)] p-1">
          {dlStatus}
        </div>
      )}

      {/* 1. KARTU LABA RUGI REAL (P&L) */}
      <div className="card p-4 space-y-3.5 shadow-sm">
        <div className="flex items-center justify-between border-b border-[var(--bd)] pb-2.5">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-emerald-50 dark:bg-emerald-950/40 text-[var(--ac)] flex items-center justify-center font-bold">
              <TrendingUp size={16} />
            </div>
            <div>
              <h2 className="text-sm font-bold text-[var(--tx)] m-0">
                Laporan Laba / Rugi Real (P&L)
              </h2>
              <p className="text-[11px] text-[var(--mut)] m-0">
                HPP dihitung permanen saat transaksi via FIFO murni
              </p>
            </div>
          </div>
          <span className="text-xs font-mono-numbers font-semibold text-[var(--mut)]">
            {per === 'hari' ? 'Hari Ini' : per === 'bulan' ? 'Bulan Ini' : 'Semua'}
          </span>
        </div>

        {/* Financial Flow Rows */}
        <div className="space-y-2 text-xs">
          {/* Omzet */}
          <div className="flex justify-between items-center p-2 rounded-lg bg-[var(--bg)]">
            <span className="font-semibold text-[var(--tx)] flex items-center gap-1.5">
              <span>💰</span> Omzet Penjualan ({periodSales.length} transaksi)
            </span>
            <b className="font-mono-numbers text-sm text-[var(--tx)]">{rp(omzet)}</b>
          </div>

          {/* HPP Modal Terjual */}
          <div className="flex justify-between items-center p-2 rounded-lg bg-[var(--bg)] text-[var(--mut)]">
            <span className="flex items-center gap-1.5">
              <span>📉</span> Modal Telur / Barang Terjual (HPP FIFO)
            </span>
            <b className="font-mono-numbers text-[var(--tx)]">- {rp(totalHppSold)}</b>
          </div>

          {/* Laba Kotor */}
          <div className="flex justify-between items-center p-2.5 rounded-lg bg-emerald-50/60 dark:bg-emerald-950/20 border border-emerald-200 dark:border-emerald-800/60 font-bold">
            <span className="text-[var(--ac)] flex items-center gap-1.5">
              <span>🟩</span> Laba Kotor Usaha
            </span>
            <span className="font-mono-numbers text-sm text-[var(--ac)]">{rp(grossProfit)}</span>
          </div>

          {/* Beban Operasional Kas */}
          <div className="flex justify-between items-center p-2 rounded-lg bg-[var(--bg)] text-[var(--mut)]">
            <span className="flex items-center gap-1.5">
              <span>🧾</span> Biaya Operasional Toko (Plastik, Listrik, Gaji)
            </span>
            <b className="font-mono-numbers text-[var(--tx)]">- {rp(opex)}</b>
          </div>

          {/* Beban Telur Pecah & Jatah Karyawan */}
          {totalLossNonSales > 0 && (
            <div className="flex justify-between items-center p-2 rounded-lg bg-[var(--bg)] text-[var(--mut)]">
              <span className="flex items-center gap-1.5">
                <span>🥚</span> Beban Telur Pecah ({rp(brokenEggsLoss)}) + Jatah ({rp(jatahModalCost)})
              </span>
              <b className="font-mono-numbers text-amber-600">- {rp(totalLossNonSales)}</b>
            </div>
          )}

          {/* Laba Bersih Real */}
          <div className="flex justify-between items-center p-3 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-700 text-white font-bold shadow-sm">
            <div className="flex flex-col">
              <span className="text-sm">🎯 LABA BERSIH REAL TOKO</span>
              <span className="text-[10px] text-emerald-100 font-normal">
                Keuntungan bersih setelah modal, operasional, & susut
              </span>
            </div>
            <span className="font-mono-numbers text-lg font-black tracking-wide">
              {rp(netProfit)}
            </span>
          </div>
        </div>
      </div>

      {/* 2. KARTU ARUS KAS (CASH FLOW) & PERSINGGAHAN STOK */}
      <div className="grid grid-cols-2 gap-2 text-xs">
        {/* Cashflow Card */}
        <div className="card p-3 space-y-1.5 border border-blue-200 dark:border-blue-900/60 bg-blue-50/30 dark:bg-blue-950/20">
          <div className="flex items-center gap-1 text-[var(--mut)] font-semibold">
            <Wallet size={13} className="text-blue-600" />
            <span>Arus Kas (Cash Flow)</span>
          </div>
          <div className="text-[11px] text-[var(--mut)] space-y-0.5">
            <div className="flex justify-between">
              <span>Masuk:</span> <span className="font-mono-numbers text-[var(--tx)]">{rp(cashIn)}</span>
            </div>
            <div className="flex justify-between">
              <span>Keluar:</span> <span className="font-mono-numbers text-rose-600">-{rp(cashOut)}</span>
            </div>
            <div className="border-t border-blue-200 dark:border-blue-800 pt-1 flex justify-between font-bold text-xs text-[var(--tx)]">
              <span>Net:</span>
              <span className={`font-mono-numbers ${netCashflow >= 0 ? 'text-blue-600' : 'text-rose-600'}`}>
                {rp(netCashflow)}
              </span>
            </div>
          </div>
        </div>

        {/* Stock Valuation Card */}
        <div className="card p-3 space-y-1.5 border border-amber-200 dark:border-amber-900/60 bg-amber-50/30 dark:bg-amber-950/20">
          <div className="flex items-center gap-1 text-[var(--mut)] font-semibold">
            <Boxes size={13} className="text-amber-600" />
            <span>Total Stok di Toko</span>
          </div>
          <div className="text-[11px] text-[var(--mut)] space-y-0.5">
            <b className="text-sm font-mono-numbers text-amber-600 dark:text-amber-400 block">
              {rp(totalStockVal)}
            </b>
            <span className="text-[10px] text-[var(--mut)] block leading-tight">
              Aset modal persediaan fisik di rak & gudang saat ini
            </span>
          </div>
        </div>
      </div>

      {/* FILTER TRANSAKSI LIST */}
      <div className="flex items-center gap-1 overflow-x-auto pb-1 scrollbar-thin">
        {[
          { id: 'all', label: 'Semua' },
          { id: 'sale', label: 'Penjualan' },
          { id: 'purchase', label: 'Kulakan' },
          { id: 'op', label: 'Operasional' },
          { id: 'pecah', label: 'Telur Pecah' },
          { id: 'jatah', label: 'Jatah Karyawan' },
        ].map((f) => (
          <button
            key={f.id}
            type="button"
            onClick={() => setFilterType(f.id as any)}
            className={`py-1 px-2.5 rounded-lg border text-xs font-semibold whitespace-nowrap shrink-0 transition-colors ${
              filterType === f.id
                ? 'border-[var(--ac)] bg-[var(--ac)] text-white'
                : 'border-[var(--bd)] bg-[var(--card)] text-[var(--mut)] hover:text-[var(--tx)]'
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {/* DAFTAR TRANSAKSI DETAIL */}
      <div className="space-y-2">
        {displayRows.length === 0 ? (
          <div className="card p-6 text-center text-xs text-[var(--mut)]">
            Belum ada catatan transaksi pada filter ini.
          </div>
        ) : (
          displayRows.map((r) => {
            const timeStr = new Date(r.t).toLocaleTimeString('id-ID', {
              hour: '2-digit',
              minute: '2-digit',
            });
            const dateStr = new Date(r.t).toLocaleDateString('id-ID', {
              day: 'numeric',
              month: 'short',
            });

            // 1. PENJUALAN
            if (r.k === 'sale') {
              const isCancelled = r.status === 'cancelled';
              const hpp = r.hpp || hppOf(r);
              const profit = r.nominal - hpp;
              return (
                <div
                  key={`s-${r.id}`}
                  className={`card p-3 flex items-center justify-between gap-3 text-xs transition-opacity ${
                    isCancelled ? 'opacity-60 bg-rose-50/20 dark:bg-rose-950/10' : ''
                  }`}
                >
                  <div className="flex items-center gap-2.5 min-w-0">
                    <div className={`w-8 h-8 rounded-lg flex items-center justify-center font-bold shrink-0 ${
                      isCancelled ? 'bg-rose-100 dark:bg-rose-900/40 text-rose-500' : 'bg-emerald-50 dark:bg-emerald-950/40 text-[var(--ac)]'
                    }`}>
                      {isCancelled ? '❌' : '💰'}
                    </div>
                    <div className="min-w-0">
                      <div className="font-bold text-[var(--tx)] truncate flex items-center gap-1.5">
                        <span className="text-sm shrink-0">{getItemIcon(r.name)}</span>
                        <span className={isCancelled ? 'line-through text-[var(--mut)]' : ''}>{r.name}</span>
                        <span className="text-[10px] py-0.5 px-1.5 rounded bg-[var(--bg)] text-[var(--mut)] font-mono-numbers">
                          {formatQty(r.gram, r.unit)}
                        </span>
                        {isCancelled && (
                          <span className="text-[9px] font-bold py-0.5 px-1.5 rounded bg-rose-100 text-rose-700 dark:bg-rose-900/50 dark:text-rose-300">
                            DIBATALKAN
                          </span>
                        )}
                      </div>
                      <div className="text-[11px] text-[var(--mut)] flex items-center gap-1 mt-0.5">
                        <span>{dateStr} {timeStr}</span>
                        <span>•</span>
                        <span className="font-medium text-[var(--tx)]">
                          {r.by === 'karyawan' ? 'Kasir' : 'Pemilik'}
                        </span>
                        {isCancelled && r.cancelledAt && (
                          <>
                            <span>•</span>
                            <span className="text-rose-500">
                              Batal pkl {new Date(r.cancelledAt).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })}
                            </span>
                          </>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-3 shrink-0">
                    <div className="text-right">
                      <b className={`font-mono-numbers text-sm block ${isCancelled ? 'line-through text-[var(--mut)]' : 'text-[var(--tx)]'}`}>
                        {rp(r.nominal)}
                      </b>
                      <span className={`text-[11px] font-mono-numbers font-medium ${
                        isCancelled ? 'text-[var(--mut)]' : 'text-[var(--ac)]'
                      }`}>
                        {isCancelled ? 'Stok Dikembalikan' : `Untung ${rp(profit)}`}
                      </span>
                    </div>

                    <button
                      type="button"
                      onClick={() => {
                        setDeleteConfirm({
                          type: 'sale',
                          id: r.id,
                          title: isCancelled ? 'Hapus Riwayat Penjualan' : 'Kelola Transaksi Penjualan',
                          details: `${r.name} • ${rp(r.nominal)}`,
                          isCancelled,
                        });
                      }}
                      className="p-1 rounded text-[var(--mut)] hover:text-rose-600 transition-colors"
                      title={isCancelled ? 'Hapus permanen dari riwayat' : 'Batalkan atau hapus transaksi'}
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>
              );
            }

            // 2. KULAKAN / PEMBELIAN
            if (r.k === 'purchase') {
              const isCancelled = r.status === 'cancelled';
              return (
                <div
                  key={`p-${r.id}`}
                  className={`card p-3 flex items-center justify-between gap-3 text-xs border-l-4 ${
                    isCancelled ? 'border-l-gray-400 opacity-60 bg-gray-50/20' : 'border-l-emerald-600'
                  }`}
                >
                  <div className="flex items-center gap-2.5 min-w-0">
                    <div className={`w-8 h-8 rounded-lg flex items-center justify-center font-bold shrink-0 ${
                      isCancelled ? 'bg-gray-100 text-gray-500' : 'bg-emerald-50 dark:bg-emerald-950/40 text-[var(--ac)]'
                    }`}>
                      <Truck size={16} />
                    </div>
                    <div className="min-w-0">
                      <div className="font-bold text-[var(--tx)] truncate flex items-center gap-1.5">
                        <span className="text-sm shrink-0">{getItemIcon(r.itemName)}</span>
                        <span className={isCancelled ? 'line-through text-[var(--mut)]' : ''}>Kulakan: {r.itemName}</span>
                        <span className="text-[10px] py-0.5 px-1.5 rounded bg-emerald-50 dark:bg-emerald-950/40 text-[var(--ac)] font-semibold">
                          {r.isIkat ? `${r.ikatCount} ikat` : formatQty(r.qty, r.unit)}
                        </span>
                        {isCancelled && (
                          <span className="text-[9px] font-bold py-0.5 px-1.5 rounded bg-rose-100 text-rose-700 dark:bg-rose-900/50 dark:text-rose-300">
                            DIBATALKAN
                          </span>
                        )}
                      </div>
                      <div className="text-[11px] text-[var(--mut)] flex items-center gap-1 mt-0.5">
                        <span>{dateStr} {timeStr}</span>
                        <span>•</span>
                        <span>{r.supplier}</span>
                        {r.note && <span>• {r.note}</span>}
                        {isCancelled && r.cancelledAt && (
                          <>
                            <span>•</span>
                            <span className="text-rose-500">
                              Batal pkl {new Date(r.cancelledAt).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })}
                            </span>
                          </>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-3 shrink-0">
                    <div className="text-right">
                      <b className={`font-mono-numbers text-sm block ${isCancelled ? 'line-through text-[var(--mut)]' : 'text-[var(--tx)]'}`}>
                        {rp(r.totalCost)}
                      </b>
                      <span className="text-[11px] font-mono-numbers text-[var(--mut)]">
                        @{rp(r.costPerUnit)}/{unitLabel(r.unit)}
                      </span>
                    </div>

                    <button
                      type="button"
                      onClick={() => {
                        setDeleteConfirm({
                          type: 'purchase',
                          id: r.id,
                          title: isCancelled ? 'Hapus Riwayat Kulakan' : 'Kelola Pembelian/Kulakan',
                          details: `${r.itemName} (${r.supplier}) • ${rp(r.totalCost)}`,
                          isCancelled,
                        });
                      }}
                      className="p-1 rounded text-[var(--mut)] hover:text-rose-600 transition-colors"
                      title={isCancelled ? 'Hapus permanen dari riwayat' : 'Batalkan kulakan atau hapus'}
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>
              );
            }

            // 3. TELUR PECAH / PENYESUAIAN STOK
            if (r.k === 'adjustment') {
              const isCancelled = r.status === 'cancelled';
              return (
                <div
                  key={`adj-${r.id}`}
                  className={`card p-3 flex items-center justify-between gap-3 text-xs border-l-4 ${
                    isCancelled ? 'border-l-gray-400 opacity-60 bg-gray-50/20' : 'border-l-amber-500'
                  }`}
                >
                  <div className="flex items-center gap-2.5 min-w-0">
                    <div className={`w-8 h-8 rounded-lg flex items-center justify-center font-bold shrink-0 ${
                      isCancelled ? 'bg-gray-100 text-gray-500' : 'bg-amber-50 dark:bg-amber-950/40 text-amber-600'
                    }`}>
                      <Egg size={16} />
                    </div>
                    <div className="min-w-0">
                      <div className="font-bold text-[var(--tx)] truncate flex items-center gap-1.5">
                        <span className={isCancelled ? 'line-through text-[var(--mut)]' : ''}>
                          {r.reason === 'pecah' ? 'Telur Pecah' : r.reason === 'rusak' ? 'Telur Rusak' : 'Penyesuaian'}
                        </span>
                        <span className="text-[10px] py-0.5 px-1.5 rounded bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300 font-semibold">
                          {r.piecesCount ? `${r.piecesCount} butir` : formatQty(Math.abs(r.qty), r.unit)}
                        </span>
                        {isCancelled && (
                          <span className="text-[9px] font-bold py-0.5 px-1.5 rounded bg-rose-100 text-rose-700 dark:bg-rose-900/50 dark:text-rose-300">
                            DIBATALKAN
                          </span>
                        )}
                      </div>
                      <div className="text-[11px] text-[var(--mut)] flex items-center gap-1 mt-0.5">
                        <span>{dateStr} {timeStr}</span>
                        <span>•</span>
                        <span>{r.itemName}</span>
                        {r.note && <span>• {r.note}</span>}
                        {isCancelled && r.cancelledAt && (
                          <span className="text-rose-500 ml-1">
                            • Batal pkl {new Date(r.cancelledAt).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-3 shrink-0">
                    <div className="text-right">
                      <b className={`font-mono-numbers text-sm block ${isCancelled ? 'line-through text-[var(--mut)]' : 'text-amber-600 dark:text-amber-400'}`}>
                        - {rp(r.hppValue)}
                      </b>
                      <span className="text-[10px] text-[var(--mut)]">
                        {isCancelled ? 'Stok Dikembalikan' : 'HPP Rugi'}
                      </span>
                    </div>

                    <button
                      type="button"
                      onClick={() => {
                        setDeleteConfirm({
                          type: 'adjustment',
                          id: r.id,
                          title: isCancelled ? 'Hapus Riwayat Telur Pecah' : 'Kelola Riwayat Telur Pecah',
                          details: `${r.itemName} • ${r.piecesCount ? r.piecesCount + ' butir' : formatQty(Math.abs(r.qty), r.unit)} (-${rp(r.hppValue)})`,
                          isCancelled,
                        });
                      }}
                      className="p-1 rounded text-[var(--mut)] hover:text-rose-600 transition-colors"
                      title={isCancelled ? 'Hapus permanen dari riwayat' : 'Batalkan atau hapus riwayat telur pecah'}
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>
              );
            }

            // 4. JATAH KARYAWAN (INTERNAL CONSUMPTION)
            if (r.k === 'allowance') {
              const isCancelled = r.status === 'cancelled';
              return (
                <div
                  key={`al-${r.id}`}
                  className={`card p-3 flex items-center justify-between gap-3 text-xs border-l-4 ${
                    isCancelled ? 'border-l-gray-400 opacity-60 bg-gray-50/20' : 'border-l-purple-500'
                  }`}
                >
                  <div className="flex items-center gap-2.5 min-w-0">
                    <div className={`w-8 h-8 rounded-lg flex items-center justify-center font-bold shrink-0 ${
                      isCancelled ? 'bg-gray-100 text-gray-500' : 'bg-purple-50 dark:bg-purple-950/40 text-purple-600'
                    }`}>
                      <Gift size={16} />
                    </div>
                    <div className="min-w-0">
                      <div className="font-bold text-[var(--tx)] truncate flex items-center gap-1.5">
                        <span className={isCancelled ? 'line-through text-[var(--mut)]' : ''}>Jatah: {r.staffName}</span>
                        <span className="text-[10px] py-0.5 px-1.5 rounded bg-purple-50 dark:bg-purple-950/40 text-purple-700 dark:text-purple-300 font-semibold">
                          {formatQty(r.gram, r.unit)}
                        </span>
                        {isCancelled && (
                          <span className="text-[9px] font-bold py-0.5 px-1.5 rounded bg-rose-100 text-rose-700 dark:bg-rose-900/50 dark:text-rose-300">
                            DIBATALKAN
                          </span>
                        )}
                      </div>
                      <div className="text-[11px] text-[var(--mut)] flex items-center gap-1 mt-0.5">
                        <span>{dateStr} {timeStr}</span>
                        <span>•</span>
                        <span>{r.itemName}</span>
                        {r.note && <span>• {r.note}</span>}
                        {isCancelled && r.cancelledAt && (
                          <>
                            <span>•</span>
                            <span className="text-rose-500">
                              Batal pkl {new Date(r.cancelledAt).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })}
                            </span>
                          </>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-3 shrink-0">
                    <div className="text-right">
                      <b className={`font-mono-numbers text-sm block ${isCancelled ? 'line-through text-[var(--mut)]' : 'text-purple-600 dark:text-purple-400'}`}>
                        {rp(r.hppCost)}
                      </b>
                      <span className="text-[10px] text-[var(--mut)]">
                        {isCancelled ? 'Stok Dikembalikan' : 'Modal jatah'}
                      </span>
                    </div>

                    <button
                      type="button"
                      onClick={() => {
                        setDeleteConfirm({
                          type: 'allowance',
                          id: r.id,
                          title: isCancelled ? 'Hapus Riwayat Jatah Karyawan' : 'Kelola Jatah Karyawan',
                          details: `${r.staffName} • ${formatQty(r.gram, r.unit)}`,
                          isCancelled,
                        });
                      }}
                      className="p-1 rounded text-[var(--mut)] hover:text-rose-600 transition-colors"
                      title={isCancelled ? 'Hapus permanen dari riwayat' : 'Batalkan atau hapus jatah'}
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>
              );
            }

            // 5. PENGELUARAN OPERASIONAL KAS
            if (r.k === 'expense') {
              const isCancelled = r.status === 'cancelled';
              return (
                <div
                  key={`e-${r.id}`}
                  className={`card p-3 flex items-center justify-between gap-3 text-xs ${
                    isCancelled ? 'opacity-60 bg-gray-50/20' : ''
                  }`}
                >
                  <div className="flex items-center gap-2.5 min-w-0">
                    <div className={`w-8 h-8 rounded-lg flex items-center justify-center font-bold shrink-0 ${
                      isCancelled ? 'bg-gray-100 text-gray-500' : 'bg-rose-50 dark:bg-rose-950/40 text-rose-600'
                    }`}>
                      <ReceiptText size={16} />
                    </div>
                    <div className="min-w-0">
                      <div className="font-bold text-[var(--tx)] truncate flex items-center gap-1.5">
                        <span className={isCancelled ? 'line-through text-[var(--mut)]' : ''}>{r.cat}</span>
                        {isCancelled && (
                          <span className="text-[9px] font-bold py-0.5 px-1.5 rounded bg-rose-100 text-rose-700 dark:bg-rose-900/50 dark:text-rose-300">
                            DIBATALKAN
                          </span>
                        )}
                      </div>
                      <div className="text-[11px] text-[var(--mut)] truncate mt-0.5">
                        <span>{dateStr} {timeStr}</span>
                        {r.note && <span> • {r.note}</span>}
                        {isCancelled && r.cancelledAt && (
                          <span className="text-rose-500 ml-1">
                            • Batal pkl {new Date(r.cancelledAt).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-3 shrink-0">
                    <div className="text-right">
                      <b className={`font-mono-numbers text-sm block ${isCancelled ? 'line-through text-[var(--mut)]' : 'text-[var(--tx)]'}`}>
                        {rp(r.nominal)}
                      </b>
                      <span className="text-[10px] text-[var(--mut)]">
                        Kas keluar
                      </span>
                    </div>

                    <button
                      type="button"
                      onClick={() => {
                        setDeleteConfirm({
                          type: 'expense',
                          id: r.id,
                          title: isCancelled ? 'Hapus Riwayat Pengeluaran' : 'Kelola Pengeluaran',
                          details: `${r.cat} • ${rp(r.nominal)}`,
                          isCancelled,
                        });
                      }}
                      className="p-1 rounded text-[var(--mut)] hover:text-rose-600 transition-colors"
                      title={isCancelled ? 'Hapus permanen dari riwayat' : 'Batalkan atau hapus pengeluaran'}
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>
              );
            }

            return null;
          })
        )}
      </div>

      {/* Safe In-App Confirmation Modal (Iframe-Compatible, No window.confirm) */}
      {deleteConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs animate-in fade-in duration-200">
          <div className="bg-[var(--card)] border border-[var(--bd)] rounded-2xl w-full max-w-sm p-5 shadow-2xl space-y-4">
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-xl bg-rose-50 dark:bg-rose-950/40 text-rose-600 flex items-center justify-center shrink-0">
                <Trash2 size={20} />
              </div>
              <div className="min-w-0">
                <h3 className="font-bold text-base text-[var(--tx)]">{deleteConfirm.title}</h3>
                <p className="text-xs text-[var(--mut)] mt-0.5 break-words">{deleteConfirm.details}</p>
              </div>
            </div>

            {!deleteConfirm.isCancelled ? (
              <div className="space-y-2 pt-1">
                <p className="text-xs text-[var(--tx)]">
                  Pilih tindakan yang ingin dilakukan untuk data ini:
                </p>
                <div className="flex flex-col gap-2">
                  <button
                    type="button"
                    disabled={actionLoading}
                    onClick={async () => {
                      setActionLoading(true);
                      try {
                        let res: any;
                        if (deleteConfirm.type === 'sale') {
                          res = await onCancelSale(deleteConfirm.id);
                        } else if (deleteConfirm.type === 'adjustment') {
                          res = await onCancelAdjustment?.(deleteConfirm.id);
                        } else if (deleteConfirm.type === 'allowance') {
                          res = await onCancelAllowance?.(deleteConfirm.id);
                        } else if (deleteConfirm.type === 'purchase') {
                          res = await onCancelPurchase?.(deleteConfirm.id);
                        } else if (deleteConfirm.type === 'expense') {
                          res = await onCancelExpense?.(deleteConfirm.id);
                        }
                        if (res && res.error) {
                          setErrorMessage(res.error);
                        }
                      } finally {
                        setActionLoading(false);
                        setDeleteConfirm(null);
                      }
                    }}
                    className="w-full py-2.5 px-3 rounded-xl bg-amber-500 hover:bg-amber-600 active:scale-[0.98] text-white font-semibold text-xs flex items-center justify-center gap-1.5 transition-all shadow-sm"
                  >
                    <span>🔄</span> Batalkan (Kembalikan Stok / Kas)
                  </button>

                  <button
                    type="button"
                    disabled={actionLoading}
                    onClick={async () => {
                      setActionLoading(true);
                      try {
                        let res: any;
                        if (deleteConfirm.type === 'sale') {
                          res = await onDeleteSale?.(deleteConfirm.id);
                        } else if (deleteConfirm.type === 'adjustment') {
                          res = await onDeleteAdjustment?.(deleteConfirm.id);
                        } else if (deleteConfirm.type === 'allowance') {
                          res = await onDeleteAllowance?.(deleteConfirm.id);
                        } else if (deleteConfirm.type === 'purchase') {
                          res = await onDeletePurchase?.(deleteConfirm.id);
                        } else if (deleteConfirm.type === 'expense') {
                          res = await onDeleteExpense?.(deleteConfirm.id);
                        }
                        if (res && res.error) {
                          setErrorMessage(res.error);
                        }
                      } finally {
                        setActionLoading(false);
                        setDeleteConfirm(null);
                      }
                    }}
                    className="w-full py-2.5 px-3 rounded-xl bg-rose-600 hover:bg-rose-700 active:scale-[0.98] text-white font-semibold text-xs flex items-center justify-center gap-1.5 transition-all shadow-sm"
                  >
                    <Trash2 size={14} /> Hapus Permanen dari Riwayat
                  </button>

                  <button
                    type="button"
                    disabled={actionLoading}
                    onClick={() => setDeleteConfirm(null)}
                    className="w-full py-2 px-3 rounded-xl border border-[var(--bd)] text-[var(--tx)] hover:bg-[var(--bg)] font-medium text-xs transition-colors"
                  >
                    Batal
                  </button>
                </div>
              </div>
            ) : (
              <div className="space-y-2 pt-1">
                <p className="text-xs text-[var(--mut)]">
                  Data ini berstatus Dibatalkan. Hapus permanen dari riwayat transaksi?
                </p>
                <div className="flex flex-col gap-2">
                  <button
                    type="button"
                    disabled={actionLoading}
                    onClick={async () => {
                      setActionLoading(true);
                      try {
                        let res: any;
                        if (deleteConfirm.type === 'sale') {
                          res = await onDeleteSale?.(deleteConfirm.id);
                        } else if (deleteConfirm.type === 'adjustment') {
                          res = await onDeleteAdjustment?.(deleteConfirm.id);
                        } else if (deleteConfirm.type === 'allowance') {
                          res = await onDeleteAllowance?.(deleteConfirm.id);
                        } else if (deleteConfirm.type === 'purchase') {
                          res = await onDeletePurchase?.(deleteConfirm.id);
                        } else if (deleteConfirm.type === 'expense') {
                          res = await onDeleteExpense?.(deleteConfirm.id);
                        }
                        if (res && res.error) {
                          setErrorMessage(res.error);
                        }
                      } finally {
                        setActionLoading(false);
                        setDeleteConfirm(null);
                      }
                    }}
                    className="w-full py-2.5 px-3 rounded-xl bg-rose-600 hover:bg-rose-700 active:scale-[0.98] text-white font-semibold text-xs flex items-center justify-center gap-1.5 transition-all shadow-sm"
                  >
                    <Trash2 size={14} /> Hapus Permanen
                  </button>

                  <button
                    type="button"
                    disabled={actionLoading}
                    onClick={() => setDeleteConfirm(null)}
                    className="w-full py-2 px-3 rounded-xl border border-[var(--bd)] text-[var(--tx)] hover:bg-[var(--bg)] font-medium text-xs transition-colors"
                  >
                    Kembali
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
