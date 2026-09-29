import React from 'react';
import { TabType } from '../types';

interface NavigationProps {
  currentTab: TabType;
  setTab?: (tab: TabType) => void;
  onTabChange?: (tab: TabType) => void;
}

export const Navigation: React.FC<NavigationProps> = ({ currentTab, setTab, onTabChange }) => {
  const tabs: { key: TabType; label: string }[] = [
    { key: 'jual', label: 'Penjualan' },
    { key: 'keluar', label: 'Pengeluaran' },
    { key: 'barang', label: 'Barang' },
    { key: 'riwayat', label: 'Riwayat' },
  ];

  const handleSelectTab = (t: TabType) => {
    if (typeof setTab === 'function') {
      setTab(t);
    }
    if (typeof onTabChange === 'function') {
      onTabChange(t);
    }
  };

  return (
    <nav className="flex gap-1.5 mb-3">
      {tabs.map((tab) => {
        const isActive = currentTab === tab.key;
        return (
          <button
            key={tab.key}
            type="button"
            onClick={() => handleSelectTab(tab.key)}
            className={`flex-1 py-2.5 px-2 rounded-xl border text-[15px] font-semibold transition-all select-none active:scale-[0.98] ${
              isActive
                ? 'bg-[var(--ac)] text-[var(--acx)] border-[var(--ac)] shadow-sm'
                : 'bg-[var(--card)] text-[var(--tx)] border-[var(--bd)] hover:bg-[var(--bg)]'
            }`}
          >
            {tab.label}
          </button>
        );
      })}
    </nav>
  );
};
