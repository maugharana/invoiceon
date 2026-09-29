import { useEffect, useState } from 'react';
import { ChevronDown, ChevronUp, ChevronLeft, ChevronRight, X, AlertCircle, CheckCircle, AlertTriangle } from 'lucide-react';

export const InvoiceOnLogo = ({ className = "w-8 h-8 mr-2 shrink-0" }) => (
  <svg viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg" className={className}>
    <path d="M65 15H35C26.7157 15 20 21.7157 20 30V70C20 78.2843 26.7157 85 35 85H65C73.2843 85 80 78.2843 80 70V30L65 15Z" stroke="#800020" strokeWidth="6" strokeLinecap="round" strokeLinejoin="round"/>
    <path d="M65 15V30H80" stroke="#800020" strokeWidth="6" strokeLinecap="round" strokeLinejoin="round"/>
    <path d="M35 35H48" stroke="#800020" strokeWidth="5" strokeLinecap="round"/>
    <path d="M35 49H65" stroke="#f9a8d4" strokeWidth="5" strokeLinecap="round"/>
    <path d="M35 63H55" stroke="#f9a8d4" strokeWidth="5" strokeLinecap="round"/>
    <path d="M70 60C67.7909 60 66 61.7909 66 64C66 66.2091 67.7909 68 70 68C72.2091 68 74 69.7909 74 72C74 74.2091 72.2091 76 70 76C67.7909 76 66 74.2091 66 72M70 56V80" stroke="#800020" strokeWidth="5" strokeLinecap="round"/>
  </svg>
);

export const Card = ({ children, className = '' }) => (
  <div className={`bg-white rounded-xl border border-gray-200 shadow-sm p-6 ${className}`}>{children}</div>
);

export const NavItem = ({ icon: Icon, label, active = false, onClick }) => (
  <button onClick={onClick} className={`w-full flex items-center px-4 py-2.5 rounded-lg text-sm font-semibold transition-colors ${active ? 'bg-[#FDF5F6] text-[#800020]' : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'}`}>
    <Icon className={`w-5 h-5 mr-3 ${active ? 'text-[#800020]' : 'text-gray-400'}`} />{label}
  </button>
);

export const StatusBadge = ({ status }) => {
  const safeStatus = typeof status === 'string' ? status.toLowerCase() : 'draft';
  const styles = {
    paid: 'bg-emerald-50 text-emerald-600 border-emerald-100',
    completed: 'bg-emerald-50 text-emerald-600 border-emerald-100',
    active: 'bg-emerald-50 text-emerald-600 border-emerald-100',
    partial: 'bg-yellow-100/80 text-yellow-700 border-transparent',
    sent: 'bg-[#FDF5F6] text-[#800020] border-transparent',
    overdue: 'bg-red-500 text-white border-transparent',
    failed: 'bg-red-50 text-red-600 border-red-100',
    draft: 'bg-gray-100 text-gray-500 border-gray-200'
  };
  return <span className={`px-2.5 py-0.5 rounded text-[11px] font-bold lowercase tracking-wide ${styles[safeStatus] || styles.draft}`}>{safeStatus}</span>;
};

export const SortableHeader = ({ label, sortKey, currentSort, requestSort, align="left", className="" }) => (
  <th className={`py-4 px-6 cursor-pointer hover:bg-gray-100/50 transition-colors select-none ${align === 'right' ? 'text-right' : 'text-left'} ${className}`} onClick={() => requestSort(sortKey)}>
    <div className={`flex items-center space-x-1 ${align === 'right' ? 'justify-end' : ''}`}>
      <span>{label}</span>
      {currentSort?.key === sortKey ? (currentSort.direction === 'ascending' ? <ChevronUp className="w-3 h-3 text-[#800020]"/> : <ChevronDown className="w-3 h-3 text-[#800020]"/>) : <ChevronDown className="w-3 h-3 text-gray-300 opacity-0 group-hover:opacity-100"/>}
    </div>
  </th>
);

