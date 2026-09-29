export const initialInvoices = [
  { id: 'INV/2026-27/001', client: 'Tribal Gaming AJ', date: '2025-12-24', dueDate: '2026-01-24', status: 'paid', amount: 17700.00, currency: '₹', discount: 0, items: [{id: 1, desc: 'Esports Overlay Design', qty: 1, rate: 15000, tax: 18}] },
  { id: 'INV/2026-27/002', client: 'Shayrlocked Media', date: '2026-01-08', dueDate: '2026-02-08', status: 'paid', amount: 59000.00, currency: '₹', discount: 0, items: [{id: 1, desc: 'Vlog Scripting & Formatting', qty: 1, rate: 50000, tax: 18}] },
];

export const initialExpenses = [
  { id: 'EXP-001', date: '2026-02-05', desc: 'Fabric Sourcing', cat: 'Raw Materials', amount: 1800.00, currency: '₹' },
  { id: 'EXP-002', date: '2026-02-04', desc: 'Premiere Pro', cat: 'Software & Subscriptions', amount: 150.00, currency: '₹' }
];

export const initialClients = [
  { id: 'C-001', name: 'Tribal Gaming AJ', email: 'contact@tribalgamingaj.com', phone: '+91 9876543210', status: 'active', address: 'Esports Arena', city: 'Delhi', state: 'Delhi', country: 'India' },
  { id: 'C-002', name: 'Shayrlocked Media', email: 'hello@shayrlocked.com', phone: '+91 8765432109', status: 'active', address: 'Poetry Hub', city: 'Mumbai', state: 'Maharashtra', country: 'India' },
];

export const initialPayments = [
  { id: 'PAY-001', invoice: 'INV/2026-27/001', client: 'Tribal Gaming AJ', date: '2025-12-25', method: 'Bank Transfer', status: 'completed', amount: 17700.00, currency: '₹' },
  { id: 'PAY-002', invoice: 'INV/2026-27/002', client: 'Shayrlocked Media', date: '2026-01-10', method: 'Credit Card', status: 'completed', amount: 59000.00, currency: '₹' },
];

export const initialDeductions = [];

export const initialTaxProfiles = [
  { id: 1, name: 'No Tax', rate: 0 },
  { id: 2, name: 'GST 18%', rate: 18 },
  { id: 3, name: 'GST 5%', rate: 5 }
];

export const initialExpenseCategories = ['Raw Materials', 'Software & Subscriptions', 'Office Supplies', 'Travel & Transport', 'Logistics'];

export const initialBusinessProfile = {
  name: 'Mau Gharana',
  owner: 'Ahmad Jamal',
  country: 'India',
  address: 'Bhikhari Pura',
  city: 'Mau',
  state: 'Uttar Pradesh',
  zip: '275101',
  gstin: '07AAJCVB3011Z'
};

export const indiaStatesAndCities = {
  "Andaman and Nicobar Islands": ["Port Blair"], "Andhra Pradesh": ["Visakhapatnam", "Vijayawada", "Guntur"], "Arunachal Pradesh": ["Itanagar"], "Assam": ["Guwahati", "Dibrugarh"], "Bihar": ["Patna", "Gaya"], "Chandigarh": ["Chandigarh"], "Chhattisgarh": ["Raipur", "Bhilai"], "Delhi": ["New Delhi", "Delhi"], "Goa": ["Panaji", "Vasco da Gama"], "Gujarat": ["Ahmedabad", "Surat", "Vadodara"], "Haryana": ["Faridabad", "Gurugram"], "Himachal Pradesh": ["Shimla", "Manali"], "Jammu and Kashmir": ["Srinagar", "Jammu"], "Jharkhand": ["Ranchi", "Jamshedpur"], "Karnataka": ["Bengaluru", "Mysuru"], "Kerala": ["Thiruvananthapuram", "Kochi"], "Ladakh": ["Leh"], "Madhya Pradesh": ["Indore", "Bhopal"], "Maharashtra": ["Mumbai", "Pune", "Nagpur"], "Manipur": ["Imphal"], "Meghalaya": ["Shillong"], "Mizoram": ["Aizawl"], "Nagaland": ["Kohima", "Dimapur"], "Odisha": ["Bhubaneswar", "Cuttack"], "Puducherry": ["Puducherry"], "Punjab": ["Ludhiana", "Amritsar"], "Rajasthan": ["Jaipur", "Jodhpur"], "Sikkim": ["Gangtok"], "Tamil Nadu": ["Chennai", "Coimbatore", "Madurai"], "Telangana": ["Hyderabad", "Warangal"], "Tripura": ["Agartala"], "Uttar Pradesh": ["Lucknow", "Kanpur", "Varanasi", "Mau"], "Uttarakhand": ["Dehradun", "Haridwar"], "West Bengal": ["Kolkata", "Howrah"]
};