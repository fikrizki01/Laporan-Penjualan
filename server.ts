import express from 'express';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import { createServer as createViteServer } from 'vite';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = 3000;
const isProd = process.env.NODE_ENV === 'production';
const secureCookie = isProd ? '; Secure' : '';

app.use(express.json({ limit: '15mb' }));

// Helper to parse cookies from Cookie header
function parseCookies(cookieHeader?: string): Record<string, string> {
  const list: Record<string, string> = {};
  if (!cookieHeader) return list;
  cookieHeader.split(';').forEach((cookie) => {
    const parts = cookie.split('=');
    const name = parts.shift()?.trim();
    if (name) {
      list[name] = decodeURIComponent(parts.join('='));
    }
  });
  return list;
}

// In-memory + persistent file store paths
const DATA_FILE = path.join(__dirname, 'data-store.json');
const DATA_FILE_TMP = path.join(__dirname, 'data-store.json.tmp');

export const CURRENT_SCHEMA_VERSION = 3;
export const BASE_MIGRATION_TS = 1700000000000;

export type ItemUnit = 'kg' | 'pcs';

export interface Batch {
  id: number;
  gram: number; // gram jika unit='kg', jumlah pcs jika unit='pcs'
  cost: number; // harga modal per kg atau per pcs (Rp)
  createdAt: number;
  purchaseId?: number;
  supplier?: string;
}

export interface UsedBatch {
  bid: number;
  cost: number;
  gram: number;
  createdAt: number;
  purchaseId?: number;
  supplier?: string;
}

export interface Item {
  id: number;
  name: string;
  price: number; // harga jual per kg atau per pcs
  modal: number; // referensi harga beli terakhir, bukan sumber HPP historis
  gram: number; // gram jika unit='kg', jumlah pcs jika unit='pcs'
  unit?: ItemUnit;
  batches: Batch[];
  archived?: boolean;
  estimatedGramPerPiece?: number; // estimasi gram per butir (misal 62.5g telur ayam, 10g puyuh)
}

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

export interface Sale {
  id: number;
  itemId: number;
  name: string;
  nominal: number;
  gram: number;
  hpp: number; // HPP permanen saat transaksi
  unit?: ItemUnit;
  used: UsedBatch[];
  t: number;
  by: 'owner' | 'karyawan';
  sellingPrice?: number;
  status?: 'completed' | 'cancelled';
  cancelledAt?: number;
}

export interface Purchase {
  id: number;
  itemId: number;
  itemName: string;
  supplier: string;
  unit: ItemUnit;
  isIkat?: boolean;
  ikatCount?: number;
  kgPerIkat?: number; // default 15 kg
  qty: number;
  costPerUnit: number;
  totalCost: number;
  t: number;
  batchId: number;
  note?: string;
  status?: 'completed' | 'cancelled';
  cancelledAt?: number;
}

export const VALID_ADJUSTMENT_REASONS = [
  'pecah',
  'rusak',
  'hilang',
  'koreksi_tambah',
  'koreksi_kurang',
  'lainnya',
] as const;

export type AdjustmentReason = (typeof VALID_ADJUSTMENT_REASONS)[number];

export interface StockAdjustment {
  id: number;
  itemId: number;
  itemName: string;
  unit: ItemUnit;
  qty: number; // negatif = pengurangan, positif = penambahan
  piecesCount?: number;
  reason: AdjustmentReason;
  note: string;
  hppValue: number;
  used: UsedBatch[];
  batchId?: number;
  t: number;
  by: 'owner' | 'karyawan';
  status?: 'completed' | 'cancelled';
  cancelledAt?: number;
}

export interface StaffAllowance {
  id: number;
  itemId: number;
  itemName: string;
  unit: ItemUnit;
  gram: number;
  staffName: string;
  note?: string;
  hppCost: number; // konsumsi stok internal, bukan cash outflow
  used: UsedBatch[];
  t: number;
  status?: 'completed' | 'cancelled';
  cancelledAt?: number;
}

export interface Expense {
  id: number;
  nominal: number; // cash outflow murni operasional
  t: number;
  cat: string;
  note?: string;
  status?: 'completed' | 'cancelled';
  cancelledAt?: number;
}

export interface StaffToken {
  id: string;
  label: string;
  tokenHash: string; // token asli tidak disimpan di file/db, hanya hash
  createdAt: number;
  revoked?: boolean;
}

export interface Store {
  items: Item[];
  sales: Sale[];
  exp: Expense[];
  purchases: Purchase[];
  adjustments: StockAdjustment[];
  allowances: StaffAllowance[];
  staffTokens: StaffToken[];
  next: number;
  pinSalt: string;
  pinHash: string;
  schemaVersion: number;
}

// Security: In-Memory Sessions & Rate Limiter
interface OwnerSession {
  sessionId: string;
  createdAt: number;
  expiresAt: number;
}

interface StaffSession {
  sessionId: string;
  staffTokenId: string;
  createdAt: number;
  expiresAt: number;
}

const ownerSessions = new Map<string, OwnerSession>();
const staffSessions = new Map<string, StaffSession>();
const pinAttempts = new Map<string, { count: number; lockedUntil: number }>();

function hashPin(pin: string, salt: string): string {
  return crypto.pbkdf2Sync(pin, salt, 10000, 64, 'sha512').toString('hex');
}

function hashToken(rawToken: string): string {
  return crypto.createHash('sha256').update(rawToken).digest('hex');
}

function getClientIp(req: express.Request): string {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string') {
    return forwarded.split(',')[0].trim();
  }
  return req.socket.remoteAddress || '127.0.0.1';
}

/**
 * Calculates next safe non-colliding ID without wasting IDs.
 */