export const PaginationControls = ({ currentPage, totalPages, setCurrentPage, totalItems }) => {
  if (totalPages <= 1) return null;
  return (
    <div className="flex items-center justify-between px-6 py-4 border-t border-gray-100 bg-gray-50/30">
      <p className="text-sm text-gray-500 font-medium">Showing <span className="font-bold text-gray-900">{totalItems === 0 ? 0 : (currentPage - 1) * 10 + 1}</span> to <span className="font-bold text-gray-900">{Math.min(currentPage * 10, totalItems)}</span> of <span className="font-bold text-gray-900">{totalItems}</span> results</p>
      <div className="flex space-x-2">
        <button onClick={() => setCurrentPage(p => Math.max(1, p - 1))} disabled={currentPage === 1} className="p-2 border border-gray-200 rounded-md bg-white hover:bg-gray-50 disabled:opacity-50"><ChevronLeft className="w-4 h-4"/></button>
        <button onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))} disabled={currentPage === totalPages} className="p-2 border border-gray-200 rounded-md bg-white hover:bg-gray-50 disabled:opacity-50"><ChevronRight className="w-4 h-4"/></button>
      </div>
    </div>
  );
};

export const DateRangeSelect = ({ value, onChange }) => (
  <div className="relative w-full sm:w-40">
    <select value={value} onChange={(e) => onChange(e.target.value)} className="w-full px-4 py-2 text-sm bg-white border border-gray-200 rounded-lg appearance-none focus:outline-none focus:border-[#800020]">
      <option value="all">All Time</option>
      <option value="thisMonth">This Month</option>
      <option value="lastMonth">Last Month</option>
      <option value="thisYear">This Year</option>
    </select>
    <ChevronDown className="absolute right-3 top-2.5 w-4 h-4 text-gray-400 pointer-events-none" />
  </div>
);

export const Toast = ({ message, type, onClose }) => {
  useEffect(() => {
    const timer = setTimeout(onClose, 3000);
    return () => clearTimeout(timer);
  }, [onClose]);
  return (
    <div className={`fixed bottom-8 right-8 flex items-center px-5 py-3.5 rounded-xl shadow-2xl z-[200] animate-in slide-in-from-bottom-5 ${type === 'error' ? 'bg-red-600' : 'bg-gray-900'} text-white`}>
      {type === 'error' ? <AlertCircle className="w-5 h-5 mr-3"/> : <CheckCircle className="w-5 h-5 mr-3 text-[#f9a8d4]"/>}
      <span className="font-semibold text-sm">{message}</span>
      <button onClick={onClose} className="ml-auto pl-4 text-gray-300 hover:text-white"><X className="w-4 h-4" /></button>
    </div>
  );
};

export const ConfirmModal = ({ isOpen, onClose, onConfirm, title, message, confirmText = "Delete", itemToDelete = "" }) => {
  if (!isOpen) return null;
  const [confirmInput, setConfirmInput] = useState("");
  const isConfirmationRequired = itemToDelete && itemToDelete.length > 0;
  const canConfirm = !isConfirmationRequired || confirmInput === itemToDelete;

  return (
    <div className="fixed inset-0 z-[150] flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
      <Card className="w-full max-w-md p-8 animate-in zoom-in-95">
        <div className="flex items-center justify-center w-12 h-12 rounded-full bg-red-100 mb-6"><AlertTriangle className="w-6 h-6 text-red-600" /></div>
        <h3 className="text-xl font-bold text-gray-900 mb-2">{title}</h3>
        <p className="text-sm text-gray-500 mb-6">{message}</p>
        {isConfirmationRequired && (
          <div className="mb-6">
            <p className="text-xs text-gray-500 mb-2">To confirm, type "<span className="font-bold text-gray-700">{itemToDelete}</span>" in the box below:</p>
            <input type="text" value={confirmInput} onChange={(e) => setConfirmInput(e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:border-red-500" />
          </div>
        )}
        <div className="flex justify-end gap-3">
          <button onClick={onClose} className="px-5 py-2.5 text-sm font-medium border border-gray-300 rounded-md hover:bg-gray-50">Cancel</button>
          <button onClick={() => { if(canConfirm) { onConfirm(); onClose(); } }} disabled={!canConfirm} className="px-5 py-2.5 text-sm font-medium text-white bg-red-600 rounded-md hover:bg-red-700 disabled:bg-red-300 disabled:cursor-not-allowed">{confirmText}</button>
        </div>
      </Card>
    </div>
  );
};