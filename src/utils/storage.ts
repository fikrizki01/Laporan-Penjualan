import { AppData, Item, StaffAllowance, Expense, Purchase, StockAdjustment } from '../types';
import { syncItem } from './formatters';

export const CURRENT_SCHEMA_VERSION = 3;
export const STORAGE_KEY = 'kasir-nominal-v3';
export const LEGACY_STORAGE_KEYS = ['kasir-nominal-v2', 'kasir-nominal-v1'];

// Base deterministic timestamp for migrating legacy records without timestamps
export const BASE_MIGRATION_TS = 1700000000000;

/**
 * Clean initial data for production store Almair.
 * No dummy/mock stock — authentic stock is input via initial purchase/kulakan.
 */
export const initialData: AppData = {
  items: [],
  sales: [],
  exp: [],
  purchases: [],
  adjustments: [],
  allowances: [],
  next: 1,
  schemaVersion: CURRENT_SCHEMA_VERSION,
};

/**
 * Calculates the next safe ID by scanning the maximum ID across all entities.
 * Guarantees zero ID collision across items, batches, sales, purchases, adjustments, allowances, and expenses.
 */
export function calculateNextSafeId(data: {
  items?: Item[];
  sales?: { id: number }[];
  purchases?: { id: number; batchId?: number }[];
  adjustments?: { id: number; batchId?: number }[];
  allowances?: { id: number }[];
  exp?: { id: number }[];
  next?: number;
}): number {
  let maxId = typeof data.next === 'number' && data.next > 0 ? data.next - 1 : 0;

  if (Array.isArray(data.items)) {
    for (const it of data.items) {
      if (typeof it.id === 'number') maxId = Math.max(maxId, it.id);
      if (Array.isArray(it.batches)) {
        for (const b of it.batches) {
          if (typeof b.id === 'number') maxId = Math.max(maxId, b.id);
          if (typeof b.purchaseId === 'number') maxId = Math.max(maxId, b.purchaseId);
        }
      }
    }
  }

  if (Array.isArray(data.sales)) {
    for (const s of data.sales) {
      if (typeof s.id === 'number') maxId = Math.max(maxId, s.id);
    }
  }

  if (Array.isArray(data.purchases)) {
    for (const p of data.purchases) {
      if (typeof p.id === 'number') maxId = Math.max(maxId, p.id);
      if (typeof p.batchId === 'number') maxId = Math.max(maxId, p.batchId);
    }
  }

  if (Array.isArray(data.adjustments)) {
    for (const a of data.adjustments) {
      if (typeof a.id === 'number') maxId = Math.max(maxId, a.id);
      if (typeof a.batchId === 'number') maxId = Math.max(maxId, a.batchId);
    }
  }

  if (Array.isArray(data.allowances)) {
    for (const al of data.allowances) {
      if (typeof al.id === 'number') maxId = Math.max(maxId, al.id);
    }
  }

  if (Array.isArray(data.exp)) {
    for (const e of data.exp) {
      if (typeof e.id === 'number') maxId = Math.max(maxId, e.id);
    }
  }

  return Math.max(1, maxId + 1);
}

