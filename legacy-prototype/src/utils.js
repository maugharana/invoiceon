export const EXCHANGE_RATES = { '₹': 1, '$': 83.5, '€': 90.2, '£': 105.4 };

export const convertToHome = (amount, currency = '₹') => (Number(amount) || 0) * (EXCHANGE_RATES[currency] || 1);

export const formatCurrency = (val, symbol = '₹') => `${symbol}${new Intl.NumberFormat('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(val) || 0)}`;

export const formatDateDisplay = (dateString) => {
  if (!dateString) {
    return '';
  }
  const date = new Date(dateString);
  // Check if the date is valid. `new Date('invalid')` returns an `Invalid Date` object,
  // and its time value is NaN.
  if (isNaN(date.getTime())) {
    return dateString; // Return original string if date is invalid
  }
  return date.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: '2-digit' });
};

export const getTodayDate = () => new Date().toISOString().split('T')[0];

export const isWithinRange = (dateString, range) => {
  if (range === 'all') return true;
  if (!dateString) return false;
  const d = new Date(dateString);
  const now = new Date();
  
  if (range === 'thisMonth') {
    return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
  }
  if (range === 'lastMonth') {
    const lastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    return d.getMonth() === lastMonth.getMonth() && d.getFullYear() === lastMonth.getFullYear();
  }
  if (range === 'thisYear') {
    return d.getFullYear() === now.getFullYear();
  }
  return true;
};