function calculateNextSafeId(data: {
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

/**
 * Deep validation of restored backup data to prevent database corruption.
 */
function validateBackupStructure(data: any): { valid: boolean; error?: string } {
  if (!data || typeof data !== 'object') {
    return { valid: false, error: 'Data cadangan tidak valid (bukan objek)' };
  }

  if (!Array.isArray(data.items)) {
    return { valid: false, error: 'Data cadangan tidak memiliki daftar barang yang valid' };
  }

  for (const [idx, it] of data.items.entries()) {
    if (!it || typeof it !== 'object') {
      return { valid: false, error: `Barang ke-${idx + 1} tidak valid` };
    }
    if (typeof it.name !== 'string' || !it.name.trim()) {
      return { valid: false, error: `Nama barang ke-${idx + 1} tidak boleh kosong` };
    }
    if (!Number.isFinite(it.price) || it.price < 0) {
      return { valid: false, error: `Harga jual ${it.name} tidak valid` };
    }
    if (!Number.isFinite(it.modal) || it.modal < 0) {
      return { valid: false, error: `Modal ${it.name} tidak valid` };
    }
    if (Array.isArray(it.batches)) {
      for (const [bIdx, b] of it.batches.entries()) {
        if (!b || typeof b !== 'object') {
          return { valid: false, error: `Batch ke-${bIdx + 1} pada barang ${it.name} tidak valid` };
        }
        if (!Number.isFinite(b.gram) || b.gram < 0) {
          return { valid: false, error: `Jumlah stok batch tidak boleh negatif pada ${it.name}` };
        }
        if (!Number.isFinite(b.cost) || b.cost < 0) {
          return { valid: false, error: `Harga modal batch tidak valid pada ${it.name}` };
        }
      }
    }
  }

  if (data.sales && !Array.isArray(data.sales)) {
    return { valid: false, error: 'Data penjualan harus berupa daftar array' };
  }
  if (data.purchases && !Array.isArray(data.purchases)) {
    return { valid: false, error: 'Data pembelian harus berupa daftar array' };
  }
  if (data.adjustments && !Array.isArray(data.adjustments)) {
    return { valid: false, error: 'Data penyesuaian stok harus berupa daftar array' };
  }
  if (data.allowances && !Array.isArray(data.allowances)) {
    return { valid: false, error: 'Data jatah karyawan harus berupa daftar array' };
  }
  if (data.exp && !Array.isArray(data.exp)) {
    return { valid: false, error: 'Data pengeluaran harus berupa daftar array' };
  }

  return { valid: true };
}

/**
 * Clean initial store for real production use.
 * NO mock items, NO predictable default staff token.
 */
function getInitialStore(): Store {
  const defaultSalt = crypto.randomBytes(16).toString('hex');
  const defaultHash = hashPin('1401', defaultSalt);

  return {
    items: [
      {
        id: 101,
        name: 'Telur Biasa',
        price: 26000,
        modal: 22000,
        gram: 0,
        batches: [],
        unit: 'kg',
        estimatedGramPerPiece: 62.5,
        archived: false,
      },
      {
        id: 102,
        name: 'Telur Omega',
        price: 32000,
        modal: 27000,
        gram: 0,
        batches: [],
        unit: 'kg',
        estimatedGramPerPiece: 65,
        archived: false,
      },
      {
        id: 103,
        name: 'Telur Puyuh',
        price: 38000,
        modal: 32000,
        gram: 0,
        batches: [],
        unit: 'kg',
        estimatedGramPerPiece: 10,
        archived: false,
      },
    ],
    sales: [],
    exp: [],
    purchases: [],
    adjustments: [],
    allowances: [],
    staffTokens: [],
    next: 104,
    pinSalt: defaultSalt,
    pinHash: defaultHash,
    schemaVersion: CURRENT_SCHEMA_VERSION,
  };
}

let store: Store = getInitialStore();

function syncItem(it: Item) {
  if (!it.batches) it.batches = [];
  it.batches.sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
  it.gram = it.batches.reduce((a, b) => a + b.gram, 0);
  if (!it.unit) {
    it.unit = it.name.toLowerCase().includes('minyak') ? 'pcs' : 'kg';
  }
}

function loadStore() {
  try {
    if (fs.existsSync(DATA_FILE)) {
      const content = fs.readFileSync(DATA_FILE, 'utf-8');
      const parsed = JSON.parse(content);
      if (parsed && typeof parsed === 'object') {
        let salt = parsed.pinSalt;
        let hash = parsed.pinHash;
        if (!salt || !hash) {
          salt = crypto.randomBytes(16).toString('hex');
          hash = hashPin(parsed.pin || '1401', salt);
        }

        const rawExp: any[] = Array.isArray(parsed.exp) ? parsed.exp : [];
        const cleanExp: Expense[] = [];
        const existingAllowances: StaffAllowance[] = Array.isArray(parsed.allowances) ? parsed.allowances : [];
        const existingPurchases: Purchase[] = Array.isArray(parsed.purchases) ? parsed.purchases : [];

        rawExp.forEach((e) => {
          if (e.cat === 'Jatah Karyawan' && !existingAllowances.some((a) => a.id === e.id)) {
            existingAllowances.push({
              id: e.id,
              itemId: e.itemId || 0,
              itemName: e.note || 'Jatah Karyawan',
              unit: e.unit || 'kg',
              gram: e.gram || 0,
              staffName: e.note?.split(' · ')[0] || 'Karyawan',
              note: e.note,
              hppCost: e.nominal || 0,
              used: e.used || [],
              t: typeof e.t === 'number' ? e.t : BASE_MIGRATION_TS,
              status: e.status,
              cancelledAt: e.cancelledAt,
            });
          } else if (e.cat === 'Beli stok') {
            const alreadyInPurchases = existingPurchases.some((p) => p.id === e.id);
            if (!alreadyInPurchases) {
              cleanExp.push({
                id: e.id,
                nominal: e.nominal,
                cat: 'Kulakan (Legacy)',
                note: e.note || 'Belanja stok lama',
                t: typeof e.t === 'number' ? e.t : BASE_MIGRATION_TS,
                status: e.status,
                cancelledAt: e.cancelledAt,
              });
            }
          } else {
            cleanExp.push({
              id: e.id,
              nominal: e.nominal,
              cat: e.cat,
              note: e.note,
              t: typeof e.t === 'number' ? e.t : BASE_MIGRATION_TS,
              status: e.status,
              cancelledAt: e.cancelledAt,
            });
          }
        });

        const rawAdjustments: any[] = Array.isArray(parsed.adjustments) ? parsed.adjustments : [];
        const cleanAdjustments: StockAdjustment[] = rawAdjustments.map((a) => ({
          id: a.id,
          itemId: a.itemId,
          itemName: a.itemName,
          unit: a.unit || 'kg',
          qty: a.qty,
          piecesCount: a.piecesCount,
          reason: a.reason,
          note: a.note || '',
          hppValue: a.hppValue != null ? a.hppValue : (a.hppLoss || 0),
          used: Array.isArray(a.used) ? a.used : [],
          batchId: a.batchId || a.bid,
          t: typeof a.t === 'number' ? a.t : BASE_MIGRATION_TS,
          by: a.by || 'owner',
          status: a.status,
          cancelledAt: a.cancelledAt,
        }));

        let rawTokens: any[] = Array.isArray(parsed.staffTokens) ? parsed.staffTokens : [];
        let tokens: StaffToken[] = rawTokens
          .filter((t) => t.token !== 'kasir-almair-default' && t.id !== 'st-default-1')
          .map((t) => ({
            id: t.id,
            label: t.label || 'Kasir',
            tokenHash: t.tokenHash || (t.token ? hashToken(t.token) : hashToken(crypto.randomUUID())),
            createdAt: t.createdAt || Date.now(),
            revoked: Boolean(t.revoked),
          }));

        const rawItems: any[] = Array.isArray(parsed.items) ? parsed.items : [];
        let normalizedItems: Item[] = rawItems.map((it: Item, idx: number) => {
          const defaultModal = it.name.toLowerCase().includes('omega')
            ? 27000
            : it.name.toLowerCase().includes('puyuh')
            ? 32000
            : 22000;
          const itemCopy = {
            ...it,
            modal: typeof it.modal === 'number' && it.modal > 0 ? it.modal : defaultModal,
            unit: it.unit || (it.name.toLowerCase().includes('minyak') ? 'pcs' : 'kg'),
            batches: Array.isArray(it.batches) ? it.batches : [],
          };
          itemCopy.batches.forEach((b: Batch, bIdx: number) => {
            if (!b.createdAt) {
              b.createdAt = BASE_MIGRATION_TS + idx * 1000 + bIdx * 10;
            }
          });
          syncItem(itemCopy);
          return itemCopy;
        });

        // Ensure the 6 fixed products are always present and unarchived
        const hasBiasa = normalizedItems.some((i) => !i.archived && getItemOrderRank(i.name) === 1);
        const hasOmega = normalizedItems.some((i) => !i.archived && getItemOrderRank(i.name) === 2);
        const hasPuyuh = normalizedItems.some((i) => !i.archived && getItemOrderRank(i.name) === 3);
        const hasMinyak1 = normalizedItems.some((i) => !i.archived && getItemOrderRank(i.name) === 4);
        const hasMinyak2 = normalizedItems.some((i) => !i.archived && getItemOrderRank(i.name) === 5);
        const hasMinyakPrem = normalizedItems.some((i) => !i.archived && getItemOrderRank(i.name) === 6);

        let maxItemId = normalizedItems.reduce((max, i) => Math.max(max, i.id || 0), 150);

        if (!hasBiasa) {
          maxItemId++;
          normalizedItems.push({
            id: maxItemId,
            name: 'Telur Biasa',
            price: 26000,
            modal: 22000,
            gram: 0,
            batches: [],
            unit: 'kg',
            estimatedGramPerPiece: 62.5,
            archived: false,
          });
        }
        if (!hasOmega) {
          maxItemId++;
          normalizedItems.push({
            id: maxItemId,
            name: 'Telur Omega',
            price: 32000,
            modal: 27000,
            gram: 0,
            batches: [],
            unit: 'kg',
            estimatedGramPerPiece: 65,
            archived: false,
          });
        }
        if (!hasPuyuh) {
          maxItemId++;
          normalizedItems.push({
            id: maxItemId,
            name: 'Telur Puyuh',
            price: 38000,
            modal: 32000,
            gram: 0,
            batches: [],
            unit: 'kg',
            estimatedGramPerPiece: 10,
            archived: false,
          });
        }
        if (!hasMinyak1) {
          maxItemId++;
          normalizedItems.push({
            id: maxItemId,
            name: 'Minyak Kita 1 L',
            price: 16000,
            modal: 14500,
            gram: 0,
            batches: [],
            unit: 'pcs',
            archived: false,
          });
        }
        if (!hasMinyak2) {
          maxItemId++;
          normalizedItems.push({
            id: maxItemId,
            name: 'Minyak Kita 2 L',
            price: 32000,
            modal: 29000,
            gram: 0,
            batches: [],
            unit: 'pcs',
            archived: false,
          });
        }
        if (!hasMinyakPrem) {
          maxItemId++;
          normalizedItems.push({
            id: maxItemId,
            name: 'Minyak Premium',
            price: 21000,
            modal: 18500,
            gram: 0,
            batches: [],
            unit: 'pcs',
            archived: false,
          });
        }

        // Clean up duplicate active items with the same name (keep the one with stock, archive the empty duplicate)
        const seenNames = new Map<string, number>();
        for (const it of normalizedItems) {
          if (it.archived) continue;
          const key = it.name.trim().toLowerCase();
          if (seenNames.has(key)) {
            const prevId = seenNames.get(key)!;
            const prevItem = normalizedItems.find((i) => i.id === prevId);
            if (it.gram > 0 && prevItem && prevItem.gram === 0) {
              prevItem.archived = true;
              seenNames.set(key, it.id);
            } else {
              it.archived = true;
            }
          } else {
            seenNames.set(key, it.id);
          }
        }

        // Permanently sort normalized items in the fixed order requested
        normalizedItems = sortItemsFixedOrder(normalizedItems);

        const nextSafeId = calculateNextSafeId({
          items: normalizedItems,
          sales: Array.isArray(parsed.sales) ? parsed.sales : [],
          exp: cleanExp,
          purchases: existingPurchases,
          adjustments: cleanAdjustments,
          allowances: existingAllowances,
          next: parsed.next,
        });

        store = {
          items: normalizedItems,
          sales: Array.isArray(parsed.sales) ? parsed.sales : [],
          exp: cleanExp,
          purchases: existingPurchases,
          adjustments: cleanAdjustments,
          allowances: existingAllowances,
          staffTokens: tokens,
          next: nextSafeId,
          pinSalt: salt,
          pinHash: hash,
          schemaVersion: CURRENT_SCHEMA_VERSION,
        };
      }
    }
  } catch (err) {
    console.error('Failed to read data-store.json, using fallback store:', err);
  }
}

/**
 * Atomic persistent disk write:
 * Writes to a temporary file first, then atomically renames it.
 * Returns true if saved successfully, false on error.
 */
function saveStore(): boolean {
  try {
    const payload = JSON.stringify(store, null, 2);
    fs.writeFileSync(DATA_FILE_TMP, payload, 'utf-8');
    fs.renameSync(DATA_FILE_TMP, DATA_FILE);
    return true;
  } catch (err) {
    console.error('CRITICAL: Failed to write data-store.json atomically:', err);
    return false;
  }
}

/**
 * Executes a state mutation with automatic rollback protection.
 * If disk write fails, in-memory store is restored to the exact pre-mutation snapshot.
 */
function executeTransactionalMutation<T>(
  mutator: () => { success: boolean; data?: T; error?: string; status?: number }
): { success: boolean; data?: T; error?: string; status?: number } {
  const snapshot = JSON.stringify(store);
  const result = mutator();
  if (!result.success) {
    store = JSON.parse(snapshot);
    return result;
  }

  if (!saveStore()) {
    store = JSON.parse(snapshot);
    return {
      success: false,
      status: 500,
      error: 'Gagal menyimpan transaksi ke media penyimpanan. Perubahan telah dibatalkan secara aman.',
    };
  }

  return result;
}

loadStore();

/**
 * Authoritative Server-Side Role Authentication:
 * Checks HTTP-only session cookies and/or request headers (essential for cross-origin iframe preview environments).
 */
function getAuthRole(req: express.Request): 'owner' | 'karyawan' | null {
  const cookies = parseCookies(req.headers.cookie);

  // 1. Check Owner Session: Cookie OR Headers
  const ownerSessionId =
    cookies['owner_session'] ||
    (req.headers['x-owner-token'] as string) ||
    (req.headers['x-session-token'] as string) ||
    (req.headers['authorization']?.replace(/^Bearer\s+/i, '') as string);

  if (ownerSessionId) {
    const session = ownerSessions.get(ownerSessionId);
    if (session && session.expiresAt > Date.now()) {
      return 'owner';
    }
  }

  // 2. Check Staff Session: Cookie OR Headers
  const staffSessionId =
    cookies['staff_session'] ||
    (req.headers['x-staff-token'] as string);

  if (staffSessionId) {
    const session = staffSessions.get(staffSessionId);
    if (session && session.expiresAt > Date.now()) {
      const validStaff = store.staffTokens.find(
        (t) => t.id === session.staffTokenId && !t.revoked
      );
      if (validStaff) {
        return 'karyawan';
      } else {
        staffSessions.delete(staffSessionId); // purge invalidated session
      }
    }
  }

  return null;
}

/**
 * Strict Atomic FIFO Deduction Engine
 * Pre-checks available stock before mutating anything.
 * Returns failure without touching batches if insufficient.
 */
function fifoDeductAtomic(
  it: Item,
  g: number
): { success: boolean; hpp: number; used: UsedBatch[]; error?: string } {
  if (!Number.isFinite(g) || g <= 0) {
    return { success: false, hpp: 0, used: [], error: 'Jumlah harus berupa angka lebih dari 0' };
  }

  const availableStock = it.batches.reduce((a, b) => a + b.gram, 0);
  if (g > availableStock) {
    const isPcs = it.unit === 'pcs';
    return {
      success: false,
      hpp: 0,
      used: [],
      error: `Stok tidak mencukupi! Tersedia: ${
        isPcs ? availableStock + ' pcs' : (availableStock / 1000).toFixed(3) + ' kg'
      }, Diminta: ${isPcs ? g + ' pcs' : (g / 1000).toFixed(3) + ' kg'}`,
    };
  }

  let left = g;
  let hpp = 0;
  const used: UsedBatch[] = [];
  const isPcs = it.unit === 'pcs';

  it.batches.sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));

  for (const b of it.batches) {
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

  it.batches = it.batches.filter((b) => b.gram > 0);
  syncItem(it);
  return { success: true, hpp: Math.round(hpp), used };
}

// ----------------------------------------------------
// REST API ENDPOINTS
// ----------------------------------------------------

// 1. Data Retrieval (Enforced Privacy & Role Validation)
app.get('/api/data', (req, res) => {
  const role = getAuthRole(req);
  store.items = sortItemsFixedOrder(store.items);

  if (role === 'owner') {
    return res.json({
      items: store.items,
      sales: store.sales,
      exp: store.exp,
      purchases: store.purchases,
      adjustments: store.adjustments,
      allowances: store.allowances,
      next: store.next,
      schemaVersion: CURRENT_SCHEMA_VERSION,
      role: 'owner',
    });
  }

  if (role === 'karyawan') {
    const safeItems = sortItemsFixedOrder(store.items.filter((it) => !it.archived))
      .map((it) => ({
        id: it.id,
        name: it.name,
        price: it.price,
        gram: it.gram,
        unit: it.unit || 'kg',
        estimatedGramPerPiece: it.estimatedGramPerPiece,
        batches: [],
        modal: 0,
      }));

    return res.json({
      items: safeItems,
      role: 'karyawan',
      pinRequired: false,
    });
  }

  const publicItems = sortItemsFixedOrder(store.items.filter((it) => !it.archived))
    .map((it) => ({
      id: it.id,
      name: it.name,
      price: it.price,
      gram: it.gram,
      unit: it.unit || 'kg',
      estimatedGramPerPiece: it.estimatedGramPerPiece,
      batches: [],
      modal: 0,
    }));

  return res.json({
    items: publicItems,
    role: 'unauthenticated',
    pinRequired: true,
  });
});

// 2. PIN Authentication: Rate-limited verification with timingSafeEqual & numeric regex
// Sets HTTP-only secure cookie; does NOT leak session token into response body
app.post('/api/verify-pin', (req, res) => {
  const ip = getClientIp(req);
  const now = Date.now();
  const attempt = pinAttempts.get(ip) || { count: 0, lockedUntil: 0 };

  if (attempt.lockedUntil > now) {
    const waitSec = Math.ceil((attempt.lockedUntil - now) / 1000);
    return res.status(429).json({
      success: false,
      error: `Terlalu banyak percobaan salah. Akun terkunci sementara selama ${waitSec} detik.`,
    });
  }

  const { pin } = req.body;
  if (!pin || typeof pin !== 'string' || !/^\d{4,}$/.test(pin)) {
    return res.status(400).json({ success: false, error: 'PIN harus berupa angka minimal 4 digit' });
  }

  const candidateHash = hashPin(pin, store.pinSalt);
  const candidateBuf = Buffer.from(candidateHash, 'hex');
  const storeBuf = Buffer.from(store.pinHash, 'hex');

  const isMatch =
    candidateBuf.length === storeBuf.length &&
    crypto.timingSafeEqual(candidateBuf, storeBuf);

  if (isMatch) {
    pinAttempts.delete(ip);
    const sessionId = crypto.randomUUID();
    const expiresAt = now + 7 * 24 * 60 * 60 * 1000; // 7 days session
    ownerSessions.set(sessionId, { sessionId, createdAt: now, expiresAt });

    res.setHeader('Set-Cookie', [
      `owner_session=${sessionId}; Path=/; HttpOnly; SameSite=Lax${secureCookie}; Max-Age=${7 * 24 * 3600}`,
    ]);

    return res.json({
      success: true,
      token: sessionId,
      expiresAt,
    });
  }

  attempt.count++;
  if (attempt.count >= 5) {
    attempt.lockedUntil = now + 5 * 60 * 1000; // 5 min lock
  }
  pinAttempts.set(ip, attempt);

  const remaining = Math.max(0, 5 - attempt.count);
  return res.status(401).json({
    success: false,
    error:
      remaining > 0
        ? `PIN salah! Sisa percobaan: ${remaining}`
        : 'Terlalu banyak percobaan salah. Akun terkunci 5 menit.',
  });
});

// 3. Change PIN (Owner Only) with numeric regex validation
app.post('/api/change-pin', (req, res) => {
  const role = getAuthRole(req);
  if (role !== 'owner') {
    return res.status(403).json({ success: false, error: 'Akses ditolak. Hanya untuk Pemilik.' });
  }

  const { newPin } = req.body;
  if (!newPin || typeof newPin !== 'string' || !/^\d{4,}$/.test(newPin)) {
    return res.status(400).json({ success: false, error: 'PIN baru harus berupa angka minimal 4 digit' });
  }

  const newSalt = crypto.randomBytes(16).toString('hex');
  const newHash = hashPin(newPin, newSalt);

  const result = executeTransactionalMutation(() => {
    store.pinSalt = newSalt;
    store.pinHash = newHash;
    return { success: true };
  });

  if (!result.success) {
    return res.status(result.status || 500).json({ error: result.error });
  }

  ownerSessions.clear();
  const sessionId = crypto.randomUUID();
  const expiresAt = Date.now() + 7 * 24 * 60 * 60 * 1000;
  ownerSessions.set(sessionId, { sessionId, createdAt: Date.now(), expiresAt });

  res.setHeader('Set-Cookie', [
    `owner_session=${sessionId}; Path=/; HttpOnly; SameSite=Lax${secureCookie}; Max-Age=${7 * 24 * 3600}`,
  ]);

  res.json({
    success: true,
    token: sessionId,
    message: 'PIN berhasil diubah dengan aman',
  });
});

// 4. Staff Token Management (Owner Only)
// Generates UUID token ID and 32-byte cryptographically secure token
app.post('/api/staff-token/create', (req, res) => {
  const role = getAuthRole(req);
  if (role !== 'owner') {
    return res.status(403).json({ error: 'Akses ditolak' });
  }

  const { label = 'HP Kasir' } = req.body;
  const rawToken = crypto.randomBytes(32).toString('hex');
  const tokenHash = hashToken(rawToken);

  const newToken: StaffToken = {
    id: `st-${crypto.randomUUID()}`,
    label,
    tokenHash,
    createdAt: Date.now(),
    revoked: false,
  };

  const result = executeTransactionalMutation(() => {
    store.staffTokens.unshift(newToken);
    return { success: true };
  });

  if (!result.success) {
    return res.status(result.status || 500).json({ error: result.error });
  }

  res.json({
    success: true,
    staffToken: {
      id: newToken.id,
      label: newToken.label,
      token: rawToken,
      createdAt: newToken.createdAt,
    },
    staffTokens: store.staffTokens.map(({ id, label, createdAt, revoked }) => ({ id, label, createdAt, revoked })),
  });
});

app.get('/api/staff-token/list', (req, res) => {
  const role = getAuthRole(req);
  if (role !== 'owner') {
    return res.status(403).json({ error: 'Akses ditolak' });
  }
  res.json({
    staffTokens: store.staffTokens.map(({ id, label, createdAt, revoked }) => ({ id, label, createdAt, revoked })),
  });
});

app.post('/api/staff-token/revoke', (req, res) => {
  const role = getAuthRole(req);
  if (role !== 'owner') {
    return res.status(403).json({ error: 'Akses ditolak' });
  }

  const { tokenId } = req.body;
  const target = store.staffTokens.find((t) => t.id === tokenId);
  if (!target) {
    return res.status(404).json({ error: 'Token kasir tidak ditemukan' });
  }

  const result = executeTransactionalMutation(() => {
    target.revoked = true;
    return { success: true };
  });

  if (!result.success) {
    return res.status(result.status || 500).json({ error: result.error });
  }

  for (const [sId, session] of staffSessions.entries()) {
    if (session.staffTokenId === tokenId) {
      staffSessions.delete(sId);
    }
  }

  res.json({
    success: true,
    staffTokens: store.staffTokens.map(({ id, label, createdAt, revoked }) => ({ id, label, createdAt, revoked })),
  });
});

// Exchange raw token for an independent ephemeral staff session
app.post('/api/staff-token/exchange', (req, res) => {
  const { token } = req.body;
  if (!token || typeof token !== 'string') {
    return res.status(400).json({ success: false, error: 'Token kasir diperlukan' });
  }

  const candidateHash = hashToken(token);
  const valid = store.staffTokens.find((t) => t.tokenHash === candidateHash && !t.revoked);
  if (!valid) {
    return res.status(401).json({ success: false, error: 'Token kasir tidak valid atau telah dicabut' });
  }

  const sessionId = crypto.randomUUID();
  staffSessions.set(sessionId, {
    sessionId,
    staffTokenId: valid.id,
    createdAt: Date.now(),
    expiresAt: Date.now() + 30 * 24 * 3600 * 1000,
  });

  res.setHeader('Set-Cookie', [
    `staff_session=${sessionId}; Path=/; HttpOnly; SameSite=Lax${secureCookie}; Max-Age=${30 * 24 * 3600}`,
  ]);

  res.json({ success: true, token: sessionId, label: valid.label });
});

// 5. Logout
app.post('/api/logout', (req, res) => {
  const cookies = parseCookies(req.headers.cookie);
  const ownerSessionId =
    cookies['owner_session'] ||
    (req.headers['x-owner-token'] as string) ||
    (req.headers['x-session-token'] as string);
  const staffSessionId =
    cookies['staff_session'] ||
    (req.headers['x-staff-token'] as string);

  if (ownerSessionId) ownerSessions.delete(ownerSessionId);
  if (staffSessionId) staffSessions.delete(staffSessionId);

  res.setHeader('Set-Cookie', [
    `owner_session=; Path=/; HttpOnly; SameSite=Lax${secureCookie}; Max-Age=0`,
    `staff_session=; Path=/; HttpOnly; SameSite=Lax${secureCookie}; Max-Age=0`,
  ]);

  res.json({ success: true });
});

// 6. Atomic Sale Transaction (Server Authoritative)
app.post('/api/sales', (req, res) => {
  const role = getAuthRole(req);
  if (!role) {
    return res.status(401).json({ error: 'Sesi kasir tidak valid. Buka tautan QR Kasir terbaru.' });
  }

  const { itemId, nominal } = req.body;

  if (typeof nominal !== 'number' || !Number.isFinite(nominal) || nominal <= 0) {
    return res.status(400).json({ error: 'Nominal penjualan harus berupa angka lebih dari 0' });
  }

  const it = store.items.find((i) => i.id === itemId);
  if (!it || it.archived) {
    return res.status(404).json({ error: 'Barang tidak ditemukan atau telah dinonaktifkan' });
  }

  if (typeof it.price !== 'number' || !Number.isFinite(it.price) || it.price <= 0) {
    return res.status(400).json({ error: 'Harga jual barang belum diatur' });
  }

  const isPcs = it.unit === 'pcs';
  const amount = isPcs
    ? Math.round((nominal / it.price) * 100) / 100
    : Math.round((nominal / it.price) * 1000);

  let newSale: Sale | null = null;

  const result = executeTransactionalMutation(() => {
    const fifoResult = fifoDeductAtomic(it, amount);
    if (!fifoResult.success) {
      return { success: false, status: 400, error: fifoResult.error };
    }

    newSale = {
      id: store.next++,
      itemId: it.id,
      name: it.name,
      nominal,
      gram: amount,
      unit: it.unit,
      hpp: fifoResult.hpp,
      used: fifoResult.used,
      t: Date.now(),
      by: role,
      sellingPrice: it.price,
      status: 'completed',
    };

    store.sales.unshift(newSale);
    return { success: true };
  });

  if (!result.success) {
    return res.status(result.status || 500).json({ error: result.error });
  }

  res.json({
    success: true,
    sale: newSale,
    item: {
      id: it.id,
      gram: it.gram,
      batches: role === 'owner' ? it.batches : [],
      modal: role === 'owner' ? it.modal : 0,
    },
    store: role === 'owner' ? store : undefined,
  });
});

// 7. Cancel Sale (Owner Only - Status Audit & Precise Batch Restoration)
app.post('/api/cancel-sale', (req, res) => {
  if (getAuthRole(req) !== 'owner') {
    return res.status(403).json({ error: 'Akses hanya untuk pemilik' });
  }

  const { saleId } = req.body;
  const sale = store.sales.find((s) => s.id === saleId);
  if (!sale) {
    return res.status(404).json({ error: 'Transaksi tidak ditemukan' });
  }

  if (sale.status === 'cancelled') {
    return res.status(400).json({ error: 'Transaksi ini sudah pernah dibatalkan sebelumnya.' });
  }

  const it = store.items.find((i) => i.id === sale.itemId);

  const result = executeTransactionalMutation(() => {
    if (it) {
      if (sale.used && Array.isArray(sale.used) && sale.used.length > 0) {
        for (let k = sale.used.length - 1; k >= 0; k--) {
          const u = sale.used[k];
          const b = it.batches.find((x) => x.id === u.bid);
          if (b) {
            b.gram += u.gram;
          } else {
            it.batches.push({
              id: u.bid,
              gram: u.gram,
              cost: u.cost,
              createdAt: u.createdAt || Date.now(),
              purchaseId: u.purchaseId,
              supplier: u.supplier,
            });
          }
        }
      } else {
        // Return stock gracefully even if historical used-batches array was empty
        const returnGram = sale.gram || (it.unit === 'pcs' ? 1 : 1000);
        if (it.batches && it.batches.length > 0) {
          it.batches[it.batches.length - 1].gram += returnGram;
        } else {
          it.batches = [
            {
              id: Date.now(),
              gram: returnGram,
              cost: sale.hpp || it.modal || 0,
              createdAt: Date.now(),
            },
          ];
        }
      }
      syncItem(it);
    }

    sale.status = 'cancelled';
    sale.cancelledAt = Date.now();
    return { success: true };
  });

  if (!result.success) {
    return res.status(result.status || 500).json({ error: result.error });
  }

  res.json({ success: true, store });
});

// 7b. Delete Sale Permanently (Owner Only - Hapus Total Dari Riwayat)
app.post('/api/delete-sale', (req, res) => {
  if (getAuthRole(req) !== 'owner') {
    return res.status(403).json({ error: 'Akses hanya untuk pemilik' });
  }

  const { saleId } = req.body;
  const saleIndex = store.sales.findIndex((s) => s.id === saleId);
  if (saleIndex === -1) {
    return res.status(404).json({ error: 'Transaksi tidak ditemukan' });
  }

  const sale = store.sales[saleIndex];
  const it = store.items.find((i) => i.id === sale.itemId);

  const result = executeTransactionalMutation(() => {
    // If not already cancelled, restore stock before deleting permanently
    if (sale.status !== 'cancelled' && it) {
      if (sale.used && Array.isArray(sale.used) && sale.used.length > 0) {
        for (let k = sale.used.length - 1; k >= 0; k--) {
          const u = sale.used[k];
          const b = it.batches.find((x) => x.id === u.bid);
          if (b) {
            b.gram += u.gram;
          } else {
            it.batches.push({
              id: u.bid,
              gram: u.gram,
              cost: u.cost,
              createdAt: u.createdAt || Date.now(),
              purchaseId: u.purchaseId,
              supplier: u.supplier,
            });
          }
        }
      } else {
        const returnGram = sale.gram || (it.unit === 'pcs' ? 1 : 1000);
        if (it.batches && it.batches.length > 0) {
          it.batches[it.batches.length - 1].gram += returnGram;
        } else {
          it.batches = [
            {
              id: Date.now(),
              gram: returnGram,
              cost: sale.hpp || it.modal || 0,
              createdAt: Date.now(),
            },
          ];
        }
      }
      syncItem(it);
    }

    // Permanently remove from store.sales
    store.sales.splice(saleIndex, 1);
    return { success: true };
  });

  if (!result.success) {
    return res.status(result.status || 500).json({ error: result.error });
  }

  res.json({ success: true, store });
});

// 8. Purchases Engine (Kulakan / Belanja Stok - Owner Only)
// Strictly validates finite numerical inputs
app.post('/api/purchases', (req, res) => {
  if (getAuthRole(req) !== 'owner') {
    return res.status(403).json({ error: 'Akses hanya untuk pemilik' });
  }

  const {
    itemId,
    supplier = 'Supplier Umum',
    isIkat = false,
    ikatCount = 0,
    kgPerIkat = 15,
    qty = 0,
    costPerUnit = 0,
    note = '',
  } = req.body;

  const it = store.items.find((i) => i.id === itemId);
  if (!it) {
    return res.status(404).json({ error: 'Barang tidak ditemukan' });
  }

  if (!Number.isFinite(costPerUnit) || costPerUnit <= 0) {
    return res.status(400).json({ error: 'Harga beli/modal per satuan harus berupa angka lebih dari 0' });
  }

  const isPcs = it.unit === 'pcs';
  let totalQty = 0;
  let totalCost = 0;

  if (isIkat && !isPcs) {
    if (!Number.isFinite(ikatCount) || ikatCount <= 0 || !Number.isFinite(kgPerIkat) || kgPerIkat <= 0) {
      return res.status(400).json({ error: 'Jumlah ikat dan kg per ikat harus berupa angka lebih dari 0' });
    }
    const totalKg = ikatCount * (kgPerIkat || 15);
    totalQty = Math.round(totalKg * 1000);
    totalCost = Math.round(totalKg * costPerUnit);
  } else {
    if (!Number.isFinite(qty) || qty <= 0) {
      return res.status(400).json({ error: 'Jumlah stok harus berupa angka lebih dari 0' });
    }
    totalQty = isPcs ? qty : Math.round(qty * 1000);
    totalCost = isPcs ? Math.round(qty * costPerUnit) : Math.round(qty * costPerUnit);
  }

  let newPurchase: Purchase | null = null;

  const result = executeTransactionalMutation(() => {
    const purchaseId = store.next++;
    const batchId = store.next++;

    const newBatch: Batch = {
      id: batchId,
      gram: totalQty,
      cost: costPerUnit,
      createdAt: Date.now(),
      purchaseId,
      supplier,
    };

    it.batches.push(newBatch);
    it.modal = costPerUnit;
    syncItem(it);

    newPurchase = {
      id: purchaseId,
      itemId: it.id,
      itemName: it.name,
      supplier,
      unit: it.unit || 'kg',
      isIkat: Boolean(isIkat && !isPcs),
      ikatCount: isIkat ? ikatCount : undefined,
      kgPerIkat: isIkat ? kgPerIkat || 15 : undefined,
      qty: totalQty,
      costPerUnit,
      totalCost,
      t: Date.now(),
      batchId,
      note,
      status: 'completed',
    };

    store.purchases.unshift(newPurchase);
    return { success: true };
  });

  if (!result.success) {
    return res.status(result.status || 500).json({ error: result.error });
  }

  res.json({ success: true, purchase: newPurchase, store });
});

// 9. Cancel Purchase (Owner Only - Status Audit)
app.post('/api/cancel-purchase', (req, res) => {
  if (getAuthRole(req) !== 'owner') {
    return res.status(403).json({ error: 'Akses hanya untuk pemilik' });
  }

  const { purchaseId } = req.body;
  const purchase = store.purchases.find((p) => p.id === purchaseId);
  if (!purchase) {
    return res.status(404).json({ error: 'Data pembelian tidak ditemukan' });
  }

  if (purchase.status === 'cancelled') {
    return res.status(400).json({ error: 'Pembelian ini sudah pernah dibatalkan sebelumnya.' });
  }

  const it = store.items.find((i) => i.id === purchase.itemId);
  if (it) {
    const batch = it.batches.find((b) => b.id === purchase.batchId);
    if (!batch) {
      return res.status(400).json({
        error: 'Stok dari pembelian ini sudah habis terjual, sehingga tidak bisa dibatalkan.',
      });
    }
    if (batch.gram < purchase.qty) {
      return res.status(400).json({
        error: 'Stok dari pembelian ini sudah sebagian terjual. Tidak bisa dibatalkan demi integritas akuntansi FIFO.',
      });
    }
  }

  const result = executeTransactionalMutation(() => {
    if (it) {
      it.batches = it.batches.filter((b) => b.id !== purchase.batchId);
      syncItem(it);
    }
    purchase.status = 'cancelled';
    purchase.cancelledAt = Date.now();
    return { success: true };
  });

  if (!result.success) {
    return res.status(result.status || 500).json({ error: result.error });
  }

  res.json({ success: true, store });
});

// 9b. Delete Purchase Permanently (Owner Only - Hapus Total Dari Riwayat)
app.post('/api/delete-purchase', (req, res) => {
  if (getAuthRole(req) !== 'owner') {
    return res.status(403).json({ error: 'Akses hanya untuk pemilik' });
  }

  const { purchaseId } = req.body;
  const pIndex = store.purchases.findIndex((p) => p.id === purchaseId);
  if (pIndex === -1) {
    return res.status(404).json({ error: 'Data pembelian tidak ditemukan' });
  }

  const purchase = store.purchases[pIndex];
  const it = store.items.find((i) => i.id === purchase.itemId);

  const result = executeTransactionalMutation(() => {
    if (purchase.status !== 'cancelled' && it) {
      it.batches = it.batches.filter((b) => b.id !== purchase.batchId);
      syncItem(it);
    }
    store.purchases.splice(pIndex, 1);
    return { success: true };
  });

  if (!result.success) {
    return res.status(result.status || 500).json({ error: result.error });
  }

  res.json({ success: true, store });
});

// 10. Stock Adjustment Engine (Telur Pecah, Rusak, Susut, Koreksi)
app.post('/api/adjustments', (req, res) => {
  const role = getAuthRole(req);
  if (!role) {
    return res.status(401).json({ error: 'Sesi tidak sah. Buka kembali tautan kasir.' });
  }

  const { itemId, reason, direction, piecesCount, rawQty, cost, note = '' } = req.body;

  if (!VALID_ADJUSTMENT_REASONS.includes(reason)) {
    return res.status(400).json({ error: 'Alasan penyesuaian stok tidak valid' });
  }

  if (role === 'karyawan' && !['pecah', 'rusak'].includes(reason)) {
    return res.status(403).json({
      error: 'Karyawan hanya dapat mencatat telur pecah atau rusak',
    });
  }

  const it = store.items.find((i) => i.id === itemId);
  if (!it || it.archived) {
    return res.status(404).json({ error: 'Barang tidak ditemukan atau telah dinonaktifkan' });
  }

  let isReduction = false;
  if (['pecah', 'rusak', 'hilang', 'koreksi_kurang'].includes(reason)) {
    isReduction = true;
  } else if (reason === 'koreksi_tambah') {
    isReduction = false;
  } else if (reason === 'lainnya') {
    if (direction !== 'kurang' && direction !== 'tambah') {
      return res.status(400).json({
        error: 'Untuk alasan lainnya, tentukan arah penyesuaian stok: tambah atau kurang',
      });
    }
    isReduction = direction === 'kurang';
  }

  const isPcs = it.unit === 'pcs';
  let adjustedGrams = 0;

  if (piecesCount && piecesCount > 0 && !isPcs) {
    if (!it.estimatedGramPerPiece || it.estimatedGramPerPiece <= 0) {
      return res.status(400).json({
        error: 'Barang belum memiliki konfigurasi estimasi berat per butir (gram). Silakan atur di data barang atau gunakan input timbangan berat (kg).',
      });
    }
    adjustedGrams = Math.round(piecesCount * it.estimatedGramPerPiece);
  } else if (rawQty && rawQty > 0) {
    adjustedGrams = isPcs ? rawQty : Math.round(rawQty * 1000);
  } else {
    return res.status(400).json({ error: 'Jumlah penyesuaian stok tidak valid' });
  }

  let newAdj: StockAdjustment | null = null;

  if (isReduction) {
    const result = executeTransactionalMutation(() => {
      const fifoResult = fifoDeductAtomic(it, adjustedGrams);
      if (!fifoResult.success) {
        return { success: false, status: 400, error: fifoResult.error };
      }

      newAdj = {
        id: store.next++,
        itemId: it.id,
        itemName: it.name,
        unit: it.unit || 'kg',
        qty: -adjustedGrams,
        piecesCount: piecesCount || undefined,
        reason,
        note,
        hppValue: fifoResult.hpp,
        used: fifoResult.used,
        t: Date.now(),
        by: role,
        status: 'completed',
      };

      store.adjustments.unshift(newAdj);
      return { success: true };
    });

    if (!result.success) {
      return res.status(result.status || 500).json({ error: result.error });
    }

    return res.json({
      success: true,
      adjustment: newAdj,
      item: {
        id: it.id,
        gram: it.gram,
        batches: role === 'owner' ? it.batches : [],
        modal: role === 'owner' ? it.modal : 0,
      },
      store: role === 'owner' ? store : undefined,
    });
  } else {
    if (role !== 'owner') {
      return res.status(403).json({ error: 'Penambahan stok manual hanya boleh dilakukan oleh Pemilik' });
    }

    if (!cost || typeof cost !== 'number' || !Number.isFinite(cost) || cost <= 0) {
      return res.status(400).json({
        error: 'Harga modal wajib diisi untuk penambahan stok manual',
      });
    }

    const batchCost = cost;

    const result = executeTransactionalMutation(() => {
      const batchId = store.next++;
      it.batches.push({
        id: batchId,
        gram: adjustedGrams,
        cost: batchCost,
        createdAt: Date.now(),
      });
      it.modal = batchCost;
      syncItem(it);

      newAdj = {
        id: store.next++,
        itemId: it.id,
        itemName: it.name,
        unit: it.unit || 'kg',
        qty: adjustedGrams,
        piecesCount: piecesCount || undefined,
        reason,
        note,
        hppValue: isPcs ? adjustedGrams * batchCost : Math.round((adjustedGrams * batchCost) / 1000),
        used: [],
        batchId,
        t: Date.now(),
        by: 'owner',
        status: 'completed',
      };

      store.adjustments.unshift(newAdj);
      return { success: true };
    });

    if (!result.success) {
      return res.status(result.status || 500).json({ error: result.error });
    }

    return res.json({ success: true, adjustment: newAdj, store });
  }
});

// 10b. Cancel Stock Adjustment (Owner Only - Status Audit & Return Stock)
app.post('/api/cancel-adjustment', (req, res) => {
  if (getAuthRole(req) !== 'owner') {
    return res.status(403).json({ error: 'Akses hanya untuk pemilik' });
  }

  const { adjustmentId } = req.body;
  const adj = store.adjustments.find((a) => a.id === adjustmentId);
  if (!adj) {
    return res.status(404).json({ error: 'Data penyesuaian tidak ditemukan' });
  }

  if (adj.status === 'cancelled') {
    return res.status(400).json({ error: 'Penyesuaian ini sudah pernah dibatalkan sebelumnya.' });
  }

  const it = store.items.find((i) => i.id === adj.itemId);

  const result = executeTransactionalMutation(() => {
    if (it) {
      if (adj.qty < 0) {
        // Was a reduction (e.g. telur pecah), restore the deducted stock
        const returnGram = Math.abs(adj.qty);
        if (adj.used && Array.isArray(adj.used) && adj.used.length > 0) {
          for (let k = adj.used.length - 1; k >= 0; k--) {
            const u = adj.used[k];
            const b = it.batches.find((x) => x.id === u.bid);
            if (b) {
              b.gram += u.gram;
            } else {
              it.batches.push({
                id: u.bid,
                gram: u.gram,
                cost: u.cost,
                createdAt: u.createdAt || Date.now(),
                purchaseId: u.purchaseId,
                supplier: u.supplier,
              });
            }
          }
        } else {
          if (it.batches && it.batches.length > 0) {
            it.batches[it.batches.length - 1].gram += returnGram;
          } else {
            it.batches = [
              {
                id: Date.now(),
                gram: returnGram,
                cost: adj.hppValue ? (adj.unit === 'pcs' ? adj.hppValue / returnGram : (adj.hppValue * 1000) / returnGram) : it.modal || 0,
                createdAt: Date.now(),
              },
            ];
          }
        }
      } else {
        // Was an addition, remove the added batch if exists
        if (adj.batchId) {
          it.batches = it.batches.filter((b) => b.id !== adj.batchId);
        }
      }
      syncItem(it);
    }

    adj.status = 'cancelled';
    adj.cancelledAt = Date.now();
    return { success: true };
  });

  if (!result.success) {
    return res.status(result.status || 500).json({ error: result.error });
  }

  res.json({ success: true, store });
});

// 10c. Delete Stock Adjustment Permanently (Owner Only - Hapus Total Dari Riwayat)
app.post('/api/delete-adjustment', (req, res) => {
  if (getAuthRole(req) !== 'owner') {
    return res.status(403).json({ error: 'Akses hanya untuk pemilik' });
  }

  const { adjustmentId } = req.body;
  const adjIndex = store.adjustments.findIndex((a) => a.id === adjustmentId);
  if (adjIndex === -1) {
    return res.status(404).json({ error: 'Data penyesuaian tidak ditemukan' });
  }

  const adj = store.adjustments[adjIndex];
  const it = store.items.find((i) => i.id === adj.itemId);

  const result = executeTransactionalMutation(() => {
    // If not yet cancelled, restore stock before deleting permanently
    if (adj.status !== 'cancelled' && it) {
      if (adj.qty < 0) {
        const returnGram = Math.abs(adj.qty);
        if (adj.used && Array.isArray(adj.used) && adj.used.length > 0) {
          for (let k = adj.used.length - 1; k >= 0; k--) {
            const u = adj.used[k];
            const b = it.batches.find((x) => x.id === u.bid);
            if (b) {
              b.gram += u.gram;
            } else {
              it.batches.push({
                id: u.bid,
                gram: u.gram,
                cost: u.cost,
                createdAt: u.createdAt || Date.now(),
                purchaseId: u.purchaseId,
                supplier: u.supplier,
              });
            }
          }
        } else {
          if (it.batches && it.batches.length > 0) {
            it.batches[it.batches.length - 1].gram += returnGram;
          } else {
            it.batches = [
              {
                id: Date.now(),
                gram: returnGram,
                cost: adj.hppValue ? (adj.unit === 'pcs' ? adj.hppValue / returnGram : (adj.hppValue * 1000) / returnGram) : it.modal || 0,
                createdAt: Date.now(),
              },
            ];
          }
        }
      } else {
        if (adj.batchId) {
          it.batches = it.batches.filter((b) => b.id !== adj.batchId);
        }
      }
      syncItem(it);
    }

    store.adjustments.splice(adjIndex, 1);
    return { success: true };
  });

  if (!result.success) {
    return res.status(result.status || 500).json({ error: result.error });
  }

  res.json({ success: true, store });
});

// 11. Staff Allowance (Jatah Karyawan - Internal Stock Consumption)
app.post('/api/allowances', (req, res) => {
  const role = getAuthRole(req);
  if (role !== 'owner') {
    return res.status(403).json({ error: 'Pengeluaran jatah karyawan hanya boleh disetujui Pemilik' });
  }

  const { itemId, gram, staffName = 'Karyawan', note = '' } = req.body;
  const it = store.items.find((i) => i.id === itemId);
  if (!it || !gram || !Number.isFinite(gram) || gram <= 0) {
    return res.status(400).json({ error: 'Data jatah tidak valid' });
  }

  let newAllowance: StaffAllowance | null = null;

  const result = executeTransactionalMutation(() => {
    const fifoResult = fifoDeductAtomic(it, gram);
    if (!fifoResult.success) {
      return { success: false, status: 400, error: fifoResult.error };
    }

    newAllowance = {
      id: store.next++,
      itemId: it.id,
      itemName: it.name,
      unit: it.unit || 'kg',
      gram,
      staffName,
      note,
      hppCost: fifoResult.hpp,
      used: fifoResult.used,
      t: Date.now(),
      status: 'completed',
    };

    store.allowances.unshift(newAllowance);
    return { success: true };
  });

  if (!result.success) {
    return res.status(result.status || 500).json({ error: result.error });
  }

  res.json({ success: true, allowance: newAllowance, store });
});

// 12. Cancel Allowance (Owner Only - Status Audit)
app.post('/api/cancel-allowance', (req, res) => {
  if (getAuthRole(req) !== 'owner') {
    return res.status(403).json({ error: 'Akses ditolak' });
  }

  const { allowanceId } = req.body;
  const allowance = store.allowances.find((a) => a.id === allowanceId);
  if (!allowance) {
    return res.status(404).json({ error: 'Data jatah tidak ditemukan' });
  }

  if (allowance.status === 'cancelled') {
    return res.status(400).json({ error: 'Jatah ini sudah pernah dibatalkan sebelumnya.' });
  }

  const it = store.items.find((i) => i.id === allowance.itemId);

  const result = executeTransactionalMutation(() => {
    if (it) {
      if (allowance.used && Array.isArray(allowance.used) && allowance.used.length > 0) {
        for (let k = allowance.used.length - 1; k >= 0; k--) {
          const u = allowance.used[k];
          const b = it.batches.find((x) => x.id === u.bid);
          if (b) {
            b.gram += u.gram;
          } else {
            it.batches.push({
              id: u.bid,
              gram: u.gram,
              cost: u.cost,
              createdAt: u.createdAt || Date.now(),
              purchaseId: u.purchaseId,
              supplier: u.supplier,
            });
          }
        }
      } else {
        const returnGram = allowance.gram || (it.unit === 'pcs' ? 1 : 1000);
        if (it.batches && it.batches.length > 0) {
          it.batches[it.batches.length - 1].gram += returnGram;
        } else {
          it.batches = [
            {
              id: Date.now(),
              gram: returnGram,
              cost: it.modal || 0,
              createdAt: Date.now(),
            },
          ];
        }
      }
      syncItem(it);
    }
    allowance.status = 'cancelled';
    allowance.cancelledAt = Date.now();
    return { success: true };
  });

  if (!result.success) {
    return res.status(result.status || 500).json({ error: result.error });
  }

  res.json({ success: true, store });
});

// 12b. Delete Staff Allowance Permanently (Owner Only - Hapus Total Dari Riwayat)
app.post('/api/delete-allowance', (req, res) => {
  if (getAuthRole(req) !== 'owner') {
    return res.status(403).json({ error: 'Akses ditolak' });
  }

  const { allowanceId } = req.body;
  const alIndex = store.allowances.findIndex((a) => a.id === allowanceId);
  if (alIndex === -1) {
    return res.status(404).json({ error: 'Data jatah tidak ditemukan' });
  }

  const allowance = store.allowances[alIndex];
  const it = store.items.find((i) => i.id === allowance.itemId);

  const result = executeTransactionalMutation(() => {
    if (allowance.status !== 'cancelled' && it) {
      if (allowance.used && Array.isArray(allowance.used) && allowance.used.length > 0) {
        for (let k = allowance.used.length - 1; k >= 0; k--) {
          const u = allowance.used[k];
          const b = it.batches.find((x) => x.id === u.bid);
          if (b) {
            b.gram += u.gram;
          } else {
            it.batches.push({
              id: u.bid,
              gram: u.gram,
              cost: u.cost,
              createdAt: u.createdAt || Date.now(),
              purchaseId: u.purchaseId,
              supplier: u.supplier,
            });
          }
        }
      } else {
        const returnGram = allowance.gram || (it.unit === 'pcs' ? 1 : 1000);
        if (it.batches && it.batches.length > 0) {
          it.batches[it.batches.length - 1].gram += returnGram;
        } else {
          it.batches = [
            {
              id: Date.now(),
              gram: returnGram,
              cost: it.modal || 0,
              createdAt: Date.now(),
            },
          ];
        }
      }
      syncItem(it);
    }

    store.allowances.splice(alIndex, 1);
    return { success: true };
  });

  if (!result.success) {
    return res.status(result.status || 500).json({ error: result.error });
  }

  res.json({ success: true, store });
});

// 13. Operational Cash Expenses (Owner Only)
app.post('/api/expenses', (req, res) => {
  if (getAuthRole(req) !== 'owner') {
    return res.status(403).json({ error: 'Akses ditolak' });
  }

  const { nominal, cat, note } = req.body;
  if (!nominal || typeof nominal !== 'number' || !Number.isFinite(nominal) || nominal <= 0) {
    return res.status(400).json({ error: 'Nominal pengeluaran tidak valid' });
  }

  let newExpense: Expense | null = null;

  const result = executeTransactionalMutation(() => {
    newExpense = {
      id: store.next++,
      nominal,
      t: Date.now(),
      cat: String(cat || 'Operasional'),
      note,
      status: 'completed',
    };
    store.exp.unshift(newExpense);
    return { success: true };
  });

  if (!result.success) {
    return res.status(result.status || 500).json({ error: result.error });
  }

  res.json({ success: true, expense: newExpense, store });
});

// 14. Cancel Expense (Owner Only - Status Audit)
app.post('/api/cancel-expense', (req, res) => {
  if (getAuthRole(req) !== 'owner') {
    return res.status(403).json({ error: 'Akses ditolak' });
  }

  const { expenseId } = req.body;
  const target = store.exp.find((e) => e.id === expenseId);
  if (!target) {
    return res.status(404).json({ error: 'Data pengeluaran tidak ditemukan' });
  }

  if (target.status === 'cancelled') {
    return res.status(400).json({ error: 'Pengeluaran ini sudah pernah dibatalkan sebelumnya.' });
  }

  const result = executeTransactionalMutation(() => {
    target.status = 'cancelled';
    target.cancelledAt = Date.now();
    return { success: true };
  });

  if (!result.success) {
    return res.status(result.status || 500).json({ error: result.error });
  }

  res.json({ success: true, store });
});

// 14b. Delete Expense Permanently (Owner Only - Hapus Total Dari Riwayat)
app.post('/api/delete-expense', (req, res) => {
  if (getAuthRole(req) !== 'owner') {
    return res.status(403).json({ error: 'Akses ditolak' });
  }

  const { expenseId } = req.body;
  const eIndex = store.exp.findIndex((e) => e.id === expenseId);
  if (eIndex === -1) {
    return res.status(404).json({ error: 'Data pengeluaran tidak ditemukan' });
  }

  const result = executeTransactionalMutation(() => {
    store.exp.splice(eIndex, 1);
    return { success: true };
  });

  if (!result.success) {
    return res.status(result.status || 500).json({ error: result.error });
  }

  res.json({ success: true, store });
});

// 15. Item Master Management (Owner Only)
const VALID_ITEM_ACTIONS = ['create', 'update', 'reorder', 'delete', 'add-stock', 'reduce-stock'] as const;

app.post('/api/items', (req, res) => {
  if (getAuthRole(req) !== 'owner') {
    return res.status(403).json({ error: 'Akses hanya untuk pemilik' });
  }

  const { action, item, fromIndex, direction } = req.body;

  if (!VALID_ITEM_ACTIONS.includes(action)) {
    return res.status(400).json({ error: `Aksi barang tidak valid (${action})` });
  }

  const result = executeTransactionalMutation(() => {
    if (action === 'create') {
      const trimmedName = (item.name || '').trim();
      if (!trimmedName) {
        return { success: false, status: 400, error: 'Nama barang wajib diisi' };
      }

      const existing = store.items.find(
        (i) => !i.archived && i.name.trim().toLowerCase() === trimmedName.toLowerCase()
      );
      if (existing) {
        return {
          success: false,
          status: 400,
          error: `Barang dengan nama "${trimmedName}" sudah ada dalam daftar barang aktif. Silakan gunakan nama lain atau perbarui stok/harga barang yang ada.`,
        };
      }

      const id = store.next++;
      const unit: ItemUnit = item.unit || (item.name.toLowerCase().includes('minyak') ? 'pcs' : 'kg');
      const isPcs = unit === 'pcs';
      const initialQty = isPcs ? item.initialStockKg || 0 : Math.round((item.initialStockKg || 0) * 1000);

      let initialBatchCost = 0;
      if (initialQty > 0) {
        const cost = item.initialCost ?? item.cost ?? item.modal;
        if (!cost || typeof cost !== 'number' || !Number.isFinite(cost) || cost <= 0) {
          return {
            success: false,
            status: 400,
            error: 'Harga modal (initialCost) wajib diisi dengan angka lebih dari 0 jika memasukkan stok awal barang.',
          };
        }
        initialBatchCost = cost;
      } else {
        initialBatchCost = Number.isFinite(item.modal) && item.modal > 0 ? item.modal : 0;
      }

      const newItem: Item = {
        id,
        name: item.name,
        price: Number.isFinite(item.price) && item.price > 0 ? item.price : 0,
        modal: initialBatchCost,
        gram: 0,
        unit,
        estimatedGramPerPiece: Number.isFinite(item.estimatedGramPerPiece) && item.estimatedGramPerPiece > 0
          ? item.estimatedGramPerPiece
          : undefined,
        batches:
          initialQty > 0
            ? [{ id: store.next++, gram: initialQty, cost: initialBatchCost, createdAt: Date.now(), supplier: item.supplier || 'Stok Awal' }]
            : [],
      };
      syncItem(newItem);
      store.items.push(newItem);
    } else if (action === 'update') {
      const idx = store.items.findIndex((i) => i.id === item.id);
      if (idx !== -1) {
        const current = store.items[idx];

        if (item.unit && item.unit !== current.unit) {
          const hasHistory =
            (current.batches && current.batches.length > 0) ||
            store.sales.some((s) => s.itemId === current.id) ||
            store.purchases.some((p) => p.itemId === current.id) ||
            store.adjustments.some((a) => a.itemId === current.id) ||
            store.allowances.some((al) => al.itemId === current.id);

          if (hasHistory) {
            return {
              success: false,
              status: 400,
              error: 'Satuan barang yang sudah memiliki riwayat transaksi tidak dapat diubah.',
            };
          }
        }

        store.items[idx] = {
          ...current,
          name: item.name,
          price: Number.isFinite(item.price) ? item.price : current.price,
          modal: Number.isFinite(item.modal) ? item.modal : current.modal,
          unit: item.unit || current.unit,
          estimatedGramPerPiece: Number.isFinite(item.estimatedGramPerPiece)
            ? item.estimatedGramPerPiece
            : current.estimatedGramPerPiece,
        };
        syncItem(store.items[idx]);
      }
    } else if (action === 'reorder') {
      const activeList = store.items.filter((i) => !i.archived);
      let targetItemId =
        typeof req.body.itemId === 'number'
          ? req.body.itemId
          : typeof item?.id === 'number'
          ? item.id
          : null;

      if (targetItemId === null && typeof fromIndex === 'number' && fromIndex >= 0 && fromIndex < activeList.length) {
        targetItemId = activeList[fromIndex].id;
      }

      if (targetItemId !== null) {
        const currentActiveIdx = activeList.findIndex((i) => i.id === targetItemId);
        if (currentActiveIdx !== -1) {
          const newActiveIdx = currentActiveIdx + direction;
          if (newActiveIdx >= 0 && newActiveIdx < activeList.length) {
            const neighborItem = activeList[newActiveIdx];
            const realIdxA = store.items.findIndex((i) => i.id === targetItemId);
            const realIdxB = store.items.findIndex((i) => i.id === neighborItem.id);
            if (realIdxA !== -1 && realIdxB !== -1) {
              const [moved] = store.items.splice(realIdxA, 1);
              store.items.splice(realIdxB, 0, moved);
            }
          }
        }
      } else if (typeof fromIndex === 'number') {
        const targetIdx = fromIndex + direction;
        if (targetIdx >= 0 && targetIdx < store.items.length) {
          const [moved] = store.items.splice(fromIndex, 1);
          store.items.splice(targetIdx, 0, moved);
        }
      }
    } else if (action === 'delete') {
      const it = store.items.find((i) => i.id === item.id);
      if (!it) {
        return { success: false, status: 404, error: 'Barang tidak ditemukan' };
      }

      // Clear remaining stock upon deletion
      it.batches = [];
      it.gram = 0;

      const hasHistory =
        store.sales.some((s) => s.itemId === item.id) ||
        store.purchases.some((p) => p.itemId === item.id) ||
        store.adjustments.some((a) => a.itemId === item.id) ||
        store.allowances.some((al) => al.itemId === item.id);

      if (hasHistory) {
        it.archived = true;
      } else {
        store.items = store.items.filter((i) => i.id !== item.id);
      }
      return { success: true };
    } else if (action === 'add-stock') {
      const it = store.items.find((i) => i.id === item.id);
      if (!it) {
        return { success: false, status: 404, error: 'Barang tidak ditemukan' };
      }
      const addQty = item.qty ?? item.addedKg;
      if (!Number.isFinite(addQty) || addQty <= 0) {
        return { success: false, status: 400, error: 'Jumlah penambahan stok harus berupa angka lebih dari 0' };
      }
      if (!Number.isFinite(item.cost) || item.cost <= 0) {
        return { success: false, status: 400, error: 'Harga modal wajib diisi untuk penambahan stok' };
      }
      const isPcs = it.unit === 'pcs';
      const qtyInUnit = isPcs ? addQty : Math.round(addQty * 1000);
      const cost = item.cost;
      it.batches.push({
        id: store.next++,
        gram: qtyInUnit,
        cost,
        createdAt: Date.now(),
        supplier: item.supplier || 'Penambahan Manual',
      });
      it.modal = cost;
      syncItem(it);
    } else if (action === 'reduce-stock') {
      const it = store.items.find((i) => i.id === item.id);
      if (!it) {
        return { success: false, status: 404, error: 'Barang tidak ditemukan' };
      }
      const reduceQty = item.qty ?? item.reducedQty;
      if (!Number.isFinite(reduceQty) || reduceQty <= 0) {
        return { success: false, status: 400, error: 'Jumlah pengurangan stok harus berupa angka lebih dari 0' };
      }
      const isPcs = it.unit === 'pcs';
      const qtyInGramOrPcs = isPcs ? reduceQty : Math.round(reduceQty * 1000);
      if (qtyInGramOrPcs > it.gram) {
        return {
          success: false,
          status: 400,
          error: `Stok tidak mencukupi untuk dikurangi! Tersedia: ${
            isPcs ? it.gram + ' pcs' : (it.gram / 1000).toFixed(3) + ' kg'
          }`,
        };
      }

      // If batches have fewer grams than it.gram due to past legacy adjustments, seed missing grams
      const totalBatchGram = it.batches.reduce((sum, b) => sum + b.gram, 0);
      if (totalBatchGram < qtyInGramOrPcs) {
        it.batches.push({
          id: store.next++,
          gram: qtyInGramOrPcs - totalBatchGram,
          cost: it.modal || 0,
          createdAt: Date.now() - 1000,
          supplier: 'Penyesuaian Stok',
        });
        syncItem(it);
      }

      const deduction = fifoDeductAtomic(it, qtyInGramOrPcs);
      if (!deduction.success) {
        return { success: false, status: 400, error: deduction.error || 'Gagal mengurangi stok' };
      }

      const adjId = store.next++;
      store.adjustments.push({
        id: adjId,
        itemId: it.id,
        itemName: it.name,
        unit: it.unit || 'kg',
        qty: qtyInGramOrPcs,
        reason: (item.reason as AdjustmentReason) || 'lainnya',
        note: item.note || 'Pengurangan stok manual',
        hppValue: deduction.hpp,
        used: deduction.used,
        t: Date.now(),
        by: 'owner',
      });
      syncItem(it);
    }
    return { success: true };
  });

  if (!result.success) {
    return res.status(result.status || 500).json({ error: result.error });
  }

  res.json({ success: true, store });
});

// 16. Secure Backup & Restore with deep structure validation
app.post('/api/backup/restore', (req, res) => {
  if (getAuthRole(req) !== 'owner') {
    return res.status(403).json({ error: 'Akses hanya untuk pemilik' });
  }

  const { data } = req.body;
  const validation = validateBackupStructure(data);
  if (!validation.valid) {
    return res.status(400).json({ error: validation.error || 'Data cadangan tidak valid' });
  }

  const currentPinSalt = store.pinSalt;
  const currentPinHash = store.pinHash;
  const currentStaffTokens = store.staffTokens;

  const normalizedItems = data.items.map((it: Item, idx: number) => {
    const itemCopy = {
      ...it,
      unit: it.unit || (it.name.toLowerCase().includes('minyak') ? 'pcs' : 'kg'),
      batches: Array.isArray(it.batches) ? it.batches : [],
    };
    itemCopy.batches.forEach((b: Batch, bIdx: number) => {
      if (!b.createdAt) {
        b.createdAt = BASE_MIGRATION_TS + idx * 1000 + bIdx * 10;
      }
    });
    syncItem(itemCopy);
    return itemCopy;
  });

  const nextSafeId = calculateNextSafeId({
    items: normalizedItems,
    sales: Array.isArray(data.sales) ? data.sales : [],
    exp: Array.isArray(data.exp) ? data.exp : [],
    purchases: Array.isArray(data.purchases) ? data.purchases : [],
    adjustments: Array.isArray(data.adjustments) ? data.adjustments : [],
    allowances: Array.isArray(data.allowances) ? data.allowances : [],
    next: data.next,
  });

  const result = executeTransactionalMutation(() => {
    store = {
      items: normalizedItems,
      sales: Array.isArray(data.sales) ? data.sales : [],
      exp: Array.isArray(data.exp) ? data.exp : [],
      purchases: Array.isArray(data.purchases) ? data.purchases : [],
      adjustments: Array.isArray(data.adjustments)
        ? data.adjustments.map((a: any) => ({
            ...a,
            hppValue: a.hppValue != null ? a.hppValue : (a.hppLoss || 0),
            used: Array.isArray(a.used) ? a.used : [],
          }))
        : [],
      allowances: Array.isArray(data.allowances) ? data.allowances : [],
      staffTokens: currentStaffTokens,
      next: nextSafeId,
      pinSalt: currentPinSalt,
      pinHash: currentPinHash,
      schemaVersion: CURRENT_SCHEMA_VERSION,
    };
    return { success: true };
  });

  if (!result.success) {
    return res.status(result.status || 500).json({ error: result.error });
  }

  res.json({ success: true, store });
});

// Reset (Owner Only) - Retains Owner PIN and Staff Tokens safely
app.post('/api/reset', (req, res) => {
  if (getAuthRole(req) !== 'owner') {
    return res.status(403).json({ error: 'Akses hanya untuk pemilik' });
  }
  const currentPinSalt = store.pinSalt;
  const currentPinHash = store.pinHash;
  const currentTokens = store.staffTokens;

  const result = executeTransactionalMutation(() => {
    store = getInitialStore();
    store.pinSalt = currentPinSalt;
    store.pinHash = currentPinHash;
    store.staffTokens = currentTokens;
    return { success: true };
  });

  if (!result.success) {
    return res.status(result.status || 500).json({ error: result.error });
  }

  res.json({ success: true, store });
});

async function startServer() {
  if (!isProd) {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
    app.get('*', async (req, res, next) => {
      if (req.originalUrl.startsWith('/api')) {
        return next();
      }
      try {
        let template = fs.readFileSync(path.resolve(__dirname, 'index.html'), 'utf-8');
        template = await vite.transformIndexHtml(req.originalUrl, template);
        res.status(200).set({ 'Content-Type': 'text/html' }).end(template);
      } catch (e) {
        next(e);
      }
    });
  } else {
    app.use(express.static(path.resolve(__dirname, 'dist')));
    app.get('*', (req, res, next) => {
      if (req.originalUrl.startsWith('/api')) {
        return next();
      }
      res.sendFile(path.resolve(__dirname, 'dist', 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server listening on http://0.0.0.0:${PORT}`);
  });
}

startServer();
