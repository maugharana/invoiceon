import { useState, useMemo } from 'react';

export function useLocalStorageState(key, initialValue) {
  const [state, setState] = useState(() => {
    try {
      const item = window.localStorage.getItem(key);
      return item ? JSON.parse(item) : initialValue;
    } catch (error) {
      console.error("Local storage error:", error);
      return initialValue;
    }
  });

  const setPersistentState = (newValueOrUpdater) => {
    setState(prev => {
      const resolvedValue = typeof newValueOrUpdater === 'function' ? newValueOrUpdater(prev) : newValueOrUpdater;
      try {
        window.localStorage.setItem(key, JSON.stringify(resolvedValue));
      } catch (error) {
        console.error("Error saving to local storage", error);
      }
      return resolvedValue;
    });
  };

  return [state, setPersistentState];
}

export const useSortableData = (items, config = null) => {
  const [sortConfig, setSortConfig] = useState(config);
  
  const sortedItems = useMemo(() => {
    let sortableItems = Array.isArray(items) ? [...items] : [];
    if (sortConfig !== null) {
      sortableItems.sort((a, b) => {
        const valA = a[sortConfig.key] || '';
        const valB = b[sortConfig.key] || '';
        if (valA < valB) return sortConfig.direction === 'ascending' ? -1 : 1;
        if (valA > valB) return sortConfig.direction === 'ascending' ? 1 : -1;
        return 0;
      });
    }
    return sortableItems;
  }, [items, sortConfig]);

  const requestSort = (key) => {
    let direction = 'ascending';
    if (sortConfig && sortConfig.key === key && sortConfig.direction === 'ascending') direction = 'descending';
    setSortConfig({ key, direction });
  };

  return { items: sortedItems, requestSort, sortConfig };
};