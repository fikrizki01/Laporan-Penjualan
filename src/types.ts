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

export interface Sale {
  id: number;
  itemId: number;
  name: string;
  nominal: number;
  gram: number; // gram jika unit='kg', jumlah pcs jika unit='pcs'
  hpp: number; // HPP permanen saat transaksi
  unit?: ItemUnit;
  used: UsedBatch[];
  t: number;
  by: 'owner' | 'karyawan';
  sellingPrice?: number; // harga jual saat transaksi
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

export type AdjustmentReason =
  | 'pecah'
  | 'rusak'
  | 'hilang'
  | 'koreksi_tambah'
  | 'koreksi_kurang'
  | 'lainnya';

export interface StockAdjustment {
  id: number;
  itemId: number;
  itemName: string;
  unit: ItemUnit;
  qty: number; // negatif = pengurangan, positif = penambahan
  piecesCount?: number;
  reason: AdjustmentReason;
  note: string;
  hppValue: number; // nilai HPP dari penyesuaian (kerugian jika susut, penambahan aset jika tambah)
  used: UsedBatch[]; // wajib: batch asal untuk pengurangan, atau [] untuk penambahan
  batchId?: number; // batchId baru jika merupakan penambahan stok
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
  gram: number; // gram jika unit='kg', pcs jika unit='pcs'
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
  tokenHash: string; // token asli hanya diberikan sekali saat dibuat, server simpan hash
  createdAt: number;
  revoked?: boolean;
}

export interface AppData {
  items: Item[];
  sales: Sale[];
  exp: Expense[];
  purchases: Purchase[];
  adjustments: StockAdjustment[];
  allowances: StaffAllowance[];
  next: number;
  schemaVersion: number;
}

export type TabType = 'jual' | 'keluar' | 'barang' | 'riwayat';
export type PeriodType = 'hari' | 'bulan' | 'semua';
