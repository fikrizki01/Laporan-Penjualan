import { Item, UsedBatch, Batch, ItemUnit } from '../types';

export const rp = (n: number): string => {
  return 'Rp' + Math.round(n).toLocaleString('id-ID');
};

export const kg = (g: number): string => {
  return (g / 1000).toLocaleString('id-ID', { maximumFractionDigits: 3 });
};

export const formatQty = (qtyOrGrams: number, unit: ItemUnit = 'kg'): string => {
  if (unit === 'pcs') {
    return `${qtyOrGrams.toLocaleString('id-ID', { maximumFractionDigits: 2 })} pcs`;
  }
  return `${(qtyOrGrams / 1000).toLocaleString('id-ID', { maximumFractionDigits: 3 })} kg`;
};

export const unitLabel = (unit: ItemUnit = 'kg'): string => {
  return unit === 'pcs' ? 'pcs' : 'kg';
};

export const num = (s: string | number): number => {
  if (typeof s === 'number') return Math.round(s);
  return parseInt(String(s).replace(/\D/g, ''), 10) || 0;
};

export const dec = (s: string | number): number => {
  if (typeof s === 'number') return s;
  return parseFloat(String(s).replace(',', '.')) || 0;
};

// Estimasi saja untuk pencatatan jumlah butir jika telur tidak ditimbang.
// Bukan berat aktual setiap butir telur.
export const EGG_GRAM_PER_PIECE = 62.5;

export const eggPiecesToGram = (pieces: number): number => {
  return Math.round(pieces * EGG_GRAM_PER_PIECE);
};

export const gramToEggPieces = (grams: number): number => {
  return Math.round((grams / EGG_GRAM_PER_PIECE) * 10) / 10;
};

/**
 * Returns true if the item is an egg variant.
 */
export function isEggItem(name: string = ''): boolean {
  const lower = name.toLowerCase();
  return (
    lower.includes('telur') ||
    lower.includes('egg') ||
    lower.includes('puyuh') ||
    lower.includes('omega') ||
    lower.includes('bebek') ||
    lower.includes('asin')
  );
}

/**
 * Returns appropriate product icon/emoji according to item type.
 * Specifically handles Minyak Goreng, Puyuh, Omega, and other grocery items.
 */
export function getItemIcon(name: string = ''): string {
  const lower = name.toLowerCase();
  if (lower.includes('minyak') || lower.includes('oil')) {
    return '🍾'; // Botol / Jerigen Minyak Goreng
  }
  if (lower.includes('puyuh')) {
    return '🪺';
  }
  if (lower.includes('omega')) {
    return '🥚';
  }
  if (lower.includes('bebek') || lower.includes('asin')) {
    return '🥚';
  }
  if (lower.includes('telur') || lower.includes('egg')) {
    return '🥚';
  }
  if (lower.includes('beras')) {
    return '🌾';
  }
  if (lower.includes('gula')) {
    return '🧂';
  }
  if (lower.includes('tepung')) {
    return '🥡';
  }
  return '📦';
}

// Standar ikat telur grosir di Indonesia: 1 ikat = 15 kg
export const ikatToGram = (ikatCount: number, kgPerIkat: number = 15): number => {
  return Math.round(ikatCount * kgPerIkat * 1000);
};

/**
 * Pure synchronization of batch order and total quantity.
 * Does not mutate historical timestamps.
 */
export function syncItem(it: Item): void {
  if (!it.batches) it.batches = [];

  // Sort strictly by createdAt ascending for strict FIFO
  it.batches.sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));

  it.gram = it.batches.reduce((a, b) => a + b.gram, 0);

  if (!it.unit) {
    it.unit = it.name.toLowerCase().includes('minyak') ? 'pcs' : 'kg';
  }
}

export function curCost(it: Item): number {
  if (!it.batches || it.batches.length === 0) return it.modal || 0;
  // Oldest active batch cost
  const b = it.batches.find((x) => x.gram > 0);
  return b ? b.cost : it.modal || 0;
}

export interface FifoResult {
  success: boolean;
  hpp: number;
  used: UsedBatch[];
  error?: string;
}

/**
 * Atomic FIFO deduction with strict pre-check.
 * If requested quantity exceeds available stock, NOT A SINGLE GRAM is deducted.
 */
