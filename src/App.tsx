import React, { useState, useEffect, useCallback, useRef } from 'react';
import { AppData, Item, Sale, Expense, TabType, Purchase, StockAdjustment, AdjustmentReason, StaffAllowance, StaffToken } from './types';
import { loadData, saveData, initialData } from './utils/storage';
import { sortItemsFixedOrder } from './utils/formatters';
import { Header } from './components/Header';
import { Navigation } from './components/Navigation';
import { TabJual } from './components/TabJual';
import { TabKeluar } from './components/TabKeluar';
import { TabBarang } from './components/TabBarang';
import { TabRiwayat } from './components/TabRiwayat';
import { BackupModal } from './components/BackupModal';
import { ShareStaffModal } from './components/ShareStaffModal';
import { PinModal } from './components/PinModal';
import { EggAdjustmentModal } from './components/EggAdjustmentModal';

export default function App() {
  // Capture URL staff token if opened via staff QR / invite link
  // Exchanges it with server to establish session and immediately cleans the URL
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search);
      const urlStaffToken = params.get('staffToken');
      if (urlStaffToken) {
        fetch('/api/staff-token/exchange', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token: urlStaffToken }),
        })
          .then((res) => res.json())
          .then((json) => {
            if (json.success) {
              localStorage.setItem('kasir_staff_token', urlStaffToken);
              setRole('karyawan');
              fetchFromServer();
            }
          })
          .catch(() => {});

        // Clean URL parameter immediately without page reload
        window.history.replaceState({}, '', window.location.pathname);
      }
    }
  }, []);

  // Session Token Based Role System
  const [role, setRole] = useState<'owner' | 'karyawan'>(() => {
    if (typeof window !== 'undefined') {
      const ownerToken = localStorage.getItem('kasir_owner_session_token');
      if (ownerToken && ownerToken !== 'undefined') return 'owner';
    }
    return 'karyawan';
  });

  const [data, setData] = useState<AppData>(() => loadData());
  const [tab, setTab] = useState<TabType>('jual');
  const [selectedItemId, setSelectedItemId] = useState<number | null>(() => {
    const loaded = loadData();
    return loaded.items[0] ? loaded.items[0].id : null;
  });
  const [theme, setTheme] = useState<'light' | 'dark'>(() => {
    if (typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches) {
      return 'dark';
    }
    return 'light';
  });

  const [isBackupOpen, setIsBackupOpen] = useState(false);
  const [isShareStaffOpen, setIsShareStaffOpen] = useState(false);
  const [isPinModalOpen, setIsPinModalOpen] = useState(false);
  const [isEggModalOpen, setIsEggModalOpen] = useState(false);
  const [eggModalDefaultItemId, setEggModalDefaultItemId] = useState<number | null>(null);

  const [syncMsg, setSyncMsg] = useState('Menghubungkan ke server...');
  const isSyncingRef = useRef(false);

  // Sync theme attribute to <html> element
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
  }, [theme]);

  const toggleTheme = () => {
    setTheme((prev) => (prev === 'dark' ? 'light' : 'dark'));
  };

  const getAuthHeaders = (): Record<string, string> => {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (typeof window !== 'undefined') {
      const ownerToken = localStorage.getItem('kasir_owner_session_token');
      if (ownerToken && ownerToken !== 'undefined') {
        headers['x-owner-token'] = ownerToken;
      } else {
        const staffToken = localStorage.getItem('kasir_staff_token');
        if (staffToken && staffToken !== 'undefined') {
          headers['x-staff-token'] = staffToken;
        }
      }
    }
    return headers;
  };

  // Fetch from server API with polling for multi-device sync
  const fetchFromServer = useCallback(async () => {
    if (isSyncingRef.current) return;
    isSyncingRef.current = true;
    try {
      const headers = getAuthHeaders();
      const res = await fetch('/api/data', { headers });
      if (res.ok) {
        const json = await res.json();
        if (json && Array.isArray(json.items)) {
          if (json.role === 'owner') {
            setRole('owner');
            const fullData: AppData = {
              items: sortItemsFixedOrder(json.items),
              sales: json.sales || [],
              exp: json.exp || [],
              purchases: json.purchases || [],
              adjustments: json.adjustments || [],
              allowances: json.allowances || [],
              next: json.next || 1,
              schemaVersion: json.schemaVersion || 3,
            };
            setData(fullData);
            saveData(fullData);
          } else {
            // Staff / Cashier view: server returned safe public items
            if (typeof window !== 'undefined') {
              localStorage.removeItem('kasir_owner_session_token');
            }
            setRole('karyawan');
            setTab('jual');
            setData((prev) => ({
              ...prev,
              items: sortItemsFixedOrder(json.items),
              sales: [],
              exp: [],
              purchases: [],
              adjustments: [],
              allowances: [],
            }));
          }
          setSyncMsg('Tersambung ke server');
        }
      } else {
        setSyncMsg('Sesi kasir perlu diperbarui');
      }
    } catch {
      setSyncMsg('Koneksi terputus');
    } finally {
      isSyncingRef.current = false;
    }
  }, []);

  useEffect(() => {
    fetchFromServer();
    // Poll every 3.5 seconds so employee and owner devices stay synchronized
    const interval = setInterval(fetchFromServer, 3500);
    return () => clearInterval(interval);
  }, [fetchFromServer]);

  // Ensure an item is selected
  useEffect(() => {
    if (data.items.length > 0) {
      if (!selectedItemId || !data.items.some((i) => i.id === selectedItemId)) {
        setSelectedItemId(data.items[0].id);
      }
    } else {
      setSelectedItemId(null);
    }
  }, [data.items, selectedItemId]);

  // Complete Sale (Server-First, Atomic, NO Local Fallback)
  const handleCompleteSale = async (saleData: {
    itemId: number;
    nominal: number;
    name?: string;
    gram?: number;
  }) => {
    try {
      const headers = getAuthHeaders();
      const res = await fetch('/api/sales', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          itemId: saleData.itemId,
          nominal: saleData.nominal,
        }),
      });

      if (res.ok) {
        const json = await res.json();
        if (json.store) {
          setData(json.store);
          saveData(json.store);
        } else if (json.item) {
          // Employee: update local item stock safely
          setData((prev) => {
            const updatedItems = prev.items.map((it) =>
              it.id === json.item.id ? { ...it, gram: json.item.gram } : it
            );
            return { ...prev, items: updatedItems };
          });
        }
        setSyncMsg('Penjualan tersimpan');
        return;
      } else {
        const errJson = await res.json().catch(() => null);
        alert(errJson?.error || 'Gagal memproses penjualan. Silakan coba lagi.');
        return;
      }
    } catch {
      alert('Gagal terhubung ke server. Penjualan belum tercatat. Periksa koneksi internet Anda!');
    }
  };

  // Kulakan / Pembelian Stok (Owner Only, Server-First)
  const handleAddPurchase = async (params: {
    itemId: number;
    supplier: string;
    isIkat: boolean;
    ikatCount?: number;
    kgPerIkat?: number;
    qty?: number;
    costPerUnit: number;
    note?: string;
  }) => {
    try {
      const headers = getAuthHeaders();
      const res = await fetch('/api/purchases', {
        method: 'POST',
        headers,
        body: JSON.stringify(params),
      });

      if (res.ok) {
        const json = await res.json();
        if (json.store) {
          setData(json.store);
          saveData(json.store);
          return;
        }
      } else {
        const err = await res.json().catch(() => null);
        alert(err?.error || 'Gagal menyimpan pembelian');
      }
    } catch {
      alert('Koneksi server terputus saat menyimpan pembelian.');
    }
  };

  // Cancel Purchase
  const handleCancelPurchase = async (purchaseId: number): Promise<{ success: boolean; error?: string }> => {
    try {
      const headers = getAuthHeaders();
      const res = await fetch('/api/cancel-purchase', {
        method: 'POST',
        headers,
        body: JSON.stringify({ purchaseId }),
      });
      if (res.ok) {
        const json = await res.json();
        if (json.store) {
          setData(json.store);
          saveData(json.store);
          return { success: true };
        }
      } else {
        const err = await res.json().catch(() => null);
        return { success: false, error: err?.error || 'Gagal membatalkan pembelian' };
      }
    } catch {
      return { success: false, error: 'Koneksi server terputus.' };
    }
    return { success: false, error: 'Terjadi kesalahan sistem' };
  };

  // Delete Purchase Permanently
  const handleDeletePurchase = async (purchaseId: number): Promise<{ success: boolean; error?: string }> => {
    try {
      const headers = getAuthHeaders();
      const res = await fetch('/api/delete-purchase', {
        method: 'POST',
        headers,
        body: JSON.stringify({ purchaseId }),
      });
      if (res.ok) {
        const json = await res.json();
        if (json.store) {
          setData(json.store);
          saveData(json.store);
          return { success: true };
        }
      } else {
        const err = await res.json().catch(() => null);
        return { success: false, error: err?.error || 'Gagal menghapus pembelian' };
      }
    } catch {
      return { success: false, error: 'Koneksi server terputus.' };
    }
    return { success: false, error: 'Terjadi kesalahan sistem' };
  };

  // Cancel Stock Adjustment (Telur Pecah)
  const handleCancelAdjustment = async (adjustmentId: number): Promise<{ success: boolean; error?: string }> => {
    try {
      const headers = getAuthHeaders();
      const res = await fetch('/api/cancel-adjustment', {
        method: 'POST',
        headers,
        body: JSON.stringify({ adjustmentId }),
      });
      if (res.ok) {
        const json = await res.json();
        if (json.store) {
          setData(json.store);
          saveData(json.store);
          return { success: true };
        }
      } else {
        const err = await res.json().catch(() => null);
        return { success: false, error: err?.error || 'Gagal membatalkan penyesuaian' };
      }
    } catch {
      return { success: false, error: 'Koneksi server terputus.' };
    }
    return { success: false, error: 'Terjadi kesalahan sistem' };
  };

  // Delete Stock Adjustment Permanently (Telur Pecah)
  const handleDeleteAdjustment = async (adjustmentId: number): Promise<{ success: boolean; error?: string }> => {
    try {
      const headers = getAuthHeaders();
      const res = await fetch('/api/delete-adjustment', {
        method: 'POST',
        headers,
        body: JSON.stringify({ adjustmentId }),
      });
      if (res.ok) {
        const json = await res.json();
        if (json.store) {
          setData(json.store);
          saveData(json.store);
          return { success: true };
        }
      } else {
        const err = await res.json().catch(() => null);
        return { success: false, error: err?.error || 'Gagal menghapus penyesuaian' };
      }
    } catch {
      return { success: false, error: 'Koneksi server terputus.' };
    }
    return { success: false, error: 'Terjadi kesalahan sistem' };
  };

  // Stock Adjustment (Telur Pecah, Rusak, Susut, Koreksi)
  const handleStockAdjustment = async (params: {
    itemId: number;
    piecesCount?: number;
    rawQty?: number;
    reason: AdjustmentReason;
    note: string;
  }) => {
    try {
      const headers = getAuthHeaders();
      const res = await fetch('/api/adjustments', {
        method: 'POST',
        headers,
        body: JSON.stringify(params),
      });

      if (res.ok) {
        const json = await res.json();
        if (json.store) {
          setData(json.store);
          saveData(json.store);
        } else {
          fetchFromServer();
        }
        alert(
          `Penyesuaian stok tercatat! Stok berkurang ${
            params.piecesCount ? params.piecesCount + ' butir' : (params.rawQty || 0) + ' kg'
          }. Kerugian modal dibukukan secara presisi.`
        );
        return;
      } else {
        const err = await res.json().catch(() => null);
        alert(err?.error || 'Gagal mencatat penyesuaian stok');
      }
    } catch {
      alert('Gagal terhubung ke server.');
    }
  };

  // Staff Allowance (Jatah Karyawan - Internal Stock Consumption)
  const handleAddStaffAllowance = (params: {
    itemId: number;
    amount: number;
    note: string;
    staffName: string;
  }): { success: boolean; error?: string } => {
    const headers = getAuthHeaders();
    fetch('/api/allowances', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        itemId: params.itemId,
        gram: params.amount,
        staffName: params.staffName,
        note: params.note,
      }),
    })
      .then(async (res) => {
        if (res.ok) {
          const json = await res.json();
          if (json.store) {
            setData(json.store);
            saveData(json.store);
          }
        } else {
          const err = await res.json().catch(() => null);
          alert(err?.error || 'Gagal memotong stok jatah');
        }
      })
      .catch(() => {
        alert('Koneksi server terputus.');
      });

    return { success: true };
  };

  // Cancel Allowance
  const handleCancelAllowance = async (allowanceId: number): Promise<{ success: boolean; error?: string }> => {
    try {
      const headers = getAuthHeaders();
      const res = await fetch('/api/cancel-allowance', {
        method: 'POST',
        headers,
        body: JSON.stringify({ allowanceId }),
      });
      if (res.ok) {
        const json = await res.json();
        if (json.store) {
          setData(json.store);
          saveData(json.store);
          return { success: true };
        }
      } else {
        const err = await res.json().catch(() => null);
        return { success: false, error: err?.error || 'Gagal membatalkan jatah' };
      }
    } catch {
      return { success: false, error: 'Koneksi server terputus.' };
    }
    return { success: false, error: 'Terjadi kesalahan sistem' };
  };

  // Delete Allowance Permanently
  const handleDeleteAllowance = async (allowanceId: number): Promise<{ success: boolean; error?: string }> => {
    try {
      const headers = getAuthHeaders();
      const res = await fetch('/api/delete-allowance', {
        method: 'POST',
        headers,
        body: JSON.stringify({ allowanceId }),
      });
      if (res.ok) {
        const json = await res.json();
        if (json.store) {
          setData(json.store);
          saveData(json.store);
          return { success: true };
        }
      } else {
        const err = await res.json().catch(() => null);
        return { success: false, error: err?.error || 'Gagal menghapus jatah' };
      }
    } catch {
      return { success: false, error: 'Koneksi server terputus.' };
    }
    return { success: false, error: 'Terjadi kesalahan sistem' };
  };

  // Add Operational Cash Expense
  const handleAddExpense = async (expenseData: Omit<Expense, 'id'>) => {
    try {
      const headers = getAuthHeaders();
      const res = await fetch('/api/expenses', {
        method: 'POST',
        headers,
        body: JSON.stringify(expenseData),
      });

      if (res.ok) {
        const json = await res.json();
        if (json.store) {
          setData(json.store);
          saveData(json.store);
          return;
        }
      }
    } catch {}
  };

  // Cancel Expense
  const handleCancelExpense = async (expenseId: number): Promise<{ success: boolean; error?: string }> => {
    try {
      const headers = getAuthHeaders();
      const res = await fetch('/api/cancel-expense', {
        method: 'POST',
        headers,
        body: JSON.stringify({ expenseId }),
      });
      if (res.ok) {
        const json = await res.json();
        if (json.store) {
          setData(json.store);
          saveData(json.store);
          return { success: true };
        }
      } else {
        const err = await res.json().catch(() => null);
        return { success: false, error: err?.error || 'Gagal membatalkan pengeluaran' };
      }
    } catch {
      return { success: false, error: 'Koneksi server terputus.' };
    }
    return { success: false, error: 'Terjadi kesalahan sistem' };
  };

  // Delete Expense Permanently
  const handleDeleteExpense = async (expenseId: number): Promise<{ success: boolean; error?: string }> => {
    try {
      const headers = getAuthHeaders();
      const res = await fetch('/api/delete-expense', {
        method: 'POST',
        headers,
        body: JSON.stringify({ expenseId }),
      });
      if (res.ok) {
        const json = await res.json();
        if (json.store) {
          setData(json.store);
          saveData(json.store);
          return { success: true };
        }
      } else {
        const err = await res.json().catch(() => null);
        return { success: false, error: err?.error || 'Gagal menghapus pengeluaran' };
      }
    } catch {
      return { success: false, error: 'Koneksi server terputus.' };
    }
    return { success: false, error: 'Terjadi kesalahan sistem' };
  };

  // Item Management (Add)
  const handleAddItem = async (itemData: {
    name: string;
    price: number;
    modal: number;
    initialStockKg: number;
    unit?: 'kg' | 'pcs';
  }) => {
    try {
      const headers = getAuthHeaders();
      const res = await fetch('/api/items', {
        method: 'POST',
        headers,
        body: JSON.stringify({ action: 'create', item: itemData }),
      });
      if (res.ok) {
        const json = await res.json();
        if (json.store) {
          setData(json.store);
          saveData(json.store);
          return;
        }
      }
    } catch {}
  };

  // Update Item
  const handleUpdateItem = async (updatedItem: Item) => {
    try {
      const headers = getAuthHeaders();
      const res = await fetch('/api/items', {
        method: 'POST',
        headers,
        body: JSON.stringify({ action: 'update', item: updatedItem }),
      });
      if (res.ok) {
        const json = await res.json();
        if (json.store) {
          setData(json.store);
          saveData(json.store);
          return;
        }
      }
    } catch {}
  };

  // Reorder Item
  const handleMoveItem = async (itemIdOrFromIndex: number, direction: -1 | 1) => {
    // Instant optimistic update in UI
    setData((prev) => {
      const activeList = prev.items.filter((i) => !i.archived);
      let targetId = itemIdOrFromIndex;
      if (
        !prev.items.some((i) => i.id === itemIdOrFromIndex) &&
        itemIdOrFromIndex >= 0 &&
        itemIdOrFromIndex < activeList.length
      ) {
        targetId = activeList[itemIdOrFromIndex].id;
      }
      const activeIdx = activeList.findIndex((i) => i.id === targetId);
      if (activeIdx === -1) return prev;
      const targetActiveIdx = activeIdx + direction;
      if (targetActiveIdx < 0 || targetActiveIdx >= activeList.length) return prev;

      const neighbor = activeList[targetActiveIdx];
      const realA = prev.items.findIndex((i) => i.id === targetId);
      const realB = prev.items.findIndex((i) => i.id === neighbor.id);
      if (realA === -1 || realB === -1) return prev;

      const newItems = [...prev.items];
      const [moved] = newItems.splice(realA, 1);
      newItems.splice(realB, 0, moved);
      return { ...prev, items: newItems };
    });

    try {
      const headers = getAuthHeaders();
      const res = await fetch('/api/items', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          action: 'reorder',
          itemId: itemIdOrFromIndex,
          fromIndex: itemIdOrFromIndex,
          direction,
        }),
      });
      if (res.ok) {
        const json = await res.json();
        if (json.store) {
          setData(json.store);
          saveData(json.store);
          return;
        }
      }
    } catch {}
  };

  // Delete Item (Soft-delete / Archival on server)
  const handleDeleteItem = async (id: number) => {
    try {
      const headers = getAuthHeaders();
      const res = await fetch('/api/items', {
        method: 'POST',
        headers,
        body: JSON.stringify({ action: 'delete', item: { id } }),
      });
      if (res.ok) {
        const json = await res.json();
        if (json.store) {
          setData(json.store);
          saveData(json.store);
          return;
        }
      }
    } catch {}
  };

  // Add Manual Stock
  const handleAddManualStock = async (
    itemId: number,
    addedQty: number,
    cost?: number
  ): Promise<{ success: boolean; error?: string }> => {
    try {
      const headers = getAuthHeaders();
      const res = await fetch('/api/items', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          action: 'add-stock',
          item: { id: itemId, addedKg: addedQty, cost },
        }),
      });
      if (res.ok) {
        const json = await res.json();
        if (json.store) {
          setData(json.store);
          saveData(json.store);
          return { success: true };
        }
      } else {
        const err = await res.json().catch(() => null);
        return { success: false, error: err?.error || 'Gagal menambah stok' };
      }
    } catch {
      return { success: false, error: 'Koneksi server terputus.' };
    }
    return { success: false, error: 'Terjadi kesalahan sistem' };
  };

  // Reduce Manual Stock
  const handleReduceManualStock = async (
    itemId: number,
    reducedQty: number
  ): Promise<{ success: boolean; error?: string }> => {
    try {
      const headers = getAuthHeaders();
      const res = await fetch('/api/items', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          action: 'reduce-stock',
          item: { id: itemId, reducedQty },
        }),
      });
      if (res.ok) {
        const json = await res.json();
        if (json.store) {
          setData(json.store);
          saveData(json.store);
          return { success: true };
        }
      } else {
        const err = await res.json().catch(() => null);
        return { success: false, error: err?.error || 'Gagal mengurangi stok' };
      }
    } catch {
      return { success: false, error: 'Koneksi server terputus.' };
    }
    return { success: false, error: 'Terjadi kesalahan sistem' };
  };

  // Cancel Sale (Owner Only)
  const handleCancelSale = async (saleId: number): Promise<{ success: boolean; error?: string }> => {
    try {
      const headers = getAuthHeaders();
      const res = await fetch('/api/cancel-sale', {
        method: 'POST',
        headers,
        body: JSON.stringify({ saleId }),
      });
      if (res.ok) {
        const json = await res.json();
        if (json.store) {
          setData(json.store);
          saveData(json.store);
          return { success: true };
        }
      } else {
        const err = await res.json().catch(() => ({}));
        if (res.status === 403) {
          setIsPinModalOpen(true);
        }
        return { success: false, error: err.error || 'Gagal membatalkan transaksi' };
      }
    } catch {
      return { success: false, error: 'Koneksi ke server terputus' };
    }
    return { success: false, error: 'Terjadi kesalahan sistem' };
  };

  // Delete Sale Permanently (Owner Only)
  const handleDeleteSale = async (saleId: number): Promise<{ success: boolean; error?: string }> => {
    try {
      const headers = getAuthHeaders();
      const res = await fetch('/api/delete-sale', {
        method: 'POST',
        headers,
        body: JSON.stringify({ saleId }),
      });
      if (res.ok) {
        const json = await res.json();
        if (json.store) {
          setData(json.store);
          saveData(json.store);
          return { success: true };
        }
      } else {
        const err = await res.json().catch(() => ({}));
        if (res.status === 403) {
          setIsPinModalOpen(true);
        }
        return { success: false, error: err.error || 'Gagal menghapus riwayat penjualan' };
      }
    } catch {
      return { success: false, error: 'Koneksi ke server terputus' };
    }
    return { success: false, error: 'Terjadi kesalahan sistem' };
  };

  // Rate-Limited PIN Verification & Session Token Generation
  const handleUnlockPin = async (
    enteredPin: string
  ): Promise<{ success: boolean; error?: string }> => {
    try {
      const res = await fetch('/api/verify-pin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pin: enteredPin }),
      });
      const json = await res.json();
      if (res.ok && json.success) {
        if (typeof window !== 'undefined') {
          localStorage.setItem('kasir_owner_session_token', json.token);
        }
        setRole('owner');
        setIsPinModalOpen(false);
        setTimeout(() => fetchFromServer(), 50);
        return { success: true };
      }
      return { success: false, error: json.error || 'PIN salah' };
    } catch {
      return { success: false, error: 'Gagal terhubung ke server' };
    }
  };

  // Lock to Staff Mode
  const handleLockToStaff = () => {
    if (typeof window !== 'undefined') {
      const token = localStorage.getItem('kasir_owner_session_token');
      if (token) {
        fetch('/api/logout', {
          method: 'POST',
          headers: { 'x-owner-token': token },
        }).catch(() => {});
        localStorage.removeItem('kasir_owner_session_token');
      }
    }
    setRole('karyawan');
    setTab('jual');
    setTimeout(() => fetchFromServer(), 50);
  };

  // Change PIN
  const handleChangePin = async (newPin: string): Promise<boolean> => {
    try {
      const headers = getAuthHeaders();
      const res = await fetch('/api/change-pin', {
        method: 'POST',
        headers,
        body: JSON.stringify({ newPin }),
      });
      if (res.ok) {
        const json = await res.json();
        if (json.token && typeof window !== 'undefined') {
          localStorage.setItem('kasir_owner_session_token', json.token);
        }
        return true;
      }
    } catch {}
    return false;
  };

  // Staff Token Management
  const handleCreateStaffToken = async (
    label: string
  ): Promise<{ token: string; label: string } | null> => {
    try {
      const headers = getAuthHeaders();
      const res = await fetch('/api/staff-token/create', {
        method: 'POST',
        headers,
        body: JSON.stringify({ label }),
      });
      if (res.ok) {
        const json = await res.json();
        if (json.staffToken) {
          return {
            token: json.staffToken.token,
            label: json.staffToken.label,
          };
        }
      }
    } catch {}
    return null;
  };

  const handleRestoreData = (restored: AppData) => {
    const headers = getAuthHeaders();
    fetch('/api/backup/restore', {
      method: 'POST',
      headers,
      body: JSON.stringify({ data: restored }),
    })
      .then((res) => res.json())
      .then((json) => {
        if (json.store) {
          setData(json.store);
          saveData(json.store);
        }
      })
      .catch(() => {});
  };

  const handleResetDemo = () => {
    const headers = getAuthHeaders();
    fetch('/api/reset', { method: 'POST', headers })
      .then((res) => res.json())
      .then((json) => {
        if (json.store) {
          setData(json.store);
          saveData(json.store);
        }
      })
      .catch(() => {});
  };

  const handleOpenEggModal = (itemId?: number) => {
    setEggModalDefaultItemId(itemId || null);
    setIsEggModalOpen(true);
  };

  return (
    <div className="min-h-screen bg-[var(--bg)] text-[var(--tx)] flex flex-col font-sans transition-colors duration-200">
      {/* Header */}
      <Header
        role={role}
        theme={theme}
        toggleTheme={toggleTheme}
        onToggleTheme={toggleTheme}
        syncMsg={syncMsg}
        onOpenBackup={() => setIsBackupOpen(true)}
        onOpenShareStaff={() => setIsShareStaffOpen(true)}
        onOpenPinUnlock={() => setIsPinModalOpen(true)}
        onSwitchToStaffView={handleLockToStaff}
      />

      {/* Navigation: Only visible for Owner! Hidden for Employee */}
      {role === 'owner' ? (
        <Navigation currentTab={tab} setTab={setTab} onTabChange={setTab} />
      ) : (
        <div className="bg-emerald-50 dark:bg-emerald-950/30 border-b border-emerald-100 dark:border-emerald-900/50 py-2 px-4 flex items-center justify-between text-xs text-[var(--ac)] font-medium">
          <div className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-[var(--ac)] animate-pulse"></span>
            <span>Mode Kasir Karyawan (Hanya Penjualan)</span>
          </div>
          <span className="text-[11px] text-[var(--mut)]">{syncMsg}</span>
        </div>
      )}

      {/* Main Tab Content */}
      <main className="flex-1 w-full max-w-xl mx-auto px-4 py-4">
        {tab === 'jual' && (
          <TabJual
            items={data.items}
            selectedItemId={selectedItemId}
            role={role}
            onSelectItem={setSelectedItemId}
            onCompleteSale={handleCompleteSale}
            onOpenEggModal={handleOpenEggModal}
          />
        )}

        {role === 'owner' && tab === 'keluar' && (
          <TabKeluar
            items={data.items}
            purchases={data.purchases || []}
            selectedItemId={selectedItemId}
            onSelectItem={setSelectedItemId}
            onAddPurchase={handleAddPurchase}
            onAddExpense={handleAddExpense}
            onAddStaffAllowance={handleAddStaffAllowance}
            onOpenEggModal={handleOpenEggModal}
          />
        )}

        {role === 'owner' && tab === 'barang' && (
          <TabBarang
            items={data.items}
            onAddItem={handleAddItem}
            onUpdateItem={handleUpdateItem}
            onMoveItem={handleMoveItem}
            onDeleteItem={handleDeleteItem}
            onAddManualStock={handleAddManualStock}
            onReduceManualStock={handleReduceManualStock}
          />
        )}

        {role === 'owner' && tab === 'riwayat' && (
          <TabRiwayat
            items={data.items}
            sales={data.sales}
            expenses={data.exp}
            purchases={data.purchases || []}
            adjustments={data.adjustments || []}
            allowances={data.allowances || []}
            onCancelSale={handleCancelSale}
            onDeleteSale={handleDeleteSale}
            onCancelExpense={handleCancelExpense}
            onDeleteExpense={handleDeleteExpense}
            onCancelPurchase={handleCancelPurchase}
            onDeletePurchase={handleDeletePurchase}
            onCancelAdjustment={handleCancelAdjustment}
            onDeleteAdjustment={handleDeleteAdjustment}
            onCancelAllowance={handleCancelAllowance}
            onDeleteAllowance={handleDeleteAllowance}
            onResetDemo={handleResetDemo}
          />
        )}
      </main>

      {/* Modals */}
      <BackupModal
        isOpen={isBackupOpen}
        onClose={() => setIsBackupOpen(false)}
        data={data}
        onRestoreData={handleRestoreData}
        onResetDemo={handleResetDemo}
      />

      <ShareStaffModal
        isOpen={isShareStaffOpen}
        onClose={() => setIsShareStaffOpen(false)}
        onCreateStaffToken={handleCreateStaffToken}
        onChangePin={handleChangePin}
      />

      <PinModal
        isOpen={isPinModalOpen}
        onClose={() => setIsPinModalOpen(false)}
        onUnlock={handleUnlockPin}
      />

      <EggAdjustmentModal
        isOpen={isEggModalOpen}
        onClose={() => setIsEggModalOpen(false)}
        items={data.items}
        defaultItemId={eggModalDefaultItemId}
        isOwner={role === 'owner'}
        onSubmit={handleStockAdjustment}
      />
    </div>
  );
}