export function loadData(): AppData {
  try {
    let raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      for (const legacyKey of LEGACY_STORAGE_KEYS) {
        raw = localStorage.getItem(legacyKey);
        if (raw) break;
      }
    }

    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') {
        const rawItems: any[] = Array.isArray(parsed.items) ? parsed.items : [];
        const rawSales: any[] = Array.isArray(parsed.sales) ? parsed.sales : [];
        const rawExp: any[] = Array.isArray(parsed.exp) ? parsed.exp : [];
        const rawPurchases: any[] = Array.isArray(parsed.purchases) ? parsed.purchases : [];
        const rawAdjustments: any[] = Array.isArray(parsed.adjustments) ? parsed.adjustments : [];
        const rawAllowances: any[] = Array.isArray(parsed.allowances) ? parsed.allowances : [];

        // 1. Normalize Items and Batches with deterministic timestamps
        let runningId = 1000;
        const normalizedItems: Item[] = rawItems.map((it: any, idx: number) => {
          const itemCopy: Item = {
            id: typeof it.id === 'number' ? it.id : runningId++,
            name: String(it.name || 'Barang'),
            price: Number(it.price) || 0,
            modal: Number(it.modal) || 0,
            gram: 0,
            unit: it.unit || (String(it.name || '').toLowerCase().includes('minyak') ? 'pcs' : 'kg'),
            batches: Array.isArray(it.batches) ? it.batches : [],
            archived: Boolean(it.archived),
          };

          if (itemCopy.batches.length === 0 && Number(it.gram) > 0) {
            itemCopy.batches = [
              {
                id: runningId++,
                gram: Number(it.gram),
                cost: itemCopy.modal || 0,
                createdAt: BASE_MIGRATION_TS + idx * 1000,
                supplier: 'Stok Awal',
              },
            ];
          } else {
            itemCopy.batches.forEach((b: any, bIdx: number) => {
              if (typeof b.createdAt !== 'number') {
                b.createdAt = BASE_MIGRATION_TS + idx * 1000 + bIdx * 10;
              }
            });
          }

          syncItem(itemCopy);
          return itemCopy;
        });

        // 2. Safe Migration of Expenses without losing 'Beli stok' history
        const cleanExpenses: Expense[] = [];
        const cleanPurchases: Purchase[] = [...rawPurchases];
        const cleanAllowances: StaffAllowance[] = [...rawAllowances];

        rawExp.forEach((e: any, eIdx: number) => {
          const expenseTimestamp = typeof e.t === 'number' ? e.t : BASE_MIGRATION_TS + eIdx * 100;

          if (e.cat === 'Jatah Karyawan') {
            // Migrate legacy staff allowance if not already present
            if (!cleanAllowances.some((a) => a.id === e.id)) {
              cleanAllowances.push({
                id: typeof e.id === 'number' ? e.id : runningId++,
                itemId: Number(e.itemId) || 0,
                itemName: String(e.note || 'Jatah Karyawan'),
                unit: e.unit || 'kg',
                gram: Number(e.gram) || 0,
                staffName: typeof e.note === 'string' && e.note.includes(' · ')
                  ? e.note.split(' · ')[0]
                  : 'Karyawan',
                note: e.note,
                hppCost: Number(e.nominal) || 0,
                used: Array.isArray(e.used) ? e.used : [],
                t: expenseTimestamp,
              });
            }
          } else if (e.cat === 'Beli stok') {
            // Do NOT throw away legacy stock purchases!
            // If already migrated to purchases, skip; otherwise preserve in purchases or keep marked
            const alreadyInPurchases = cleanPurchases.some(
              (p) => p.id === e.id || (p.totalCost === e.nominal && Math.abs(p.t - expenseTimestamp) < 1000)
            );
            if (!alreadyInPurchases) {
              cleanExpenses.push({
                id: typeof e.id === 'number' ? e.id : runningId++,
                nominal: Number(e.nominal) || 0,
                cat: 'Kulakan (Legacy)',
                note: e.note || 'Belanja stok data lama',
                t: expenseTimestamp,
              });
            }
          } else {
            cleanExpenses.push({
              id: typeof e.id === 'number' ? e.id : runningId++,
              nominal: Number(e.nominal) || 0,
              cat: String(e.cat || 'Operasional'),
              note: e.note,
              t: expenseTimestamp,
            });
          }
        });

        // 3. Normalize Stock Adjustments: hppValue & mandatory used array
        const cleanAdjustments: StockAdjustment[] = rawAdjustments.map((a: any, aIdx: number) => ({
          id: typeof a.id === 'number' ? a.id : runningId++,
          itemId: Number(a.itemId) || 0,
          itemName: String(a.itemName || 'Penyesuaian'),
          unit: a.unit || 'kg',
          qty: Number(a.qty) || 0,
          piecesCount: a.piecesCount,
          reason: a.reason || 'lainnya',
          note: a.note || '',
          hppValue: a.hppValue != null ? Number(a.hppValue) : Number(a.hppLoss) || 0,
          used: Array.isArray(a.used) ? a.used : [],
          batchId: a.batchId || a.bid,
          t: typeof a.t === 'number' ? a.t : BASE_MIGRATION_TS + aIdx * 100,
          by: a.by || 'owner',
        }));

        // 4. Calculate definitive non-colliding next ID
        const nextSafeId = calculateNextSafeId({
          items: normalizedItems,
          sales: rawSales,
          purchases: cleanPurchases,
          adjustments: cleanAdjustments,
          allowances: cleanAllowances,
          exp: cleanExpenses,
          next: parsed.next,
        });

        return {
          items: normalizedItems,
          sales: rawSales,
          exp: cleanExpenses,
          purchases: cleanPurchases,
          adjustments: cleanAdjustments,
          allowances: cleanAllowances,
          next: nextSafeId,
          schemaVersion: CURRENT_SCHEMA_VERSION,
        };
      }
    }
  } catch (err) {
    console.error('Failed to load from localStorage cache:', err);
  }

  return initialData;
}

/**
 * Saves client cache to localStorage without credential leaks.
 * Note: Server is the single source of truth; this is client cache only.
 */
export function saveData(data: AppData): boolean {
  try {
    const sanitized: AppData = {
      items: data.items,
      sales: data.sales,
      exp: data.exp,
      purchases: data.purchases,
      adjustments: data.adjustments,
      allowances: data.allowances,
      next: data.next,
      schemaVersion: CURRENT_SCHEMA_VERSION,
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(sanitized));
    return true;
  } catch (err) {
    console.error('Failed to save to localStorage cache:', err);
    return false;
  }
}