export function fifo(
  it: Item,
  g: number,
  commit: boolean
): FifoResult {
  if (g <= 0) {
    return { success: false, hpp: 0, used: [], error: 'Jumlah harus lebih dari 0' };
  }

  // Pre-check stock: ATOMIC
  const availableStock = it.batches.reduce((a, b) => a + b.gram, 0);
  if (g > availableStock) {
    return {
      success: false,
      hpp: 0,
      used: [],
      error: `Stok tidak mencukupi (Tersedia: ${
        it.unit === 'pcs' ? availableStock + ' pcs' : (availableStock / 1000).toFixed(3) + ' kg'
      }, Diminta: ${it.unit === 'pcs' ? g + ' pcs' : (g / 1000).toFixed(3) + ' kg'})`,
    };
  }

  let left = g;
  let hpp = 0;
  const used: UsedBatch[] = [];

  // Clone batches if not committing, or work on live batches if commit
  const bs = commit
    ? it.batches
    : it.batches.map((b) => ({ ...b }));

  // Ensure sorted by createdAt ascending
  bs.sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));

  const isPcs = it.unit === 'pcs';

  for (const b of bs) {
    if (left <= 0) break;
    const t = Math.min(b.gram, left);
    if (t > 0) {
      if (isPcs) {
        hpp += t * b.cost;
      } else {
        hpp += (t * b.cost) / 1000;
      }
      used.push({
        bid: b.id,
        cost: b.cost,
        gram: t,
        createdAt: b.createdAt,
        purchaseId: b.purchaseId,
        supplier: b.supplier,
      });
      b.gram -= t;
      left -= t;
    }
  }

  if (commit) {
    it.batches = it.batches.filter((b) => b.gram > 0);
    syncItem(it);
  }

  return { success: true, hpp: Math.round(hpp), used };
}

export function addBatch(
  it: Item,
  g: number,
  cost: number,
  nextId: number,
  options?: { createdAt?: number; purchaseId?: number; supplier?: string }
): { batchId: number; nextId: number } {
  const b: Batch = {
    id: nextId,
    gram: g,
    cost,
    createdAt: options?.createdAt || Date.now(),
    purchaseId: options?.purchaseId,
    supplier: options?.supplier,
  };
  if (!it.batches) it.batches = [];
  it.batches.push(b);
  // Master modal is updated as last purchase reference, but existing batches remain untouched
  it.modal = cost;
  syncItem(it);
  return { batchId: nextId, nextId: nextId + 1 };
}

/**
 * Restores stock directly to the exact batches that were consumed.
 * Requires authentic UsedBatch history. Fails safely rather than fabricating an arbitrary batch cost.
 */
export function restoreItemStock(
  it: Item,
  record: { gram: number; used?: UsedBatch[] }
): boolean {
  if (!record.used || record.used.length === 0) {
    console.error('Cannot restore stock: transaction does not have used batches audit trail.');
    return false;
  }

  for (let k = record.used.length - 1; k >= 0; k--) {
    const u = record.used[k];
    const b = it.batches.find((x) => x.id === u.bid);
    if (b) {
      b.gram += u.gram;
    } else {
      // Re-create the batch at its exact original cost, createdAt, purchaseId, and supplier
      it.batches.push({
        id: u.bid,
        gram: u.gram,
        cost: u.cost,
        createdAt: u.createdAt,
        purchaseId: u.purchaseId,
        supplier: u.supplier,
      });
    }
  }
  syncItem(it);
  return true;
}

export const stokVal = (i: Item): number => {
  if (!i.batches || i.batches.length === 0) return 0;
  if (i.unit === 'pcs') {
    return Math.round(i.batches.reduce((a, b) => a + b.gram * b.cost, 0));
  }
  return Math.round(i.batches.reduce((a, b) => a + (b.gram * b.cost) / 1000, 0));
};

/**
 * Historical HPP retrieval.
 * Returns stored permanent HPP. Never fabricates or recalculates HPP using current prices.
 */
export const hppOf = (s: { hpp?: number }, _items?: any): number => {
  return s?.hpp ?? 0;
};

export function getItemOrderRank(name: string = ''): number {
  const n = name.toLowerCase().replace(/\s+/g, ' ').trim();
  if (n.includes('biasa')) return 1;
  if (n.includes('omega')) return 2;
  if (n.includes('puyuh')) return 3;
  if (n.includes('minyak kita 1') || n.includes('minyak kita 1l') || n.includes('minyak kita 1 l')) return 4;
  if (n.includes('minyak kita 2') || n.includes('minyak kita 2l') || n.includes('minyak kita 2 l')) return 5;
  if (n.includes('minyak premium')) return 6;
  if (n.includes('minyak')) return 7;
  return 100;
}

export function sortItemsFixedOrder<T extends { name: string; id?: number }>(items: T[]): T[] {
  return [...items].sort((a, b) => {
    const rankA = getItemOrderRank(a.name);
    const rankB = getItemOrderRank(b.name);
    if (rankA !== rankB) return rankA - rankB;
    return (a.id || 0) - (b.id || 0);
  });
}
