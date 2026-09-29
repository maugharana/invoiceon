import { useState, useMemo, useEffect } from 'react';
import { 
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  AreaChart, Area, PieChart, Pie, Cell
} from 'recharts';
import { 
  LayoutDashboard, 
  FileText, 
  CreditCard, 
  Users, 
  Receipt, 
  Settings,
  ChevronDown,
  ChevronUp,
  ChevronLeft,
  ChevronRight,
  Info,
  TrendingUp,
  DollarSign,
  File,
  Plus,
  ArrowLeft, 
  Pencil, 
  Download, 
  Trash2,
  // Percent,
  // Tag,
  // Building2,
  // Database,
  Search,
  Globe,
  // Upload,
  AlertTriangle,
  // HardDrive,
  UploadCloud,
  Mail,
  Phone,
  MapPin,
  Menu,
  X,
  // PlusCircle,
  // LogOut,
  Loader2,
  CheckCircle,
} from 'lucide-react';
// import { initializeApp } from 'firebase/app';
import { getAuth, signInAnonymously, signInWithCustomToken, onAuthStateChanged } from 'firebase/auth';
import { getFirestore, doc, setDoc, onSnapshot } from 'firebase/firestore';

// --- Firebase Initialization ---
let app, auth, db, appId;
const __initial_auth_token = undefined;

// --- Global Config ---
const EXCHANGE_RATES = { '₹': 1, '$': 83.5, '€': 90.2, '£': 105.4 };
const convertToHome = (amount, currency = '₹') => (Number(amount) || 0) * (EXCHANGE_RATES[currency] || 1);

const InvoiceOnLogo = ({ className = "w-8 h-8 mr-2 shrink-0" }) => (
  <svg viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg" className={className}>
    <path d="M65 15H35C26.7157 15 20 21.7157 20 30V70C20 78.2843 26.7157 85 35 85H65C73.2843 85 80 78.2843 80 70V30L65 15Z" stroke="#800020" strokeWidth="6" strokeLinecap="round" strokeLinejoin="round"/>
    <path d="M65 15V30H80" stroke="#800020" strokeWidth="6" strokeLinecap="round" strokeLinejoin="round"/>
    <path d="M35 35H48" stroke="#800020" strokeWidth="5" strokeLinecap="round"/>
    <path d="M35 49H65" stroke="#f9a8d4" strokeWidth="5" strokeLinecap="round"/>
    <path d="M35 63H55" stroke="#f9a8d4" strokeWidth="5" strokeLinecap="round"/>
    <path d="M70 60C67.7909 60 66 61.7909 66 64C66 66.2091 67.7909 68 70 68C72.2091 68 74 69.7909 74 72C74 74.2091 72.2091 76 70 76C67.7909 76 66 74.2091 66 72M70 56V80" stroke="#800020" strokeWidth="5" strokeLinecap="round"/>
  </svg>
);

const formatCurrency = (val, symbol = '₹') => `${symbol}${new Intl.NumberFormat('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(val) || 0)}`;

const formatDateDisplay = (dateString) => {
  if (!dateString) return '';
  try {
    return new Date(dateString).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: '2-digit' });
  } catch (e) {
    return dateString;
  }
};

const getTodayDate = () => new Date().toISOString().split('T')[0];

const isWithinRange = (dateString, range) => {
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

// --- Initial Mock Data & Constants ---
const indiaStatesAndCities = {
  "Andaman and Nicobar Islands": ["Port Blair", "Car Nicobar", "Mayabunder", "Diglipur", "Hut Bay"],
  "Andhra Pradesh": ["Anantapur", "Chittoor", "East Godavari", "Guntur", "YSR Kadapa", "Krishna", "Kurnool", "Nellore", "Prakasam", "Srikakulam", "Visakhapatnam", "Vizianagaram", "West Godavari", "Amaravati", "Tirupati", "Vijayawada"],
  "Arunachal Pradesh": ["Tawang", "West Kameng", "East Kameng", "Papum Pare", "Kurung Kumey", "Kra Daadi", "Lower Subansiri", "Upper Subansiri", "West Siang", "East Siang", "Siang", "Upper Siang", "Lower Siang", "Lower Dibang Valley", "Dibang Valley", "Upper Dibang Valley", "Anjaw", "Lohit", "Namsai", "Changlang", "Tirap", "Longding", "Itanagar"],
  "Assam": ["Baksa", "Barpeta", "Biswanath", "Bongaigaon", "Cachar", "Charaideo", "Chirang", "Darrang", "Dhemaji", "Dhubri", "Dibrugarh", "Dima Hasao", "Goalpara", "Golaghat", "Hailakandi", "Hojai", "Jorhat", "Kamrup", "Kamrup Metropolitan", "Karbi Anglong", "Karimganj", "Kokrajhar", "Lakhimpur", "Majuli", "Morigaon", "Nagaon", "Nalbari", "Sivasagar", "Sonitpur", "South Salmara-Mankachar", "Tinsukia", "Udalguri", "West Karbi Anglong", "Guwahati", "Silchar"],
  "Bihar": ["Araria", "Arwal", "Aurangabad", "Banka", "Begusarai", "Bhagalpur", "Bhojpur", "Buxar", "Darbhanga", "East Champaran", "Gaya", "Gopalganj", "Jamui", "Jehanabad", "Kaimur", "Katihar", "Khagaria", "Kishanganj", "Lakhisarai", "Madhepura", "Madhubani", "Munger", "Muzaffarpur", "Nalanda", "Nawada", "Patna", "Purnia", "Rohtas", "Saharsa", "Samastipur", "Saran", "Sheikhpura", "Sheohar", "Sitamarhi", "Siwan", "Supaul", "Vaishali", "West Champaran"],
  "Chandigarh": ["Chandigarh"],
  "Chhattisgarh": ["Balod", "Baloda Bazar", "Balrampur", "Bastar", "Bemetara", "Bijapur", "Bilaspur", "Dantewada", "Dhamtari", "Gariaband", "Janjgir-Champa", "Jashpur", "Kabirdham", "Kanker", "Kondagaon", "Korba", "Koriya", "Mahasamund", "Mungeli", "Narayanpur", "Raigarh", "Raipur", "Rajnandgaon", "Sukma", "Surajpur", "Surguja", "Bhilai", "Durg"],
  "Dadra and Nagar Haveli and Daman and Diu": ["Daman", "Diu", "Silvassa"],
  "Delhi": ["Central Delhi", "East Delhi", "New Delhi", "North Delhi", "North East Delhi", "North West Delhi", "Shahdara", "South Delhi", "South East Delhi", "South West Delhi", "West Delhi"],
  "Goa": ["North Goa", "South Goa", "Panaji", "Margao", "Vasco da Gama", "Mapusa"],
  "Gujarat": ["Ahmedabad", "Amreli", "Anand", "Aravalli", "Banaskantha", "Bharuch", "Bhavnagar", "Botad", "Chhota Udaipur", "Dahod", "Dang", "Devbhoomi Dwarka", "Gandhinagar", "Gir Somnath", "Jamnagar", "Junagadh", "Kheda", "Kutch", "Mahisagar", "Mehsana", "Morbi", "Narmada", "Navsari", "Panchmahal", "Patan", "Porbandar", "Rajkot", "Sabarkantha", "Surat", "Surendranagar", "Tapi", "Vadodara", "Valsad"],
  "Haryana": ["Ambala", "Bhiwani", "Charkhi Dadri", "Faridabad", "Fatehabad", "Gurugram", "Hisar", "Jhajjar", "Jind", "Kaithal", "Karnal", "Kurukshetra", "Mahendragarh", "Nuh", "Palwal", "Panchkula", "Panipat", "Rewari", "Rohtak", "Sirsa", "Sonipat", "Yamunanagar"],
  "Himachal Pradesh": ["Bilaspur", "Chamba", "Hamirpur", "Kangra", "Kinnaur", "Kullu", "Lahaul and Spiti", "Mandi", "Shimla", "Sirmaur", "Solan", "Una", "Dharamshala", "Manali"],
  "Jammu and Kashmir": ["Anantnag", "Bandipora", "Baramulla", "Budgam", "Doda", "Ganderbal", "Jammu", "Kathua", "Kishtwar", "Kulgam", "Kupwara", "Poonch", "Pulwama", "Rajouri", "Ramban", "Reasi", "Samba", "Shopian", "Srinagar", "Udhampur"],
  "Jharkhand": ["Bokaro", "Chatra", "Deoghar", "Dhanbad", "Dumka", "East Singhbhum", "Garhwa", "Giridih", "Godda", "Gumla", "Hazaribagh", "Jamtara", "Khunti", "Koderma", "Latehar", "Lohardaga", "Pakur", "Palamu", "Ramgarh", "Ranchi", "Sahibganj", "Seraikela Kharsawan", "Simdega", "West Singhbhum", "Jamshedpur"],
  "Karnataka": ["Bagalkot", "Bangalore Rural", "Bangalore Urban", "Belgaum", "Bellary", "Bidar", "Chamarajanagar", "Chikballapur", "Chikkamagaluru", "Chitradurga", "Dakshina Kannada", "Davanagere", "Dharwad", "Gadag", "Hassan", "Haveri", "Kalaburagi", "Kodagu", "Kolar", "Koppal", "Mandya", "Mysore", "Raichur", "Ramanagara", "Shimoga", "Tumkur", "Udupi", "Uttara Kannada", "Vijayapura", "Yadgir", "Hubli", "Mangalore"],
  "Kerala": ["Alappuzha", "Ernakulam", "Idukki", "Kannur", "Kasaragod", "Kollam", "Kottayam", "Kozhikode", "Malappuram", "Palakkad", "Pathanamthitta", "Thiruvananthapuram", "Thrissur", "Wayanad", "Kochi"],
  "Ladakh": ["Kargil", "Leh"],
  "Lakshadweep": ["Kavaratti", "Agatti", "Amini", "Andrott"],
  "Madhya Pradesh": ["Agar Malwa", "Alirajpur", "Anuppur", "Ashoknagar", "Balaghat", "Barwani", "Betul", "Bhind", "Bhopal", "Burhanpur", "Chhatarpur", "Chhindwara", "Damoh", "Datia", "Dewas", "Dhar", "Dindori", "Guna", "Gwalior", "Harda", "Hoshangabad", "Indore", "Jabalpur", "Jhabua", "Katni", "Khandwa", "Khargone", "Mandla", "Mandsaur", "Morena", "Narsinghpur", "Neemuch", "Panna", "Raisen", "Rajgarh", "Ratlam", "Rewa", "Sagar", "Satna", "Sehore", "Seoni", "Shahdol", "Shajapur", "Sheopur", "Shivpuri", "Sidhi", "Singrauli", "Tikamgarh", "Ujjain", "Umaria", "Vidisha"],
  "Maharashtra": ["Ahmednagar", "Akola", "Amravati", "Aurangabad", "Beed", "Bhandara", "Buldhana", "Chandrapur", "Dhule", "Gadchiroli", "Gondia", "Hingoli", "Jalgaon", "Jalna", "Kolhapur", "Latur", "Mumbai City", "Mumbai Suburban", "Nagpur", "Nanded", "Nandurbar", "Nashik", "Osmanabad", "Palghar", "Parbhani", "Pune", "Raigad", "Ratnagiri", "Sangli", "Satara", "Sindhudurg", "Solapur", "Thane", "Wardha", "Washim", "Yavatmal", "Navi Mumbai", "Kalyan-Dombivli", "Vasai-Virar"],
  "Manipur": ["Bishnupur", "Chandel", "Churachandpur", "Imphal East", "Imphal West", "Jiribam", "Kakching", "Kamjong", "Kangpokpi", "Noney", "Pherzawl", "Senapati", "Tamenglong", "Tengnoupal", "Thoubal", "Ukhrul"],
  "Meghalaya": ["East Garo Hills", "East Jaintia Hills", "East Khasi Hills", "North Garo Hills", "Ri Bhoi", "South Garo Hills", "South West Garo Hills", "South West Khasi Hills", "West Garo Hills", "West Jaintia Hills", "West Khasi Hills", "Shillong"],
  "Mizoram": ["Aizawl", "Champhai", "Hnahthial", "Khawzawl", "Kolasib", "Lawngtlai", "Lunglei", "Mamit", "Saiha", "Saitual", "Serchhip"],
  "Nagaland": ["Chumukedima", "Dimapur", "Kiphire", "Kohima", "Longleng", "Mokokchung", "Mon", "Niuland", "Noklak", "Peren", "Phek", "Shamator", "Tuensang", "Tseminyu", "Wokha", "Zunheboto"],
  "Odisha": ["Angul", "Balangir", "Balasore", "Bargarh", "Bhadrak", "Boudh", "Cuttack", "Deogarh", "Dhenkanal", "Gajapati", "Ganjam", "Jagatsinghpur", "Jajpur", "Jharsuguda", "Kalahandi", "Kandhamal", "Kendrapara", "Kendujhar", "Khordha", "Koraput", "Malkangiri", "Mayurbhanj", "Nabarangpur", "Nayagarh", "Nuapada", "Puri", "Rayagada", "Sambalpur", "Subarnapur", "Sundargarh", "Bhubaneswar", "Rourkela"],
  "Puducherry": ["Karaikal", "Mahe", "Pondicherry", "Yanam"],
  "Punjab": ["Amritsar", "Barnala", "Bathinda", "Faridkot", "Fatehgarh Sahib", "Fazilka", "Ferozepur", "Gurdaspur", "Hoshiarpur", "Jalandhar", "Kapurthala", "Ludhiana", "Mansa", "Moga", "Muktsar", "Nawanshahr", "Pathankot", "Patiala", "Rupnagar", "Sangrur", "SAS Nagar", "Tarn Taran"],
  "Rajasthan": ["Ajmer", "Alwar", "Banswara", "Baran", "Barmer", "Bharatpur", "Bhilwara", "Bikaner", "Bundi", "Chittorgarh", "Churu", "Dausa", "Dholpur", "Dungarpur", "Hanumangarh", "Jaipur", "Jaisalmer", "Jalore", "Jhalawar", "Jhunjhunu", "Jodhpur", "Karauli", "Kota", "Nagaur", "Pali", "Pratapgarh", "Rajsamand", "Sawai Madhopur", "Sikar", "Sirohi", "Sri Ganganagar", "Tonk", "Udaipur"],
  "Sikkim": ["East Sikkim", "North Sikkim", "South Sikkim", "West Sikkim", "Pakyong", "Soreng"],
  "Tamil Nadu": ["Ariyalur", "Chengalpattu", "Chennai", "Coimbatore", "Cuddalore", "Dharmapuri", "Dindigul", "Erode", "Kallakurichi", "Kanchipuram", "Kanyakumari", "Karur", "Krishnagiri", "Madurai", "Mayiladuthurai", "Nagapattinam", "Namakkal", "Nilgiris", "Perambalur", "Pudukkottai", "Ramanathapuram", "Ranipet", "Salem", "Sivaganga", "Tenkasi", "Thanjavur", "Theni", "Thoothukudi", "Tiruchirappalli", "Tirunelveli", "Tirupathur", "Tiruppur", "Tiruvallur", "Tiruvannamalai", "Tiruvarur", "Vellore", "Viluppuram", "Virudhunagar"],
  "Telangana": ["Adilabad", "Bhadradri Kothagudem", "Hyderabad", "Jagtial", "Jangaon", "Jayashankar Bhupalpally", "Jogulamba Gadwal", "Kamareddy", "Karimnagar", "Khammam", "Komaram Bheem Asifabad", "Mahabubabad", "Mahabubnagar", "Mancherial", "Medak", "Medchal-Malkajgiri", "Mulugu", "Nagarkurnool", "Nalgonda", "Narayanpet", "Nirmal", "Nizamabad", "Peddapalli", "Rajanna Sircilla", "Ranga Reddy", "Sangareddy", "Siddipet", "Suryapet", "Vikarabad", "Wanaparthy", "Warangal", "Yadadri Bhuvanagiri"],
  "Tripura": ["Dhalai", "Gomati", "Khowai", "North Tripura", "Sepahijala", "South Tripura", "Unakoti", "West Tripura", "Agartala"],
  "Uttar Pradesh": ["Agra", "Aligarh", "Allahabad", "Ambedkar Nagar", "Amethi", "Amroha", "Auraiya", "Ayodhya", "Azamgarh", "Baghpat", "Bahraich", "Ballia", "Balrampur", "Banda", "Barabanki", "Bareilly", "Basti", "Bhadohi", "Bijnor", "Budaun", "Bulandshahr", "Chandauli", "Chitrakoot", "Deoria", "Etah", "Etawah", "Farrukhabad", "Fatehpur", "Firozabad", "Gautam Buddha Nagar", "Ghaziabad", "Ghazipur", "Gonda", "Gorakhpur", "Hamirpur", "Hapur", "Hardoi", "Hathras", "Jalaun", "Jaunpur", "Jhansi", "Kannauj", "Kanpur Dehat", "Kanpur Nagar", "Kasganj", "Kaushambi", "Kheri", "Kushinagar", "Lalitpur", "Lucknow", "Maharajganj", "Mahoba", "Mainpuri", "Mathura", "Mau", "Meerut", "Mirzapur", "Moradabad", "Muzaffarnagar", "Pilibhit", "Pratapgarh", "Raebareli", "Rampur", "Saharanpur", "Sambhal", "Sant Kabir Nagar", "Shahjahanpur", "Shamli", "Shravasti", "Siddharthnagar", "Sitapur", "Sonbhadra", "Sultanpur", "Unnao", "Varanasi", "Noida"],
  "Uttarakhand": ["Almora", "Bageshwar", "Chamoli", "Champawat", "Dehradun", "Haridwar", "Nainital", "Pauri Garhwal", "Pithoragarh", "Rudraprayag", "Tehri Garhwal", "Udham Singh Nagar", "Uttarkashi", "Rishikesh", "Roorkee"],
  "West Bengal": ["Alipurduar", "Bankura", "Birbhum", "Cooch Behar", "Dakshin Dinajpur", "Darjeeling", "Hooghly", "Howrah", "Jalpaiguri", "Jhargram", "Kalimpong", "Kolkata", "Malda", "Murshidabad", "Nadia", "North 24 Parganas", "Paschim Bardhaman", "Paschim Medinipur", "Purba Bardhaman", "Purba Medinipur", "Purulia", "South 24 Parganas", "Uttar Dinajpur", "Siliguri", "Haldia"]
};

const initialInvoices = [
  { id: 'INV/2026-27/001', client: 'Tribal Gaming AJ', date: '2025-12-24', dueDate: '2026-01-24', status: 'paid', amount: 17700.00, currency: '₹', discount: 0, items: [{id: 1, desc: 'Esports Overlay Design', qty: 1, rate: 15000, tax: 18}] },
  { id: 'INV/2026-27/002', client: 'Shayrlocked Media', date: '2026-01-08', dueDate: '2026-02-08', status: 'paid', amount: 59000.00, currency: '₹', discount: 0, items: [{id: 1, desc: 'Vlog Scripting & Formatting', qty: 1, rate: 50000, tax: 18}] },
];

const initialExpenses = [
  { id: 'EXP-001', date: '2026-02-05', desc: 'Fabric Sourcing', cat: 'Raw Materials', amount: 1800.00, currency: '₹' },
  { id: 'EXP-002', date: '2026-02-04', desc: 'Premiere Pro', cat: 'Software & Subscriptions', amount: 150.00, currency: '₹' }
];

const initialClients = [
  { id: 'C-001', name: 'Tribal Gaming AJ', email: 'contact@tribalgamingaj.com', phone: '+91 9876543210', status: 'active', address: 'Esports Arena', city: 'Delhi', state: 'Delhi', country: 'India' },
  { id: 'C-002', name: 'Shayrlocked Media', email: 'hello@shayrlocked.com', phone: '+91 8765432109', status: 'active', address: 'Poetry Hub', city: 'Mumbai', state: 'Maharashtra', country: 'India' },
];

const initialPayments = [
  { id: 'PAY-001', invoice: 'INV/2026-27/001', client: 'Tribal Gaming AJ', date: '2025-12-25', method: 'Bank Transfer', status: 'completed', amount: 17700.00, currency: '₹' },
  { id: 'PAY-002', invoice: 'INV/2026-27/002', client: 'Shayrlocked Media', date: '2026-01-10', method: 'Credit Card', status: 'completed', amount: 59000.00, currency: '₹' },
];

const initialDeductions = [];

const initialTaxProfiles = [
  { id: 1, name: 'No Tax', rate: 0 },
  { id: 2, name: 'GST 18%', rate: 18 },
  { id: 3, name: 'GST 5%', rate: 5 }
];

const initialExpenseCategories = [
  'Raw Materials', 'Software & Subscriptions', 'Office Supplies', 'Travel & Transport', 'Logistics'
];

const initialBusinessProfile = {
  name: 'Mau Gharana',
  owner: 'Ahmad Jamal',
  country: 'India',
  address: 'Bhikhari Pura',
  city: 'Mau',
  state: 'Uttar Pradesh',
  zip: '275101',
  gstin: '07AAJCVB3011Z'
};

// --- Custom Hooks ---
// Replaces Firebase with seamless local storage tracking
function useLocalStorageState(key, initialValue) {
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

const useSortableData = (items, config = null) => {
  const [sortConfig, setSortConfig] = useState(config);
  
  const safeItems = Array.isArray(items) ? items : [];

  const sortedItems = useMemo(() => {
    let sortableItems = [...safeItems];
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
  }, [safeItems, sortConfig]);

  const requestSort = (key) => {
    let direction = 'ascending';
    if (sortConfig && sortConfig.key === key && sortConfig.direction === 'ascending') direction = 'descending';
    setSortConfig({ key, direction });
  };

  return { items: sortedItems, requestSort, sortConfig };
};

// --- Reusable UI Components ---
const Card = ({ children, className = '' }) => (
  <div className={`bg-white rounded-xl border border-gray-200 shadow-sm p-6 ${className}`}>{children}</div>
);

const NavItem = ({ icon: Icon, label, active = false, onClick }) => (
  <button onClick={onClick} className={`w-full flex items-center px-4 py-2.5 rounded-lg text-sm font-semibold transition-colors ${active ? 'bg-[#FDF5F6] text-[#800020]' : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'}`}>
    <Icon className={`w-5 h-5 mr-3 ${active ? 'text-[#800020]' : 'text-gray-400'}`} />{label}
  </button>
);

const StatusBadge = ({ status }) => {
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

const SortableHeader = ({ label, sortKey, currentSort, requestSort, align="left", className="" }) => (
  <th className={`py-4 px-6 cursor-pointer hover:bg-gray-100/50 transition-colors select-none ${align === 'right' ? 'text-right' : 'text-left'} ${className}`} onClick={() => requestSort(sortKey)}>
    <div className={`flex items-center space-x-1 ${align === 'right' ? 'justify-end' : ''}`}>
      <span>{label}</span>
      {currentSort?.key === sortKey ? (currentSort.direction === 'ascending' ? <ChevronUp className="w-3 h-3 text-[#800020]"/> : <ChevronDown className="w-3 h-3 text-[#800020]"/>) : <ChevronDown className="w-3 h-3 text-gray-300 opacity-0 group-hover:opacity-100"/>}
    </div>
  </th>
);

const PaginationControls = ({ currentPage, totalPages, setCurrentPage, totalItems }) => {
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

const DateRangeSelect = ({ value, onChange }) => (
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

const Toast = ({ message, type, onClose }) => {
  useEffect(() => {
    const timer = setTimeout(onClose, 3000);
    return () => clearTimeout(timer);
  }, [onClose]);
  return (
    <div className={`fixed bottom-8 right-8 flex items-center px-5 py-3.5 rounded-xl shadow-2xl z-[200] animate-in slide-in-from-bottom-5 ${type === 'error' ? 'bg-red-600' : 'bg-gray-900'} text-white`}>
      {type === 'error' ? <AlertCircle className="w-5 h-5 mr-3"/> : <CheckCircle className="w-5 h-5 mr-3 text-[#f9a8d4]"/>}
      <span className="font-semibold text-sm">{message || ''}</span>
      <button onClick={onClose} className="ml-auto pl-4 text-gray-300 hover:text-white"><X className="w-4 h-4" /></button>
    </div>
  );
};

const ConfirmModal = ({ isOpen, onClose, onConfirm, title, message }) => {
  if (!isOpen) return null;
  return (
    <div className="fixed inset-0 z-[150] flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm animate-in fade-in duration-200">
      <Card className="w-full max-w-md p-8 animate-in zoom-in-95 duration-300">
        <div className="flex items-center justify-center w-12 h-12 rounded-full bg-red-100 mb-6"><AlertTriangle className="w-6 h-6 text-red-600" /></div>
        <h3 className="text-xl font-bold text-gray-900 mb-2">{title || ''}</h3>
        <p className="text-sm text-gray-500 mb-8">{message || ''}</p>
        <div className="flex justify-end gap-3">
          <button onClick={onClose} className="px-5 py-2.5 text-sm font-medium border border-gray-300 rounded-md hover:bg-gray-50">Cancel</button>
          <button onClick={() => { onConfirm(); onClose(); }} className="px-5 py-2.5 text-sm font-medium text-white bg-red-600 rounded-md hover:bg-red-700">Delete</button>
        </div>
      </Card>
    </div>
  );
};

const RevenueMap = ({ data = [] }) => {
  return (
    <div className="relative w-full h-full flex flex-col items-center justify-center overflow-hidden bg-slate-50/30">
      <svg viewBox="0 0 1000 500" className="w-full h-auto opacity-90 drop-shadow-sm">
        <path d="M100,100 L200,80 L250,150 L180,250 L80,200 Z" fill="#E2E8F0" stroke="#FFF" strokeWidth="2" />
        <path d="M110,210 L220,220 L240,350 L100,340 Z" fill="#fbcfe8" stroke="#FFF" strokeWidth="2" />
        <path d="M260,360 L320,380 L350,480 L280,470 Z" fill="#E2E8F0" stroke="#FFF" strokeWidth="2" />
        <path d="M450,150 L520,130 L550,250 L480,260 Z" fill="#E2E8F0" stroke="#FFF" strokeWidth="2" />
        <path d="M480,270 L550,260 L580,420 L450,400 Z" fill="#f472b6" stroke="#FFF" strokeWidth="2" />
        <path d="M600,100 L850,120 L900,350 L650,380 L580,250 Z" fill="#800020" stroke="#FFF" strokeWidth="2" className="hover:fill-[#5a0016] transition-colors cursor-pointer" />
        <path d="M780,390 L880,400 L850,480 L750,460 Z" fill="#E2E8F0" stroke="#FFF" strokeWidth="2" />
        <circle cx="680" cy="280" r="10" fill="#FFF" className="animate-ping" />
        <circle cx="680" cy="280" r="6" fill="#0f172a" />
      </svg>
      <div className="absolute bottom-4 right-4 bg-white/80 backdrop-blur-sm border border-gray-100 p-4 rounded-xl shadow-sm max-w-xs">
        <h5 className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-3">Top Regions</h5>
        <div className="space-y-2 max-h-32 overflow-y-auto pr-2">
          {data.map((item, idx) => (
            <div key={idx} className="flex items-center justify-between gap-4">
              <div className="flex items-center gap-2"><div className="w-2 h-2 rounded-full" style={{ backgroundColor: item.color || '#ccc' }} /><span className="text-[11px] font-bold text-gray-700">{item.country || 'Unknown'}</span></div>
              <span className="text-[11px] font-black text-gray-900">{formatCurrency(item.revenue)}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

const RecordDeductionModal = ({ isOpen, onClose, invoice, onSave, showToast, deductions = [] }) => {
  const [amount, setAmount] = useState('');
  const [date, setDate] = useState(getTodayDate());
  const [notes, setNotes] = useState('');

  if (!isOpen || !invoice) return null;
  
  const parsedAmount = parseFloat(amount) || 0;
  const newBalance = Math.max(0, (invoice.balance || 0) - parsedAmount);

  const handleSave = () => {
    if (!amount || isNaN(amount) || parseFloat(amount) <= 0) return showToast('Enter valid amount.', 'error');
    if (parseFloat(amount) > (invoice.balance || 0)) return showToast('Cannot exceed balance.', 'error');
    
    onSave({ id: `DED-${(deductions.length + 1).toString().padStart(3, '0')}`, invoice: invoice.id, date, notes, amount: parseFloat(amount) });
    onClose();
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="bg-white w-full max-w-lg rounded-2xl shadow-2xl overflow-hidden animate-in zoom-in-95 slide-in-from-bottom-4 duration-300">
        <div className="p-6 sm:p-8 space-y-6">
          <h3 className="text-lg font-bold text-gray-900">Record Deduction</h3>
          <div className="space-y-4">
            <div className="space-y-1">
              <label className="text-sm font-semibold text-gray-700">Deduction Amount *</label>
              <div className="relative"><span className="absolute left-3 top-2 text-gray-500 font-medium">₹</span><input type="number" value={amount} onChange={e => setAmount(e.target.value)} className="w-full pl-8 pr-4 py-2 bg-white border border-gray-300 rounded-md text-sm font-medium text-gray-900 focus:outline-none focus:border-[#800020]" placeholder="0.00" /></div>
            </div>
            <div className="grid grid-cols-2 gap-4"><div className="space-y-1"><label className="text-sm font-semibold text-gray-700">Deduction Date</label><input type="date" value={date} onChange={e => setDate(e.target.value)} className="w-full px-4 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:border-[#800020]" /></div></div>
            <div className="space-y-1"><label className="text-sm font-semibold text-gray-700">Notes (Optional)</label><textarea value={notes} onChange={e => setNotes(e.target.value)} placeholder="TDS certificate number, reasons..." className="w-full px-4 py-2 border border-gray-300 rounded-md text-sm resize-none h-20 focus:outline-none focus:border-[#800020]"></textarea></div>
          </div>
          <div className="bg-[#F8FAF9] p-5 rounded-lg space-y-3 border border-gray-100">
            <h4 className="text-sm font-bold text-gray-900 mb-4">After this deduction:</h4>
            <div className="flex justify-between items-center text-sm text-gray-500"><span>Invoice Total</span><span className="text-gray-900">{formatCurrency(invoice.amount, invoice.currency)}</span></div>
            <div className="flex justify-between items-center text-sm text-gray-500"><span>Previously Paid/Deducted</span><span className="text-gray-900">-{formatCurrency((invoice.paid || 0) + (invoice.deducted || 0), invoice.currency)}</span></div>
            <div className="flex justify-between items-center text-sm"><span className="text-amber-600 font-medium">This Deduction</span><span className="text-amber-600 font-medium">-{formatCurrency(parsedAmount, invoice.currency)}</span></div>
            <div className="pt-3 mt-3 border-t border-gray-200 flex justify-between items-center"><span className="text-sm font-medium text-gray-900">Client Needs to Pay</span><span className="text-base font-medium text-gray-900">{formatCurrency(newBalance, invoice.currency)}</span></div>
          </div>
          <div className="flex justify-end space-x-3 pt-2">
            <button onClick={onClose} className="px-6 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-50 border border-gray-300 rounded-md transition-colors">Cancel</button>
            <button onClick={handleSave} className="px-6 py-2.5 text-sm font-medium text-white bg-[#2563EB] hover:bg-[#1D4ED8] rounded-md transition-all shadow-sm">Save Deduction</button>
          </div>
        </div>
      </div>
    </div>
  );
};

const RecordPaymentModal = ({ isOpen, onClose, invoice, onSave, showToast, payments = [] }) => {
  const [amount, setAmount] = useState(invoice?.balance || 0);
  const [date, setDate] = useState(getTodayDate());
  const [method, setMethod] = useState('Bank Transfer');

  if (!isOpen || !invoice) return null;

  const parsedAmount = parseFloat(amount) || 0;
  const safeBalance = invoice.balance || 0;
  const newBalance = Math.max(0, safeBalance - parsedAmount);

  const handleSave = () => {
    if (!amount || isNaN(amount) || parseFloat(amount) <= 0) return showToast('Please enter a valid payment amount.', 'error');
    if (parseFloat(amount) > safeBalance) return showToast('Payment cannot exceed the remaining balance.', 'error');

    onSave({ id: `PAY-${(payments.length + 1).toString().padStart(3, '0')}`, invoice: invoice.id, client: invoice.client, date, method, status: 'completed', amount: parseFloat(amount), currency: invoice.currency });
    onClose();
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="bg-white w-full max-w-lg rounded-2xl shadow-2xl overflow-hidden animate-in zoom-in-95 slide-in-from-bottom-4 duration-300">
        <div className="p-6 sm:p-8 space-y-6">
          <h3 className="text-lg font-bold text-gray-900">Record Payment</h3>
          <div className="space-y-4">
            <div className="space-y-1">
              <label className="text-sm font-semibold text-gray-700">Amount Received *</label>
              <div className="relative"><span className="absolute left-3 top-2.5 text-gray-500 font-medium">{invoice.currency || '₹'}</span><input type="number" value={amount} onChange={e => setAmount(e.target.value)} className="w-full pl-8 pr-4 py-2.5 bg-white border border-gray-300 rounded-md text-sm font-medium text-gray-900 focus:outline-none focus:border-[#800020]" /></div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1"><label className="text-sm font-semibold text-gray-700">Payment Date</label><input type="date" value={date} onChange={e => setDate(e.target.value)} className="w-full px-4 py-2.5 bg-white border border-gray-300 rounded-md text-sm focus:outline-none focus:border-[#800020]" /></div>
              <div className="space-y-1">
                <label className="text-sm font-semibold text-gray-700">Payment Method</label>
                <div className="relative">
                  <select value={method} onChange={e => setMethod(e.target.value)} className="w-full px-4 py-2.5 bg-white border border-gray-300 rounded-md text-sm appearance-none focus:outline-none focus:border-[#800020]"><option value="Bank Transfer">Bank Transfer</option><option value="Credit Card">Credit Card</option><option value="Cash">Cash</option><option value="PayPal">PayPal</option></select>
                  <ChevronDown className="absolute right-3 top-3 w-4 h-4 text-gray-400 pointer-events-none" />
                </div>
              </div>
            </div>
          </div>
          <div className="bg-[#F0FDF4] p-5 rounded-lg space-y-3 border border-emerald-100">
            <div className="flex justify-between items-center text-sm text-gray-500"><span>Current Balance Due</span><span className="text-gray-900">{formatCurrency(safeBalance, invoice.currency)}</span></div>
            <div className="flex justify-between items-center text-sm"><span className="text-emerald-600 font-medium">This Payment</span><span className="text-emerald-600 font-medium">-{formatCurrency(parsedAmount, invoice.currency)}</span></div>
            <div className="pt-3 mt-3 border-t border-emerald-200/60 flex justify-between items-center"><span className="text-sm font-medium text-gray-900">Remaining Balance</span><span className="text-base font-medium text-gray-900">{formatCurrency(newBalance, invoice.currency)}</span></div>
          </div>
          <div className="flex justify-end space-x-3 pt-2">
            <button onClick={onClose} className="px-6 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-50 border border-gray-300 rounded-md transition-colors">Cancel</button>
            <button onClick={handleSave} className="px-6 py-2.5 text-sm font-medium text-white bg-[#800020] hover:bg-[#5a0016] rounded-md transition-all shadow-sm">Save Payment</button>
          </div>
        </div>
      </div>
    </div>
  );
};

const LoginView = ({ onLogin }) => {
  const [email, setEmail] = useState('maugharana@gmail.com');
  const [pass, setPass] = useState('ahmadsaiz');

  return (
    <div className="min-h-screen bg-[#F9FAFB] flex items-center justify-center p-6 font-sans">
      <Card className="w-full max-w-md p-10 shadow-xl border-gray-200">
        <div className="flex flex-col items-center justify-center mb-10">
          <InvoiceOnLogo className="w-16 h-16 mb-4 shrink-0" />
          <h1 className="text-3xl font-bold text-gray-900 tracking-tight">Invoice<span className="text-[#800020]">On</span></h1>
        </div>
        <form className="space-y-5" onSubmit={(e) => { e.preventDefault(); onLogin(); }}>
          <div className="space-y-1"><label className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Email</label><input type="email" value={email} onChange={e => setEmail(e.target.value)} className="w-full px-4 py-2.5 bg-white border border-gray-300 rounded-lg text-sm focus:border-[#800020] focus:outline-none" /></div>
          <div className="space-y-1"><label className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Password</label><input type="password" value={pass} onChange={e => setPass(e.target.value)} className="w-full px-4 py-2.5 bg-white border border-gray-300 rounded-lg text-sm focus:border-[#800020] focus:outline-none" /></div>
          <button type="submit" className="w-full py-3 mt-4 bg-[#800020] text-white rounded-lg font-medium shadow-md hover:bg-[#5a0016] transition-colors">Login to Dashboard</button>
        </form>
      </Card>
    </div>
  );
};

const DashboardView = ({ setView, clients = [], invoices = [], expenses = [], payments = [], deductions = [], businessProfile }) => {
  const [dateRange, setDateRange] = useState('all');

  const metrics = useMemo(() => {
    const filteredInvs = invoices.filter(i => i && i.status !== 'draft' && isWithinRange(i.date, dateRange));
    const filteredExp = expenses.filter(e => e && isWithinRange(e.date, dateRange));
    const filteredPay = payments.filter(p => p && isWithinRange(p.date, dateRange));
    const filteredDed = deductions.filter(d => d && isWithinRange(d.date, dateRange));

    const totalInvoiced = filteredInvs.reduce((s, i) => s + convertToHome(i.amount, i.currency), 0);
    const totalExpenses = filteredExp.reduce((s, e) => s + convertToHome(e.amount, e.currency), 0);
    const totalReceived = filteredPay.reduce((s, p) => s + convertToHome(p.amount, p.currency), 0);
    const totalDeducted = filteredDed.reduce((s, d) => s + convertToHome(d.amount, '₹'), 0);

    return { totalInvoiced, totalExpenses, totalReceived, totalDeducted, netIncome: totalReceived - totalExpenses, outstanding: totalInvoiced - totalReceived - totalDeducted };
  }, [invoices, expenses, payments, deductions, dateRange]);

  const charts = useMemo(() => {
    const filteredExp = expenses.filter(e => e && isWithinRange(e.date, dateRange));
    const catMap = {};
    filteredExp.forEach(e => {
       const amt = convertToHome(e.amount, e.currency);
       const cat = e.cat || 'Uncategorized';
       catMap[cat] = (catMap[cat] || 0) + amt;
    });
    const colors = ['#800020', '#9d0228', '#b80f35', '#d62852', '#f9a8d4', '#fbcfe8'];
    return Object.keys(catMap).map((k, i) => ({ name: k, value: catMap[k], color: colors[i % colors.length] }));
  }, [expenses, dateRange]);

  const aging = useMemo(() => {
    const now = new Date();
    const ageData = [
      { name: '0-30 days', value: 0, fill: '#800020' },
      { name: '30-60 days', value: 0, fill: '#3B82F6' },
      { name: '60-90 days', value: 0, fill: '#93C5FD' },
      { name: '90+ days', value: 0, fill: '#DBEAFE' },
    ];
    invoices.filter(i => i && i.status !== 'draft').forEach(inv => {
      const invPays = payments.filter(p => p && p.invoice === inv.id).reduce((s, p) => s + convertToHome(p.amount, p.currency), 0);
      const bal = convertToHome(inv.amount, inv.currency) - invPays;
      if (bal > 0 && inv.dueDate) {
        const due = new Date(inv.dueDate);
        const days = Math.floor((now - due) / (1000 * 60 * 60 * 24));
        if (days <= 30) ageData[0].value += bal;
        else if (days <= 60) ageData[1].value += bal;
        else if (days <= 90) ageData[2].value += bal;
        else ageData[3].value += bal;
      }
    });
    return ageData;
  }, [invoices, payments]);

  const cashFlow = useMemo(() => {
      const monthsMap = {};
      for(let i=5; i>=0; i--) {
        const d = new Date();
        d.setMonth(d.getMonth() - i);
        const m = d.toLocaleString('en-US', { month: 'short' }) + ' ' + d.getFullYear().toString().slice(-2);
        monthsMap[m] = { name: m, income: 0, expense: 0 };
      }
      
      payments.forEach(p => {
        if (!p || !p.date) return;
        const d = new Date(p.date);
        if(isNaN(d)) return;
        const m = d.toLocaleString('en-US', { month: 'short' }) + ' ' + d.getFullYear().toString().slice(-2);
        if(monthsMap[m]) monthsMap[m].income += convertToHome(p.amount, p.currency);
      });
      
      expenses.forEach(e => {
        if (!e || !e.date) return;
        const d = new Date(e.date);
        if(isNaN(d)) return;
        const m = d.toLocaleString('en-US', { month: 'short' }) + ' ' + d.getFullYear().toString().slice(-2);
        if(monthsMap[m]) monthsMap[m].expense += convertToHome(e.amount, e.currency);
      });
      
      return Object.values(monthsMap);
  }, [payments, expenses]);

  const incomeOverview = useMemo(() => {
      const monthsMap = {};
      for(let i=2; i>=0; i--) {
        const d = new Date();
        d.setMonth(d.getMonth() - i);
        const m = d.toLocaleString('en-US', { month: 'short' }) + ' ' + d.getFullYear().toString().slice(-2);
        monthsMap[m] = { name: m, invoiced: 0, received: 0 };
      }
      
      invoices.filter(i => i && i.status !== 'draft').forEach(inv => {
        if (!inv.date) return;
        const d = new Date(inv.date);
        if(isNaN(d)) return;
        const m = d.toLocaleString('en-US', { month: 'short' }) + ' ' + d.getFullYear().toString().slice(-2);
        if(monthsMap[m]) monthsMap[m].invoiced += convertToHome(inv.amount, inv.currency);
      });
      
      payments.forEach(p => {
        if (!p || !p.date) return;
        const d = new Date(p.date);
        if(isNaN(d)) return;
        const m = d.toLocaleString('en-US', { month: 'short' }) + ' ' + d.getFullYear().toString().slice(-2);
        if(monthsMap[m]) monthsMap[m].received += convertToHome(p.amount, p.currency);
      });
      
      return Object.values(monthsMap);
  }, [invoices, payments]);

  const revenueByCountry = useMemo(() => {
      const countryMap = {};      
      invoices.filter(i => i && i.status !== 'draft' && isWithinRange(i.date, dateRange)).forEach(inv => {
          const client = clients.find(c => c && c.name === inv.client);
          const country = client?.country || 'Unknown';
          countryMap[country] = (countryMap[country] || 0) + convertToHome(inv.amount, inv.currency);
      });
      
      const colors = ['#800020', '#b80f35', '#d62852', '#f9a8d4', '#fbcfe8'];
      return Object.keys(countryMap).sort((a,b)=>countryMap[b]-countryMap[a]).map((c, i) => ({
          country: c,
          revenue: countryMap[c],
          color: colors[i % colors.length]
      }));
  }, [invoices, clients, dateRange]);

  const topClients = useMemo(() => {
      const filteredInvs = invoices.filter(i => i && i.status !== 'draft' && isWithinRange(i.date, dateRange));
      const clientRev = {};
      filteredInvs.forEach(inv => {
          clientRev[inv.client || 'Unknown'] = (clientRev[inv.client || 'Unknown'] || 0) + convertToHome(inv.amount, inv.currency);
      });
      return Object.keys(clientRev)
          .map(name => ({ name, invoiced: clientRev[name] }))
          .sort((a, b) => b.invoiced - a.invoiced)
          .slice(0, 5);
  }, [invoices, dateRange]);

  return (
    <div className="max-w-[1600px] w-full mx-auto p-4 sm:p-8 space-y-6">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-end gap-4 mb-4">
        <div><h1 className="text-2xl font-bold text-gray-900">Dashboard</h1><p className="text-sm font-normal text-gray-500 mt-1">{businessProfile?.name || 'My Business'}</p></div>
        <DateRangeSelect value={dateRange} onChange={setDateRange} />
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <Card className="flex flex-col justify-between py-5 border-l-4 border-l-amber-400">
           <div className="flex justify-between items-start mb-2"><p className="text-[11px] font-semibold text-gray-500 uppercase tracking-wide">Outstanding</p><Info className="w-4 h-4 text-amber-500" /></div>
           <div><h3 className="text-2xl font-bold text-amber-500">{formatCurrency(metrics.outstanding)}</h3></div>
        </Card>
        <Card className="flex flex-col justify-between py-5 border-l-4 border-l-[#800020]">
           <div className="flex justify-between items-start mb-2"><p className="text-[11px] font-semibold text-gray-500 uppercase tracking-wide">Net Income</p><TrendingUp className="w-4 h-4 text-[#800020]" /></div>
           <div><h3 className="text-2xl font-bold text-[#800020]">{formatCurrency(metrics.netIncome)}</h3></div>
        </Card>
        <Card className="flex flex-col justify-between py-5 border-l-4 border-l-[#3B82F6]">
           <div className="flex justify-between items-start mb-2"><p className="text-[11px] font-semibold text-gray-500 uppercase tracking-wide">Received</p><DollarSign className="w-4 h-4 text-[#3B82F6]" /></div>
           <div><h3 className="text-2xl font-bold text-[#3B82F6]">{formatCurrency(metrics.totalReceived)}</h3></div>
        </Card>
        <Card className="flex flex-col justify-between py-5 border-l-4 border-l-gray-300">
           <div className="flex justify-between items-start mb-2"><p className="text-[11px] font-semibold text-gray-500 uppercase tracking-wide">Invoiced</p><File className="w-4 h-4 text-gray-400" /></div>
           <div><h3 className="text-2xl font-bold text-gray-900">{formatCurrency(metrics.totalInvoiced)}</h3></div>
        </Card>
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
        <Card className="lg:col-span-8 p-0 overflow-hidden min-h-[450px] relative">
          <div className="p-6 border-b border-gray-50 flex justify-between items-center">
            <h4 className="text-sm font-bold text-gray-900 uppercase tracking-wider">Revenue by Country</h4>
            <Globe className="w-4 h-4 text-gray-300" />
          </div>
          <div className="h-[400px] w-full bg-slate-50/30">
            <RevenueMap data={revenueByCountry} />
          </div>
        </Card>
        
        <Card className="lg:col-span-4 h-full flex flex-col">
          <h4 className="text-sm font-bold text-gray-900 mb-8 uppercase tracking-wider">Top Performing Clients</h4>
          <div className="space-y-8 overflow-y-auto pr-2 flex-1">
            {topClients.length > 0 ? topClients.map((client, index) => {
               const colors = ['bg-[#800020]', 'bg-[#b80f35]', 'bg-[#d62852]', 'bg-[#f9a8d4]', 'bg-[#fbcfe8]'];
               const barColor = colors[index % colors.length];
               const maxInvoiced = Math.max(...topClients.map(c => c.invoiced), 1);
               const widthPercent = (client.invoiced / maxInvoiced) * 100;
               return (
                <div key={index} className="flex items-center justify-between group cursor-pointer" onClick={() => setView('clients-list')}>
                  <div className="w-full">
                    <div className="flex justify-between items-center mb-2">
                       <span className="text-sm font-bold text-gray-700 truncate mr-2">{client.name || ''}</span>
                       <span className="text-xs font-black text-gray-900">{formatCurrency(client.invoiced)}</span>
                    </div>
                    <div className="w-full bg-gray-100 rounded-full h-1.5"><div className={`h-full rounded-full ${barColor} transition-all duration-1000`} style={{ width: `${widthPercent}%` }}></div></div>
                  </div>
                </div>
              )
            }) : <div className="h-full flex items-center justify-center text-gray-300 italic text-sm">No client data yet</div>}
          </div>
        </Card>
      </div>
      <div className="mb-2 mt-8"><h2 className="text-xl font-bold text-gray-900">Analytics</h2></div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card className="h-96 flex flex-col">
          <div className="mb-6"><h4 className="text-sm font-semibold">Outstanding Invoice Aging</h4>
            <h4 className="text-sm font-semibold text-gray-900">Outstanding Invoice Aging</h4>
            <p className="text-xs text-gray-400 mt-1">Total: {formatCurrency(metrics.outstanding)}</p>
          </div>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={aging} barSize={50}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
              <XAxis dataKey="name" tick={{fontSize: 11}} axisLine={false} tickLine={false} />
              <YAxis tick={{fontSize: 11}} axisLine={false} tickLine={false} />
              <Tooltip formatter={(v) => formatCurrency(v)} />
              <Bar dataKey="value" radius={[4, 4, 0, 0]}>{aging.map((e, i) => <Cell key={i} fill={e.fill} />)}</Bar>
            </BarChart>
          </ResponsiveContainer>
        </Card>
        <Card className="h-96 relative flex flex-col">
          <div className="mb-2"><h4 className="text-sm font-semibold">Expenses by Category</h4>
            <h4 className="text-sm font-semibold text-gray-900">Expenses by Category</h4>
            <p className="text-xs text-gray-400 mt-1">Breakdown of expenses</p>
          </div>
          <div className="flex-1 flex items-center">
            <ResponsiveContainer width="50%" height="100%">
              <PieChart>
                <Pie data={charts} innerRadius={55} outerRadius={80} dataKey="value" stroke="none">
                  {charts.map((e, i) => <Cell key={i} fill={e.color} />)}
                </Pie>
                <Tooltip formatter={(v) => formatCurrency(v)} />
              </PieChart>
            </ResponsiveContainer>
            <div className="absolute left-[25%] top-[55%] transform -translate-x-1/2 -translate-y-1/2 text-center pointer-events-none">
              <p className="text-[10px] text-gray-500 font-medium">Total</p>
              <p className="text-sm font-bold text-gray-900">{formatCurrency(metrics.totalExpenses)}</p>
            </div>
            <div className="flex-1 space-y-3 pl-2 overflow-y-auto max-h-[250px]">
              {charts.map((item, idx) => (
                <div key={idx} className="flex items-center text-[11px] text-gray-600 font-medium">
                  <div className="w-2 h-2 rounded-full mr-2 shrink-0" style={{ backgroundColor: item.color }} />
                  <span className="flex-1 truncate">{item.name || ''}</span>
                </div>
              ))}
            </div>
          </div>
        </Card>
      </div>
      <Card className="h-[400px] flex flex-col mt-6">
        <div className="mb-6"><h4 className="text-sm font-semibold">Cash Flow Trend</h4><p className="text-xs text-gray-400 mt-1">Last 6 Months</p></div>
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={cashFlow} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
            <defs>
              <linearGradient id="colorInc" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#800020" stopOpacity={0.2}/><stop offset="95%" stopColor="#800020" stopOpacity={0}/></linearGradient>
              <linearGradient id="colorExp" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#ef4444" stopOpacity={0.1}/><stop offset="95%" stopColor="#ef4444" stopOpacity={0}/></linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
            <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{fill: '#94a3b8', fontSize: 11}} dy={10} />
            <YAxis axisLine={false} tickLine={false} tick={{fill: '#94a3b8', fontSize: 11}} tickFormatter={(v) => `${v/1000}k`} />
            <Tooltip formatter={(value) => formatCurrency(value)} contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }} />
            <Area type="monotone" dataKey="income" stroke="#800020" strokeWidth={2} fillOpacity={1} fill="url(#colorInc)" />
            <Area type="monotone" dataKey="expense" stroke="#ef4444" strokeWidth={2} fillOpacity={1} fill="url(#colorExp)" />
          </AreaChart>
        </ResponsiveContainer>
      </Card>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mt-6">
        <Card className="h-96 flex flex-col">
          <div className="mb-6"><h4 className="text-sm font-semibold">Income Overview</h4><p className="text-xs text-gray-400 mt-1">Invoiced vs Received</p></div>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={incomeOverview} barGap={4} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
              <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{fill: '#94a3b8', fontSize: 11}} dy={10} />
              <YAxis axisLine={false} tickLine={false} tick={{fill: '#94a3b8', fontSize: 11}} tickFormatter={(v) => `${v/1000}k`} />
              <Tooltip cursor={{fill: 'transparent'}} formatter={(value) => formatCurrency(value)} contentStyle={{ borderRadius: '8px', border: 'none' }} />
              <Bar dataKey="invoiced" fill="#800020" radius={[4, 4, 0, 0]} barSize={25} />
              <Bar dataKey="received" fill="#f9a8d4" radius={[4, 4, 0, 0]} barSize={25} />
            </BarChart>
          </ResponsiveContainer>
        </Card>
      </div>
      <div className="h-16"></div>
    </div>
  );
};

const InvoicesListView = ({ data = [], setView, confirmDelete }) => {
  const [filter, setFilter] = useState('All');
  const [search, setSearch] = useState('');
  const [dateRange, setDateRange] = useState('all');
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 10;

  const filtered = useMemo(() => data.filter(inv => {
    if (!inv) return false;
    const clientName = inv.client || '';
    const invId = inv.id || '';
    const invStatus = inv.status || '';
    const matchesSearch = clientName.toLowerCase().includes(search.toLowerCase()) || invId.toLowerCase().includes(search.toLowerCase());
    const matchesFilter = filter === 'All' || invStatus.toLowerCase() === filter.toLowerCase();
    const matchesDate = isWithinRange(inv.date, dateRange);
    return matchesSearch && matchesFilter && matchesDate;  
  }), [data, search, filter, dateRange]);

  const { items: sorted, requestSort, sortConfig } = useSortableData(filtered, { key: 'date', direction: 'descending' });
  const paginated = sorted.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage);

  return (
    <div className="max-w-[1600px] w-full mx-auto p-4 sm:p-8 space-y-6">
      <div className="flex justify-between items-center">
        <h1 className="text-2xl font-bold">Invoices</h1>
        <button onClick={() => setView('new-invoice')} className="bg-[#800020] text-white hover:bg-[#5a0016] transition-colors px-4 py-2 rounded-lg flex items-center text-sm font-medium"><Plus className="w-4 h-4 mr-2"/>New Invoice</button>
      </div>
      <div className="flex flex-col sm:flex-row gap-4">
        <div className="flex bg-white p-1 border rounded-lg overflow-x-auto">
          {['All', 'Paid', 'Sent', 'Partial', 'Draft'].map(tab => (
            <button key={tab} onClick={() => setFilter(tab)} className={`px-4 py-1.5 text-xs font-semibold rounded-md ${filter === tab ? 'bg-[#800020] text-white' : 'text-gray-500'}`}>{tab}</button>
          ))}
        </div>
        <div className="flex-1 relative"><Search className="absolute left-3 top-2.5 w-4 h-4 text-gray-400"/><input type="text" value={search} onChange={e => setSearch(e.target.value)} placeholder="Search..." className="w-full pl-9 pr-4 py-2 border rounded-lg text-sm focus:outline-none focus:border-[#800020]"/></div>
        <DateRangeSelect value={dateRange} onChange={setDateRange} />
      </div>
      <Card className="p-0 overflow-hidden">
        <table className="w-full text-left min-w-[700px]">
          <thead className="bg-gray-50 border-b text-[11px] font-semibold text-gray-500 uppercase">
            <tr>
              <th className="py-4 px-6 w-12"><input type="checkbox" className="rounded"/></th>
              <SortableHeader label="Invoice" sortKey="id" currentSort={sortConfig} requestSort={requestSort} />
              <SortableHeader label="Client" sortKey="client" currentSort={sortConfig} requestSort={requestSort} />
              <SortableHeader label="Date" sortKey="date" currentSort={sortConfig} requestSort={requestSort} />
              <SortableHeader label="Status" sortKey="status" currentSort={sortConfig} requestSort={requestSort} />
              <SortableHeader label="Amount" sortKey="amount" currentSort={sortConfig} requestSort={requestSort} align="right" />
            </tr>
          </thead>
          <tbody className="divide-y">
            {paginated.map(inv => (
              <tr key={inv.id} className="hover:bg-gray-50 cursor-pointer group" onClick={() => setView('invoice-detail', inv)}>
                <td className="py-4 px-6"><input type="checkbox" onClick={e => e.stopPropagation()}/></td>
                <td className="py-4 px-6 font-semibold text-[#800020]">{inv.id || ''}</td>
                <td className="py-4 px-6 text-sm">{inv.client || ''}</td>
                <td className="py-4 px-6 text-sm">{formatDateDisplay(inv.date)}</td>
                <td className="py-4 px-6"><StatusBadge status={inv.status}/></td>
                <td className="py-4 px-6 text-right font-bold text-sm">
                  {formatCurrency(inv.amount, inv.currency)}
                  <button onClick={(e) => { e.stopPropagation(); confirmDelete('invoice', inv.id); }} className="ml-4 text-gray-400 hover:text-red-500 opacity-0 group-hover:opacity-100"><Trash2 className="w-4 h-4"/></button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <PaginationControls currentPage={currentPage} totalPages={Math.ceil(filtered.length / itemsPerPage)} setCurrentPage={setCurrentPage} totalItems={filtered.length} />
      </Card>
    </div>
  );
};

const InvoiceDetailView = ({ setView, invoice, onOpenDeduction, onOpenPayment, confirmDelete, clients = [] }) => {
  
  if (!invoice) return null;
  const clientDetails = clients.find(c => c && c.name === invoice.client);
  
  const subtotal = (invoice.items || []).reduce((s, i) => s + ((i?.qty || 0) * (i?.rate || 0)), 0) || 0;
  const tax = (invoice.items || []).reduce((s, i) => s + ((i?.qty || 0) * (i?.rate || 0) * ((i?.tax || 0) / 100)), 0) || 0;
  const discount = invoice.discount || 0;

  return (
    <div className="p-4 sm:p-8 max-w-[1600px] w-full mx-auto animate-in fade-in duration-500">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center mb-8 gap-4">
        <button onClick={() => setView('invoices-list')} className="flex items-center text-gray-600 font-medium"><ArrowLeft className="w-5 h-5 mr-2"/>Back</button>
        <div className="flex gap-3">
          <button onClick={() => confirmDelete('invoice', invoice.id)} className="p-2 text-red-600 bg-red-50 border rounded-lg"><Trash2 className="w-4 h-4"/></button>
          <button onClick={() => setView('new-invoice', invoice)} className="px-4 py-2 border rounded-lg text-sm font-medium">Edit</button>
          <button className="px-4 py-2 bg-[#800020] hover:bg-[#5a0016] transition-colors text-white rounded-lg text-sm font-medium flex items-center"><Download className="w-4 h-4 mr-2"/>Print PDF</button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <Card className="lg:col-span-2 p-8 sm:p-10 border-0 shadow-lg ring-1 ring-gray-900/5">
          <div className="flex justify-between items-start mb-10">
            <div><h2 className="text-xl font-bold">INV {invoice.id || ''}</h2><p className="text-sm text-gray-500">Issued {formatDateDisplay(invoice.date)} • Due {formatDateDisplay(invoice.dueDate)}</p></div>
            <StatusBadge status={invoice.status}/>
          </div>
          <div className="bg-gray-50 rounded-lg p-5 mb-10 border border-gray-100">
            <p className="text-[10px] font-bold text-gray-400 uppercase mb-2">Bill To</p>
            <p className="font-bold text-gray-900">{invoice.client || ''}</p>
            {clientDetails && (
              <div className="mt-1 space-y-0.5">
                {(clientDetails.email || clientDetails.phone) && (
                   <p className="text-sm text-gray-500">{clientDetails.email || 'N/A'} {clientDetails.email && clientDetails.phone ? ' • ' : ''} {clientDetails.phone || 'N/A'}</p>
                )}
                {clientDetails.address && (
                   <p className="text-xs text-gray-400">{clientDetails.address}{clientDetails.city ? `, ${clientDetails.city}` : ''}{clientDetails.state ? `, ${clientDetails.state}` : ''}</p>
                )}
              </div>
            )}
          </div>
          <table className="w-full mb-8 text-left">
            <thead><tr className="text-xs font-semibold text-gray-500 border-b"><th className="pb-3">Description</th><th className="pb-3 text-center">Qty</th><th className="pb-3 text-right">Rate</th><th className="pb-3 text-right">Amount</th></tr></thead>
            <tbody>{(invoice.items || []).map((it, i) => (
              <tr key={i} className="border-b border-gray-50"><td className="py-4 text-sm font-medium">{it?.desc || ''}</td><td className="py-4 text-center text-sm">{it?.qty || 0}</td><td className="py-4 text-right text-sm">{formatCurrency(it?.rate, invoice.currency)}</td><td className="py-4 text-right text-sm font-bold">{formatCurrency((it?.qty || 0) * (it?.rate || 0), invoice.currency)}</td></tr>
            ))}</tbody>
          </table>
          <div className="flex justify-end pt-4"><div className="w-full sm:w-72 space-y-3">
            <div className="flex justify-between text-sm"><span>Subtotal</span><span className="font-medium">{formatCurrency(subtotal, invoice.currency)}</span></div>
            {discount > 0 && <div className="flex justify-between text-sm"><span>Discount</span><span className="font-medium">-{formatCurrency(discount, invoice.currency)}</span></div>}
            {tax > 0 && <div className="flex justify-between text-sm"><span>Tax</span><span className="font-medium">{formatCurrency(tax, invoice.currency)}</span></div>}
            <div className="flex justify-between text-base font-bold pt-4 border-t"><span>Total</span><span>{formatCurrency(invoice.amount, invoice.currency)}</span></div>
            <div className="flex justify-between text-base font-bold pt-2 text-[#800020]"><span>Balance Due</span><span>{formatCurrency(invoice.balance, invoice.currency)}</span></div>
          </div></div>
          {invoice.notes && <div className="mt-12 pt-8 border-t"><p className="text-[10px] font-bold text-gray-400 uppercase mb-2">Notes</p><p className="text-xs text-gray-500 whitespace-pre-wrap">{invoice.notes}</p></div>}
          {invoice.terms && <div className="mt-6"><p className="text-[10px] font-bold text-gray-400 uppercase mb-2">Terms</p><p className="text-xs text-gray-500 whitespace-pre-wrap">{invoice.terms}</p></div>}
        </Card>
        <div className="space-y-6">
          <Card><h3 className="text-sm font-bold mb-5">Actions</h3><div className="space-y-3">
            <button onClick={onOpenPayment} className="w-full py-2.5 bg-[#800020] hover:bg-[#5a0016] transition-colors text-white rounded-lg font-medium text-sm">Record Payment</button>
            <button onClick={onOpenDeduction} className="w-full py-2.5 border rounded-lg font-medium text-sm">Record Deduction</button>
          </div></Card>
        </div>
      </div>
    </div>
  );
};

const NewInvoiceView = ({ setView, clients = [], taxProfiles = [], onSave, editItem, showToast, invoices = [] }) => {
  const [selectedClient, setSelectedClient] = useState(editItem ? editItem.client : "");
  const [date, setDate] = useState(editItem ? editItem.date : getTodayDate());
  const [dueDate, setDueDate] = useState(editItem ? editItem.dueDate : getTodayDate());
  const [currency, setCurrency] = useState(editItem ? editItem.currency : "₹");
  const [discount, setDiscount] = useState(editItem?.discount || '');
  const [lineItems, setLineItems] = useState(editItem?.items || [{ id: Date.now(), desc: '', qty: 1, rate: 0, tax: 0 }]);
  const [notes, setNotes] = useState(editItem?.notes || "");
  const [terms, setTerms] = useState(editItem?.terms || "");

  const totals = useMemo(() => {
    const subtotal = lineItems.reduce((acc, item) => acc + ((item.qty || 0) * (item.rate || 0)), 0);
    const taxTotal = lineItems.reduce((acc, item) => acc + ((item.qty || 0) * (item.rate || 0) * ((item.tax || 0) / 100)), 0);
    const disc = parseFloat(discount) || 0;
    return { subtotal, taxTotal, disc, total: Math.max(0, subtotal + taxTotal - disc) };
  }, [lineItems, discount]);

  const handleSave = () => {
    if (!selectedClient) return showToast('Please select a customer.', 'error');
    if (lineItems.length === 0 || !lineItems[0]?.desc?.trim()) return showToast('Add a line item.', 'error');
    const invId = editItem ? editItem.id : `INV/${(invoices.length + 1).toString().padStart(3,'0')}`;
    onSave({ id: invId, client: selectedClient, date, dueDate, status: editItem ? editItem.status : 'draft', amount: totals.total, discount: totals.disc, currency, items: lineItems, notes, terms });
    showToast(`Invoice saved.`); setView('invoices-list');
  };

  return (
    <div className="max-w-[1600px] w-full mx-auto p-4 sm:p-8 animate-in fade-in">
      <div className="flex items-center mb-8"><button onClick={() => setView('invoices-list')} className="mr-4"><ArrowLeft/></button><h1 className="text-2xl font-bold">{editItem ? 'Edit' : 'New'} Invoice</h1></div>
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
        <div className="lg:col-span-8 space-y-6">
          <Card><label className="text-sm font-semibold block mb-3">Client *</label><select value={selectedClient} onChange={e => setSelectedClient(e.target.value)} className="w-full p-2.5 border rounded-lg focus:outline-none focus:border-[#800020]">
              <option value="" disabled>Select</option>
              {clients.map(c => <option key={c.id} value={c.name}>{c.name}</option>)}
            </select></Card>
          
          <Card className="overflow-x-auto">
            <h3 className="text-sm font-semibold mb-4">Items *</h3>
            <div className="space-y-3 min-w-[600px]">{lineItems.map(item => (
              <div key={item.id} className="grid grid-cols-12 gap-3 items-center">
                <input type="text" value={item.desc} onChange={e => setLineItems(lineItems.map(li => li.id === item.id ? {...li, desc: e.target.value} : li))} placeholder="Desc" className="col-span-6 p-2 border rounded-md text-sm focus:outline-none focus:border-[#800020]"/>
                <input type="number" value={item.qty} onChange={e => setLineItems(lineItems.map(li => li.id === item.id ? {...li, qty: parseFloat(e.target.value)||0} : li))} className="col-span-1 p-2 border rounded-md text-sm text-center focus:outline-none focus:border-[#800020]"/>
                <input type="number" value={item.rate} onChange={e => setLineItems(lineItems.map(li => li.id === item.id ? {...li, rate: parseFloat(e.target.value)||0} : li))} className="col-span-2 p-2 border rounded-md text-sm text-right focus:outline-none focus:border-[#800020]"/>
                <select value={item.tax} onChange={e => setLineItems(lineItems.map(li => li.id === item.id ? {...li, tax: parseFloat(e.target.value)} : li))} className="col-span-2 p-2 border rounded-md text-sm focus:outline-none focus:border-[#800020]">{taxProfiles.map(t => <option key={t.id} value={t.rate}>{t.name}</option>)}</select>
                <button onClick={() => setLineItems(lineItems.filter(li => li.id !== item.id))} className="col-span-1 text-gray-300 hover:text-red-500"><Trash2 className="w-4 h-4"/></button>
              </div>
            ))}<button onClick={() => setLineItems([...lineItems, {id: Date.now(), desc: '', qty: 1, rate: 0, tax: 0}])} className="mt-4 text-sm text-[#800020] font-bold">+ Add Line</button></div>
          </Card>

          <Card><h3 className="text-sm font-semibold mb-4">Additional Details</h3><div className="space-y-4"><textarea value={notes} onChange={e=>setNotes(e.target.value)} placeholder="Notes visible on invoice" className="w-full p-3 border rounded-lg text-sm h-20 focus:outline-none focus:border-[#800020]"/><textarea value={terms} onChange={e=>setTerms(e.target.value)} placeholder="Terms & Conditions" className="w-full p-3 border rounded-lg text-sm h-20 focus:outline-none focus:border-[#800020]"/></div></Card>
        </div>
        <div className="lg:col-span-4 space-y-6">
          <Card>
            <h3 className="text-sm font-semibold mb-4">Config</h3>
            <div className="space-y-4">
              <div><label className="text-xs block text-gray-500 mb-1">Issue Date</label><input type="date" value={date} onChange={e => setDate(e.target.value)} className="w-full p-2 border rounded-lg text-sm focus:outline-none focus:border-[#800020]"/></div>
              <div><label className="text-xs block text-gray-500 mb-1">Due Date</label><input type="date" value={dueDate} onChange={e => setDueDate(e.target.value)} className="w-full p-2 border rounded-lg text-sm focus:outline-none focus:border-[#800020]"/></div>
              <div><label className="text-xs block text-gray-500 mb-1">Currency</label><select value={currency} onChange={e => setCurrency(e.target.value)} className="w-full p-2 border rounded-lg text-sm focus:outline-none focus:border-[#800020]"><option value="₹">INR</option><option value="$">USD</option><option value="€">EUR</option><option value="£">GBP</option></select></div>
            </div>
          </Card>
          <Card>
            <h3 className="text-sm font-semibold mb-4">Summary</h3>
            <div className="space-y-3 text-sm">
              <div className="flex justify-between"><span>Subtotal</span><span>{formatCurrency(totals.subtotal, currency)}</span></div>
              <div className="flex justify-between items-center"><span>Discount</span><input type="number" value={discount} onChange={e=>setDiscount(e.target.value)} className="w-20 text-right border p-1 rounded-md focus:outline-none focus:border-[#800020]" placeholder="0"/></div>
              <div className="flex justify-between"><span>Tax</span><span>{formatCurrency(totals.taxTotal, currency)}</span></div>
              <div className="flex justify-between text-base font-bold pt-3 border-t"><span>Total</span><span>{formatCurrency(totals.total, currency)}</span></div>
            </div>
            <button onClick={handleSave} className="w-full py-3 bg-[#800020] hover:bg-[#5a0016] transition-colors text-white rounded-lg mt-6 font-medium">Save Invoice</button>
          </Card>
        </div>
      </div>
    </div>
  );
};

const ExpensesListView = ({ data = [], setView, confirmDelete, expenseCategories = [] }) => {
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('All Categories');
  const [dateRange, setDateRange] = useState('all');
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 10;

  const filtered = useMemo(() => {
    return data.filter(exp => {
      if (!exp) return false;
      const desc = exp.desc || '';
      const cat = exp.cat || '';
      const matchesSearch = desc.toLowerCase().includes(search.toLowerCase());
      const matchesFilter = filter === 'All Categories' || cat === filter;
      const matchesDate = isWithinRange(exp.date, dateRange);
      return matchesSearch && matchesFilter && matchesDate;    
    });  
  }, [data, search, filter, dateRange]);

  useEffect(() => setCurrentPage(1), [search, filter, dateRange]);
  
  const { items: sortedItems, requestSort, sortConfig } = useSortableData(filtered, { key: 'date', direction: 'descending' });
  const paginatedItems = sortedItems.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage);
  const totalPages = Math.ceil(sortedItems.length / itemsPerPage);

  const total = filtered.reduce((acc, curr) => acc + convertToHome(curr.amount, curr.currency), 0);

  return (
    <div className="max-w-[1600px] w-full mx-auto p-4 sm:p-8 space-y-6">
      <div className="flex justify-between items-center"><h1 className="text-2xl font-bold">Expenses</h1><button onClick={() => setView('new-expense')} className="bg-[#800020] text-white hover:bg-[#5a0016] transition-colors px-4 py-2 rounded-lg text-sm font-medium"><Plus className="w-4 h-4 mr-2"/>Log Expense</button></div>
      <div className="flex flex-col sm:flex-row gap-4">
        <select value={filter} onChange={e => setFilter(e.target.value)} className="p-2 border rounded-lg text-sm focus:outline-none focus:border-[#800020]">{['All Categories', ...expenseCategories].map(c => <option key={c} value={c}>{c}</option>)}</select>
        <input type="text" value={search} onChange={e => setSearch(e.target.value)} placeholder="Search..." className="flex-1 p-2 border rounded-lg text-sm focus:outline-none focus:border-[#800020]"/>
        <DateRangeSelect value={dateRange} onChange={setDateRange} />
      </div>
      <Card className="p-0 overflow-hidden"><table className="w-full text-left min-w-[600px]">
        <thead className="bg-gray-50 border-b text-xs font-semibold text-gray-500 uppercase"><tr><th className="p-4 w-12"><input type="checkbox"/></th><SortableHeader label="Date" sortKey="date" currentSort={sortConfig} requestSort={requestSort} /><SortableHeader label="Description" sortKey="desc" currentSort={sortConfig} requestSort={requestSort} /><SortableHeader label="Category" sortKey="cat" currentSort={sortConfig} requestSort={requestSort} /><SortableHeader label="Amount" sortKey="amount" currentSort={sortConfig} requestSort={requestSort} align="right" className="pr-14" /></tr></thead>
        <tbody>{paginatedItems.map(e => (
          <tr key={e.id} className="hover:bg-gray-50 cursor-pointer group" onClick={() => setView('new-expense', e)}><td className="p-4"><input type="checkbox" onClick={ev => ev.stopPropagation()}/></td><td className="p-4 text-sm">{formatDateDisplay(e.date)}</td><td className="p-4 text-sm font-medium">{e.desc || ''}</td><td className="p-4 text-sm text-gray-500">{e.cat || ''}</td><td className="p-4 text-right font-bold text-sm">{formatCurrency(e.amount, e.currency)}<button onClick={ev => {ev.stopPropagation(); confirmDelete('expense', e.id);}} className="ml-4 text-gray-400 hover:text-red-500 opacity-0 group-hover:opacity-100"><Trash2 className="w-4 h-4"/></button></td></tr>
        ))}</tbody>
        <tfoot className="bg-gray-50 border-t font-bold"><tr><td colSpan={4} className="p-4 text-right text-sm">Converted Total</td><td className="p-4 text-right text-sm pr-14">{formatCurrency(total)}</td></tr></tfoot>
      </table>
      <PaginationControls currentPage={currentPage} totalPages={totalPages} setCurrentPage={setCurrentPage} totalItems={sortedItems.length} />
      </Card>
    </div>
  );
};

const NewExpenseView = ({ setView, onSave, editItem, showToast, expenseCategories = [], expenses = [] }) => {
  const [formData, setFormData] = useState(editItem ? editItem : { desc: '', amount: '', currency: '₹', date: getTodayDate(), cat: expenseCategories[0] || 'General' });
  
  const handleSave = () => {
    if (!formData.desc?.trim() || !formData.amount || parseFloat(formData.amount) <= 0) return showToast('Description and a valid Amount are required.', 'error');
    const isNew = !editItem;
    onSave({ id: editItem ? editItem.id : `EXP-${(expenses.length + 1).toString().padStart(3,'0')}`, ...formData, amount: parseFloat(formData.amount) || 0 });
    showToast(`Expense ${isNew ? 'logged' : 'updated'} successfully.`);
    setView('expenses-list');
  };
  
  return (
    <div className="max-w-[1600px] w-full mx-auto p-4 sm:p-8 animate-in fade-in duration-500">
      <div className="flex items-center mb-8">
        <button onClick={() => setView('expenses-list')} className="mr-4 p-2 -ml-2 hover:bg-gray-100 rounded-lg transition-colors"><ArrowLeft className="w-5 h-5 text-gray-600" /></button>
        <h1 className="text-2xl font-bold text-gray-900">{editItem ? 'Edit Expense' : 'Log Expense'}</h1>
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div className="lg:col-span-2">
          <Card className="p-6 space-y-6">
            <div className="space-y-1">
               <label className="text-sm font-semibold text-gray-700">Merchant / Description *</label>
               <input type="text" value={formData.desc} onChange={(e) => setFormData({...formData, desc: e.target.value})} className="w-full px-4 py-2.5 bg-white border border-gray-200 rounded-md text-sm text-gray-900 focus:outline-none focus:border-[#800020]" placeholder="e.g. Uber, AWS Hosting" />
            </div>
            <div className="grid grid-cols-12 gap-6">
              <div className="col-span-12 sm:col-span-7 space-y-1">
                 <label className="text-sm font-semibold text-gray-700">Amount *</label>
                 <div className="flex relative">
                    <select value={formData.currency} onChange={e=>setFormData({...formData, currency: e.target.value})} className="pl-3 pr-8 py-2.5 bg-gray-50 border border-gray-200 rounded-l-md text-sm font-medium text-gray-700 appearance-none focus:outline-none focus:border-[#800020] border-r-0">
                       <option value="₹">INR</option><option value="$">USD</option><option value="€">EUR</option><option value="£">GBP</option>
                    </select>
                    <ChevronDown className="absolute left-14 top-3.5 w-3 h-3 text-gray-400 pointer-events-none" />
                    <input type="number" value={formData.amount} onChange={(e) => setFormData({...formData, amount: e.target.value})} className="w-full pl-4 pr-4 py-2.5 bg-white border border-gray-200 rounded-r-md text-sm text-gray-900 focus:outline-none focus:border-[#800020]" placeholder="0.00" />
                 </div>
              </div>
              <div className="col-span-12 sm:col-span-5 space-y-1">
                 <label className="text-sm font-semibold text-gray-700">Date *</label>
                 <div className="relative">
                    <input type="date" value={formData.date} onChange={(e) => setFormData({...formData, date: e.target.value})} className="w-full px-4 py-2.5 bg-white border border-gray-200 rounded-md text-sm text-gray-900 focus:outline-none focus:border-[#800020]" />
                 </div>
              </div>
            </div>
            <div className="space-y-1">
               <label className="text-sm font-semibold text-gray-700">Category</label>
               <div className="relative">
                  <select value={formData.cat} onChange={(e) => setFormData({...formData, cat: e.target.value})} className="w-full px-4 py-2.5 bg-white border border-gray-200 rounded-md text-sm text-gray-900 appearance-none focus:outline-none focus:border-[#800020]">
                     {expenseCategories.map(cat => <option key={cat} value={cat}>{cat}</option>)}
                  </select>
                  <ChevronDown className="absolute right-3 top-3 w-4 h-4 text-gray-400 pointer-events-none" />
               </div>
            </div>
            <div className="pt-2">
               <label className="flex items-center cursor-pointer">
                 <input type="checkbox" className="w-4 h-4 rounded-sm border-gray-300 text-[#800020] focus:ring-[#800020] mr-2" />
                 <span className="text-sm text-gray-700">This expense is billable to a client</span>
               </label>
            </div>
          </Card>
        </div>
        <div className="lg:col-span-1 space-y-6">
          <Card className="p-6">
            <h3 className="text-sm font-semibold text-gray-800 mb-4">Receipt</h3>
            <div className="border-2 border-dashed border-gray-300 rounded-lg p-8 flex flex-col items-center justify-center text-center hover:bg-gray-50 transition-colors cursor-pointer group">
              <div className="w-12 h-12 bg-[#FDF5F6] text-[#800020] rounded-full flex items-center justify-center mb-3 group-hover:scale-105 transition-transform">
                <UploadCloud className="w-5 h-5" />
              </div>
              <p className="text-sm font-medium text-[#800020] mb-1">Click to upload</p>
              <p className="text-xs text-gray-500">or drag and drop PDF, JPG, PNG</p>
            </div>
          </Card>
          <div className="space-y-3">
            <button onClick={handleSave} className="w-full py-2.5 bg-[#800020] hover:bg-[#5a0016] transition-colors text-white rounded-md text-sm font-medium">Save Expense</button>
            <button onClick={() => setView('expenses-list')} className="w-full py-2.5 bg-white border border-gray-200 text-gray-700 rounded-md text-sm font-medium hover:bg-gray-50 transition-colors">Cancel</button>
          </div>
        </div>
      </div>
    </div>
  );
};

const PaymentsListView = ({ data = [], confirmDelete }) => {
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('All');
  const [dateRange, setDateRange] = useState('all');
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 10;
  
  const filtered = useMemo(() => {    
    return data.filter(pay => {
      if (!pay) return false;
      const client = pay.client || '';
      const invoice = pay.invoice || '';
      const status = pay.status || '';
      const matchesSearch = client.toLowerCase().includes(search.toLowerCase()) || invoice.toLowerCase().includes(search.toLowerCase());
      const matchesFilter = filter === 'All' || status.toLowerCase() === filter.toLowerCase();
      const matchesDate = isWithinRange(pay.date, dateRange);
      return matchesSearch && matchesFilter && matchesDate;
    });  
  }, [data, search, filter, dateRange]);

  useEffect(() => setCurrentPage(1), [search, filter, dateRange]);
  const { items: sortedItems, requestSort, sortConfig } = useSortableData(filtered, { key: 'date', direction: 'descending' });
  const paginatedItems = sortedItems.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage);
  const totalPages = Math.ceil(sortedItems.length / itemsPerPage);

  return (
    <div className="max-w-[1600px] w-full mx-auto p-4 sm:p-8 space-y-6">
      <div className="flex justify-between items-center"><h1 className="text-2xl font-bold">Payments</h1><button className="flex items-center px-4 py-2 text-sm font-medium text-gray-700 bg-white border rounded-lg hover:bg-gray-50"><Download className="w-4 h-4 mr-2 text-gray-400" />Export</button></div>
      <div className="flex flex-col sm:flex-row gap-4">
        <div className="flex bg-white p-1 border rounded-lg overflow-x-auto">
          {['All', 'Completed', 'Processing', 'Failed'].map(tab => (<button key={tab} onClick={() => setFilter(tab)} className={`px-4 py-1.5 text-xs font-semibold rounded-md ${filter === tab ? 'bg-[#800020] text-white' : 'text-gray-500'}`}>{tab}</button>))}
        </div>
        <div className="flex-1 relative"><Search className="absolute left-3 top-2.5 w-4 h-4 text-gray-400"/><input type="text" value={search} onChange={e => setSearch(e.target.value)} placeholder="Search..." className="w-full pl-9 pr-4 py-2 border rounded-lg text-sm focus:outline-none focus:border-[#800020]"/></div>
        <DateRangeSelect value={dateRange} onChange={setDateRange} />
      </div>
      <Card className="p-0 overflow-hidden"><table className="w-full text-left min-w-[700px]">
        <thead className="bg-gray-50 border-b text-xs font-semibold text-gray-500 uppercase"><tr><SortableHeader label="Date" sortKey="date" currentSort={sortConfig} requestSort={requestSort} /><SortableHeader label="Payment / Invoice" sortKey="client" currentSort={sortConfig} requestSort={requestSort} /><SortableHeader label="Method" sortKey="method" currentSort={sortConfig} requestSort={requestSort} /><SortableHeader label="Status" sortKey="status" currentSort={sortConfig} requestSort={requestSort} /><SortableHeader label="Amount" sortKey="amount" currentSort={sortConfig} requestSort={requestSort} align="right" /></tr></thead>
        <tbody>{paginatedItems.map(p => (
          <tr key={p.id} className="group border-b"><td className="p-4 text-sm">{formatDateDisplay(p.date)}</td><td className="p-4 text-sm font-medium"><div className="flex flex-col"><span>{p.id || ''}</span><span className="text-xs text-gray-500">{p.client || ''} ({p.invoice || ''})</span></div></td><td className="p-4 text-sm text-gray-500">{p.method || ''}</td><td className="p-4"><StatusBadge status={p.status} /></td><td className="p-4 text-right font-bold text-sm">{formatCurrency(p.amount, p.currency)}<button onClick={() => confirmDelete('payment', p.id)} className="ml-4 text-gray-400 hover:text-red-500 opacity-0 group-hover:opacity-100"><Trash2 className="w-4 h-4"/></button></td></tr>
        ))}</tbody>
      </table>
      <PaginationControls currentPage={currentPage} totalPages={totalPages} setCurrentPage={setCurrentPage} totalItems={sortedItems.length} />
      </Card>
    </div>
  );
};

const ClientsListView = ({ data = [], setView, confirmDelete }) => {
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('All');
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 10;

  const filtered = useMemo(() => {
    return data.filter(c => {
      if (!c) return false;
      const name = c.name || '';
      const status = c.status || '';
      const matchesSearch = name.toLowerCase().includes(search.toLowerCase());
      const matchesFilter = filter === 'All' || status.toLowerCase() === filter.toLowerCase();
      return matchesSearch && matchesFilter;
    });  
  }, [data, search, filter]);

  useEffect(() => setCurrentPage(1), [search, filter]);
  const { items: sortedItems, requestSort, sortConfig } = useSortableData(filtered, { key: 'name', direction: 'ascending' });
  const paginatedItems = sortedItems.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage);
  const totalPages = Math.ceil(sortedItems.length / itemsPerPage);

  return (
    <div className="max-w-[1600px] w-full mx-auto p-4 sm:p-8 space-y-6">
      <div className="flex justify-between items-center"><h1 className="text-2xl font-bold">Clients</h1><button onClick={() => setView('new-client')} className="bg-[#800020] hover:bg-[#5a0016] transition-colors text-white px-4 py-2 rounded-lg text-sm font-medium"><Plus className="w-4 h-4 mr-2"/>Add Client</button></div>
      <div className="flex flex-col sm:flex-row gap-4">
        <div className="flex bg-white p-1 border rounded-lg overflow-x-auto">
          {['All', 'Active', 'Inactive'].map((tab) => (
            <button key={tab} onClick={() => setFilter(tab)} className={`px-4 py-1.5 text-xs font-semibold rounded-md transition-all ${filter === tab ? 'bg-[#800020] text-white shadow-sm' : 'text-gray-600 hover:text-gray-900'}`}>{tab}</button>
          ))}
        </div>
        <div className="flex-1 relative"><Search className="absolute left-3 top-2.5 w-4 h-4 text-gray-400"/><input type="text" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search clients..." className="w-full pl-9 pr-4 py-2 border rounded-lg text-sm focus:outline-none focus:border-[#800020]"/></div>
      </div>
      <Card className="p-0 overflow-hidden"><table className="w-full text-left min-w-[700px]">
        <thead className="bg-gray-50 border-b text-xs font-semibold text-gray-500 uppercase"><tr><th className="p-4 px-6 w-12 text-center"><input type="checkbox" className="rounded-sm border-gray-300" /></th><SortableHeader label="Client" sortKey="name" currentSort={sortConfig} requestSort={requestSort} /><SortableHeader label="Contact" sortKey="email" currentSort={sortConfig} requestSort={requestSort} /><SortableHeader label="Status" sortKey="status" currentSort={sortConfig} requestSort={requestSort} /><SortableHeader label="Invoiced" sortKey="invoiced" currentSort={sortConfig} requestSort={requestSort} align="right" /><SortableHeader label="Outstanding" sortKey="outstanding" currentSort={sortConfig} requestSort={requestSort} align="right" /></tr></thead>
        <tbody className="divide-y divide-gray-100">{paginatedItems.map(c => (
          <tr key={c.id} className="hover:bg-gray-50/80 cursor-pointer transition-colors group" onClick={() => setView('client-detail', c)}>
            <td className="py-4 px-6 text-center" onClick={(e) => e.stopPropagation()}><input type="checkbox" className="rounded-sm border-gray-300 text-[#2563EB] focus:ring-[#2563EB]" /></td>
            <td className="py-4 px-6"><div className="flex flex-col"><span className="font-medium text-gray-900 group-hover:text-[#800020]">{c.name || ''}</span><span className="text-xs text-gray-500">{c.id || ''}</span></div></td>
            <td className="py-4 px-6"><div className="flex flex-col"><span className="text-sm text-gray-600">{c.email || 'N/A'}</span><span className="text-xs text-gray-400">{c.phone || 'N/A'}</span></div></td>
            <td className="py-4 px-6"><StatusBadge status={c.status} /></td>
            <td className="py-4 px-6 text-right text-sm text-gray-600 font-medium">{formatCurrency(c.invoiced)}</td>
            <td className="py-4 px-6 text-right"><div className="flex justify-end items-center space-x-4"><span className="font-semibold text-gray-900">{formatCurrency(c.outstanding)}</span><button onClick={(e) => { e.stopPropagation(); confirmDelete('client', c.id); }} className="text-gray-400 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity"><Trash2 className="w-4 h-4" /></button></div></td>
          </tr>
        ))}</tbody>
      </table>
      <PaginationControls currentPage={currentPage} totalPages={totalPages} setCurrentPage={setCurrentPage} totalItems={sortedItems.length} />
      </Card>
    </div>
  );
};

const ClientDetailView = ({ setView, client, confirmDelete }) => {
  if (!client) return null;
  return (
    <div className="max-w-[1600px] w-full mx-auto p-4 sm:p-8 animate-in fade-in duration-500">
      <button onClick={() => setView('clients-list')} className="mb-6 flex items-center text-sm font-semibold text-gray-500 hover:text-gray-700 transition-colors"><ArrowLeft className="w-4 h-4 mr-2"/> Back to List</button>
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center mb-8 gap-4">
        <div>
           <div className="flex items-center gap-3"><h1 className="text-2xl font-bold text-gray-900">{client.name || ''}</h1><StatusBadge status={client.status} /></div>
           <p className="text-sm text-gray-500 mt-1">ID: {client.id || ''} • Client</p>
        </div>
        <div className="flex w-full sm:w-auto items-center space-x-3">
           <button onClick={() => confirmDelete('client', client.id)} className="flex items-center justify-center px-3 py-2 text-sm font-medium text-red-600 bg-white border border-red-100 rounded-md hover:bg-red-50 transition-colors shadow-sm"><Trash2 className="w-4 h-4" /></button>
           <button onClick={() => setView('new-client', client)} className="flex-1 sm:flex-none flex items-center justify-center px-4 py-2 bg-white border border-gray-200 text-gray-700 font-medium rounded-md hover:bg-gray-50 transition-colors shadow-sm"><Pencil className="w-4 h-4 mr-2 text-gray-500" /> Edit Profile</button>
        </div>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-6">
        <Card className="py-5"><p className="text-[11px] font-semibold text-gray-500 uppercase tracking-wide mb-2">Total Invoiced</p><h3 className="text-2xl font-bold text-gray-900">{formatCurrency(client.invoiced)}</h3></Card>
        <Card className="py-5"><p className="text-[11px] font-semibold text-gray-500 uppercase tracking-wide mb-2">Amount Paid</p><h3 className="text-2xl font-bold text-teal-600">{formatCurrency((client.invoiced || 0) - (client.outstanding || 0))}</h3></Card>
        <Card className="py-5"><p className="text-[11px] font-semibold text-gray-500 uppercase tracking-wide mb-2">Outstanding</p><h3 className="text-2xl font-bold text-amber-500">{formatCurrency(client.outstanding)}</h3></Card>
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
         <div className="lg:col-span-1 space-y-6">
            <Card className="p-6">
               <h3 className="text-sm font-semibold text-gray-800 mb-5">Contact Details</h3>
               <div className="space-y-4 text-sm">
                 <div className="flex items-start"><Mail className="w-4 h-4 text-gray-400 mt-0.5 mr-3" /><div><p className="font-medium text-gray-900 break-all">{client.email || 'N/A'}</p><p className="text-xs text-gray-500">Billing Email</p></div></div>
                 <div className="flex items-start"><Phone className="w-4 h-4 text-gray-400 mt-0.5 mr-3" /><div><p className="font-medium text-gray-900">{client.phone || 'N/A'}</p><p className="text-xs text-gray-500">Primary Phone</p></div></div>
                 <div className="flex items-start"><MapPin className="w-4 h-4 text-gray-400 mt-0.5 mr-3" /><div><p className="font-medium text-gray-900">{client.address || 'N/A'}<br/>{client.city || ''}{(client.city && client.state) ? ', ' : ''}{client.state || ''}</p></div></div>
               </div>
            </Card>
         </div>
         <div className="lg:col-span-2">
            <Card className="p-0 overflow-hidden min-h-[300px]">
               <div className="p-6 border-b border-gray-100 flex justify-between items-center"><h3 className="text-sm font-semibold text-gray-800">Recent Invoices</h3><button onClick={() => setView('new-invoice')} className="text-sm text-[#800020] font-medium hover:text-[#5a0016] flex items-center"><Plus className="w-4 h-4 mr-1"/> New Invoice</button></div>
               <div className="text-center py-20 bg-gray-50/50 h-full"><FileText className="w-8 h-8 text-gray-300 mx-auto mb-3" /><p className="text-sm font-medium text-gray-500">No recent invoices found.</p></div>
            </Card>
         </div>
      </div>
    </div>
  );
};

const NewClientView = ({ setView, onSave, editItem, showToast, clients = [] }) => {
  const [formData, setFormData] = useState(editItem ? editItem : { name: "", email: "", phone: "", address: "", city: "", state: "", postalCode: "", country: "India" });
  const handleSave = () => {
    if (!formData.name?.trim()) return showToast('Client Name is required.', 'error');
    const isNew = !editItem;
    onSave({ id: editItem ? editItem.id : `C-${(clients.length + 1).toString().padStart(3,'0')}`, ...formData, status: 'active', invoiced: editItem ? editItem.invoiced : 0, outstanding: editItem ? editItem.outstanding : 0 });
    showToast(`Client profile ${isNew ? 'created' : 'updated'} successfully.`);
    setView('clients-list');
  };
  return (
    <div className="max-w-[1600px] w-full mx-auto p-4 sm:p-8 animate-in fade-in duration-500">
      <div className="flex items-center mb-8"><button onClick={() => setView('clients-list')} className="mr-4 p-2 -ml-2 hover:bg-gray-100 rounded-lg transition-colors"><ArrowLeft className="w-5 h-5 text-gray-600" /></button><h1 className="text-2xl font-bold text-gray-900">{editItem ? 'Edit Client' : 'Add New Client'}</h1></div>
      <div className="space-y-6">
         <Card className="p-6 sm:p-8">
           <h3 className="text-lg font-bold text-gray-900 mb-6 pb-4 border-b border-gray-100">Basic Information</h3>
           <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="space-y-1"><label className="text-sm font-semibold text-gray-700">Client Name *</label><input type="text" placeholder="Individual or Company Name" value={formData.name} onChange={e => setFormData({...formData, name: e.target.value})} className="w-full px-4 py-2 bg-white border border-gray-300 rounded-md text-sm focus:outline-none focus:border-[#800020]" /></div>
              <div className="space-y-1"><label className="text-sm font-semibold text-gray-700">Email Address</label><input type="email" value={formData.email} onChange={e => setFormData({...formData, email: e.target.value})} className="w-full px-4 py-2 bg-white border border-gray-300 rounded-md text-sm focus:outline-none focus:border-[#800020]" /></div>
              <div className="space-y-1 md:col-span-2"><label className="text-sm font-semibold text-gray-700">Phone Number</label><input type="text" value={formData.phone} onChange={e => setFormData({...formData, phone: e.target.value})} className="w-full px-4 py-2 bg-white border border-gray-300 rounded-md text-sm focus:outline-none focus:border-[#800020]" /></div>
           </div>
         </Card>
         <Card className="p-6 sm:p-8">
           <h3 className="text-lg font-bold text-gray-900 mb-6 pb-4 border-b border-gray-100">Billing Address</h3>
           <div className="space-y-6">
              <div className="space-y-1"><label className="text-sm font-semibold text-gray-700">Street Address</label><input type="text" value={formData.address} onChange={e => setFormData({...formData, address: e.target.value})} className="w-full px-4 py-2 bg-white border border-gray-300 rounded-md text-sm focus:outline-none focus:border-[#800020]" /></div>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                 <div className="space-y-1">
                    <label className="text-sm font-semibold text-gray-700">State/Province</label>
                    {formData.country === 'India' ? (
                       <div className="relative"><select value={formData.state} onChange={e => { const ns = e.target.value; setFormData({...formData, state: ns, city: indiaStatesAndCities[ns]?.[0] || ''}); }} className="w-full px-4 py-2 bg-white border border-gray-300 rounded-md text-sm appearance-none focus:outline-none focus:border-[#800020]"><option value="" disabled>Select State</option>{Object.keys(indiaStatesAndCities).map(s => <option key={s} value={s}>{s}</option>)}</select><ChevronDown className="absolute right-3 top-2.5 w-4 h-4 text-gray-400 pointer-events-none" /></div>
                    ) : (<input type="text" value={formData.state} onChange={e => setFormData({...formData, state: e.target.value})} className="w-full px-4 py-2 bg-white border border-gray-300 rounded-md text-sm focus:outline-none focus:border-[#800020]" />)}
                 </div>
                 <div className="space-y-1">
                    <label className="text-sm font-semibold text-gray-700">City</label>
                    {formData.country === 'India' && formData.state && indiaStatesAndCities[formData.state] ? (
                       <div className="relative"><select value={formData.city} onChange={e => setFormData({...formData, city: e.target.value})} className="w-full px-4 py-2 bg-white border border-gray-300 rounded-md text-sm appearance-none focus:outline-none focus:border-[#800020]">{indiaStatesAndCities[formData.state].map(c => <option key={c} value={c}>{c}</option>)}</select><ChevronDown className="absolute right-3 top-2.5 w-4 h-4 text-gray-400 pointer-events-none" /></div>
                    ) : (<input type="text" value={formData.city} onChange={e => setFormData({...formData, city: e.target.value})} className="w-full px-4 py-2 bg-white border border-gray-300 rounded-md text-sm focus:outline-none focus:border-[#800020]" />)}
                 </div>
                 <div className="space-y-1"><label className="text-sm font-semibold text-gray-700">Postal Code</label><input type="text" value={formData.postalCode} onChange={e => setFormData({...formData, postalCode: e.target.value})} className="w-full px-4 py-2 bg-white border border-gray-300 rounded-md text-sm focus:outline-none focus:border-[#800020]" /></div>
              </div>
              <div className="space-y-1 md:w-1/3">
                 <label className="text-sm font-semibold text-gray-700">Country</label>
                 <div className="relative"><select value={formData.country} onChange={e => setFormData({...formData, country: e.target.value})} className="w-full px-4 py-2 bg-white border border-gray-300 rounded-md text-sm appearance-none focus:outline-none focus:border-[#800020]"><option>India</option><option>United States</option><option>United Kingdom</option><option>Germany</option></select><ChevronDown className="absolute right-3 top-2.5 w-4 h-4 text-gray-400 pointer-events-none" /></div>
              </div>
           </div>
         </Card>
         <div className="flex flex-col sm:flex-row justify-end gap-3"><button onClick={() => setView('clients-list')} className="w-full sm:w-auto px-6 py-2.5 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50 transition-colors">Cancel</button><button onClick={handleSave} className="w-full sm:w-auto px-6 py-2.5 text-sm font-medium text-white bg-[#800020] hover:bg-[#5a0016] rounded-md transition-colors shadow-sm">Save Client</button></div>
      </div>
    </div>
  );
};

const SettingsView = ({ taxProfiles = [], setTaxProfiles, expenseCategories = [], setExpenseCategories, businessProfile, setBusinessProfile, showToast }) => {
  const [activeTab, setActiveTab] = useState('business');
  const [newCat, setNewCat] = useState('');
  const [newTaxName, setNewTaxName] = useState('');
  const [newTaxRate, setNewTaxRate] = useState('');

  const addCategory = () => { if (newCat.trim() && !expenseCategories.includes(newCat.trim())) { setExpenseCategories([...expenseCategories, newCat.trim()]); setNewCat(''); showToast('Category added successfully.'); } };
  const addTax = () => { if (newTaxName.trim() && newTaxRate) { setTaxProfiles([...taxProfiles, { id: Date.now(), name: newTaxName.trim(), rate: parseFloat(newTaxRate) }]); setNewTaxName(''); setNewTaxRate(''); showToast('Tax profile added successfully.'); } };

  return (
    <div className="max-w-[1600px] w-full mx-auto p-4 sm:p-8 space-y-6 animate-in fade-in">
      <h1 className="text-2xl font-bold">Settings</h1>
      <div className="flex flex-col lg:flex-row gap-8">
        <div className="w-full lg:w-64 bg-white border rounded-xl h-fit overflow-hidden">
          {['business', 'tax', 'expense'].map(t => <button key={t} onClick={() => setActiveTab(t)} className={`w-full text-left p-4 text-sm font-medium ${activeTab === t ? 'bg-[#FDF5F6] text-[#800020] border-l-4 border-[#800020]' : 'text-gray-500'}`}>{t.charAt(0).toUpperCase() + t.slice(1)}</button>)}
        </div>
        <Card className="flex-1">
          {activeTab === 'business' && (
            <div className="space-y-6">
              <input value={businessProfile?.name || ''} onChange={e => setBusinessProfile({...businessProfile, name: e.target.value})} placeholder="Name" className="w-full p-2.5 border rounded-lg text-sm focus:border-[#800020] focus:outline-none"/>
              <input value={businessProfile?.owner || ''} onChange={e => setBusinessProfile({...businessProfile, owner: e.target.value})} placeholder="Owner" className="w-full p-2.5 border rounded-lg text-sm focus:border-[#800020] focus:outline-none"/>
              <select value={businessProfile?.state || ''} onChange={e => setBusinessProfile({...businessProfile, state: e.target.value, city: indiaStatesAndCities[e.target.value]?.[0] || ''})} className="w-full p-2.5 border rounded-lg text-sm focus:border-[#800020] focus:outline-none">
                <option value="" disabled>Select State</option>{Object.keys(indiaStatesAndCities).map(s => <option key={s} value={s}>{s}</option>)}
              </select>
              <select value={businessProfile?.city || ''} onChange={e => setBusinessProfile({...businessProfile, city: e.target.value})} className="w-full p-2.5 border rounded-lg text-sm focus:border-[#800020] focus:outline-none">
                {indiaStatesAndCities[businessProfile?.state]?.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
              <button onClick={() => showToast('Saved')} className="bg-[#800020] hover:bg-[#5a0016] text-white px-6 py-2 rounded-lg">Save</button>
            </div>
          )}
          {activeTab === 'tax' && (
            <div className="space-y-4">
              {taxProfiles.map(t => <div key={t.id} className="flex justify-between p-3 border rounded-lg"><span>{t.name} ({t.rate}%)</span>{t.id !== 1 && <Trash2 className="cursor-pointer text-gray-400 hover:text-red-500" onClick={() => setTaxProfiles(taxProfiles.filter(x => x.id !== t.id))}/>}</div>)}
              <div className="flex gap-2"><input value={newTaxName} onChange={e=>setNewTaxName(e.target.value)} placeholder="Tax Name" className="flex-1 p-2 border rounded-lg focus:border-[#800020] focus:outline-none"/><input type="number" value={newTaxRate} onChange={e=>setNewTaxRate(e.target.value)} placeholder="Rate %" className="w-24 p-2 border rounded-lg focus:border-[#800020] focus:outline-none"/><button onClick={addTax} className="p-2 bg-[#800020] hover:bg-[#5a0016] text-white rounded-lg">Add</button></div>
            </div>
          )}
          {activeTab === 'expense' && (
            <div className="space-y-4">
              {expenseCategories.map(c => <div key={c} className="flex justify-between p-3 border rounded-lg"><span>{c}</span><Trash2 className="cursor-pointer text-gray-400 hover:text-red-500" onClick={() => setExpenseCategories(expenseCategories.filter(ex => ex !== c))}/></div>)}
              <div className="flex gap-2"><input value={newCat} onChange={e => setNewCat(e.target.value)} className="flex-1 p-2 border rounded-lg focus:border-[#800020] focus:outline-none"/><button onClick={addCategory} className="p-2 bg-[#800020] hover:bg-[#5a0016] text-white rounded-lg">Add</button></div>
            </div>
          )}
        </Card>
      </div>
    </div>
  );
};

export default function App() {
  const [user, setUser] = useState(null);
  const [isAuthLoaded, setIsAuthLoaded] = useState(false);
  const [isMockLoggedIn, setIsMockLoggedIn] = useState(false);
  const [currentView, setCurrentView] = useState('dashboard');
  const [editingItem, setEditingItem] = useState(null);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [isFabMenuOpen, setIsFabMenuOpen] = useState(false);

  useEffect(() => {
    if (!auth) {
       setIsAuthLoaded(true);
       return;
    }
 
    // 1. Immediately set up the listener to catch the initial auth state
    // and any subsequent changes. This is a synchronous operation.
    const unsubscribe = onAuthStateChanged(auth, (usr) => {
      setUser(usr);
      setIsAuthLoaded(true);
    });
 
    // 2. Asynchronously perform the initial sign-in.
    // The onAuthStateChanged listener above will handle the result.
    const performInitialSignIn = async () => {
      try {
        if (typeof __initial_auth_token !== 'undefined' && __initial_auth_token) {
          await signInWithCustomToken(auth, __initial_auth_token);
        } else {
          await signInAnonymously(auth);
        }
      } catch (e) {
        console.error("Initial sign-in failed:", e);
      }
    };
 
    performInitialSignIn();
 
    // 3. Return the cleanup function for the listener.
    return () => unsubscribe();
  }, []); // The 'auth' object is a stable singleton, so we can use an empty dependency array.

  const [invoices, setInvoices] = useLocalStorageState('invoices', initialInvoices);
  const [expenses, setExpenses] = useLocalStorageState('expenses', initialExpenses);
  const [clients, setClients] = useLocalStorageState('clients', initialClients);
  const [payments, setPayments] = useLocalStorageState('payments', initialPayments);
  const [deductions, setDeductions] = useLocalStorageState('deductions', initialDeductions);
  const [taxProfiles, setTaxProfiles] = useLocalStorageState('tax_profiles', initialTaxProfiles);
  const [expenseCategories, setExpenseCategories] = useLocalStorageState('expense_categories', initialExpenseCategories);
  const [businessProfile, setBusinessProfile] = useLocalStorageState('business_profile', initialBusinessProfile);
  
  const [modals, setModals] = useState({ deduction: false, payment: false });
  const [toast, setToast] = useState({ show: false, message: '', type: 'success' });
  const [deleteReq, setDeleteReq] = useState({ show: false, type: null, id: null });

  const showToast = (message, type = 'success') => setToast({ show: true, message, type });

  const confirmDelete = (type, id) => {
    setDeleteReq({ show: true, type, id });
  };

  const detailedInvoices = useMemo(() => invoices.map(inv => {
    if (!inv) return null;
    const invPay = payments.filter(p => p && p.invoice === inv.id);
    const invDed = deductions.filter(d => d && d.invoice === inv.id);
    const paid = invPay.reduce((s, p) => s + (p.amount || 0), 0);
    const deducted = invDed.reduce((s, d) => s + (d.amount || 0), 0);
    return { ...inv, paid, deducted, balance: Math.max(0, (inv.amount || 0) - paid - deducted) };
  }).filter(Boolean), [invoices, payments, deductions]);

  const detailedEditingItem = useMemo(() => {
     if (!editingItem) return null;
     if (currentView === 'invoice-detail') {
        return detailedInvoices.find(i => i && i.id === editingItem.id) || editingItem;
     }
     return editingItem;
  }, [editingItem, detailedInvoices, currentView]);

  const enrichedClients = useMemo(() => clients.map(client => {
    if (!client) return null;
    const clientInvs = detailedInvoices.filter(i => i && i.client === client.name && i.status !== 'draft');
    return { ...client, invoiced: clientInvs.reduce((s, i) => s + convertToHome(i.amount, i.currency), 0), outstanding: clientInvs.reduce((s, i) => s + convertToHome(i.balance, i.currency), 0) };
  }).filter(Boolean), [clients, detailedInvoices]);

  const navigate = (view, item = null) => { 
    setCurrentView(view); 
    setEditingItem(item); 
    setIsMobileMenuOpen(false);
    window.scrollTo(0,0); 
  };

  const updateInvoiceStatusBasedOnBalance = (invoiceId) => {
     if(!invoiceId) return;
     setInvoices(prev => prev.map(inv => {
        if (!inv || inv.id !== invoiceId) return inv;
        const paid = payments.filter(p => p && p.invoice === inv.id).reduce((s,p)=>s+(p.amount||0),0);
        const deducted = deductions.filter(d => d && d.invoice === inv.id).reduce((s,d)=>s+(d.amount||0),0);
        const balance = (inv.amount || 0) - paid - deducted;
        
        let newStatus = inv.status;
        if (balance <= 0) newStatus = 'paid';
        else if (paid > 0 || deducted > 0) newStatus = 'partial';
        
        return { ...inv, status: newStatus };
     }));
  };

  const handleSavePayment = (pay) => {
    setPayments([pay, ...payments]);
    showToast(`Recorded ${formatCurrency(pay.amount, pay.currency)}`);
    setTimeout(() => updateInvoiceStatusBasedOnBalance(pay.invoice), 0);
  };

  const handleSaveDeduction = (ded) => {
    setDeductions([ded, ...deductions]);
    showToast(`Deduction of ${formatCurrency(ded.amount, '₹')} recorded successfully.`);
    setTimeout(() => updateInvoiceStatusBasedOnBalance(ded.invoice), 0);
  };

  const updateInvoices = (inv) => {
    const exists = invoices.find(i => i && i.id === inv.id);
    if (exists) setInvoices(invoices.map(i => (i && i.id === inv.id) ? inv : i));
    else setInvoices([inv, ...invoices]);
  };

  const updateExpenses = (exp) => {
    const exists = expenses.find(e => e && e.id === exp.id);
    if (exists) setExpenses(expenses.map(e => (e && e.id === exp.id) ? exp : e));
    else setExpenses([exp, ...expenses]);
  };

  const updateClients = (client) => {
    const exists = clients.find(c => c && c.id === client.id);
    if (exists) setClients(clients.map(c => (c && c.id === client.id) ? client : c));
    else setClients([client, ...clients]);
  };

  const executeDelete = () => {
    const { type, id } = deleteReq;
    if (type === 'invoice') {
      setInvoices(invoices.filter(i => i.id !== id));
      if (currentView === 'invoice-detail' && editingItem?.id === id) navigate('invoices-list');
    } else if (type === 'expense') {
      setExpenses(expenses.filter(e => e.id !== id));
    } else if (type === 'client') {
      setClients(clients.filter(c => c.id !== id));
      if (currentView === 'client-detail' && editingItem?.id === id) navigate('clients-list');
    } else if (type === 'payment') {
      setPayments(payments.filter(p => p.id !== id));
      setTimeout(() => updateInvoiceStatusBasedOnBalance(payments.find(p=>p.id===id)?.invoice), 0);
    }
    showToast(`${type.charAt(0).toUpperCase() + type.slice(1)} deleted successfully.`);
  };

  const handleFabClick = () => {
    if (currentView === 'invoices-list') navigate('new-invoice');
    else if (currentView === 'expenses-list') navigate('new-expense');
    else if (currentView === 'clients-list') navigate('new-client');
    else if (currentView === 'dashboard') setIsFabMenuOpen(!isFabMenuOpen);
  };

  if (!isMockLoggedIn) return <LoginView onLogin={() => setIsMockLoggedIn(true)} />;
  if (!isAuthLoaded) return <div className="flex h-screen items-center justify-center bg-gray-50"><Loader2 className="animate-spin text-[#800020] w-12 h-12"/></div>;

  return (
    <div className="flex flex-row h-screen w-full bg-[#F9FAFB] font-sans selection:bg-[#f9a8d4] overflow-hidden">
      
      {/* Mobile Header */}
      <div className="md:hidden fixed top-0 left-0 right-0 h-16 bg-white border-b border-gray-200 flex items-center justify-between px-4 z-20">
        <div className="flex items-center">
          <InvoiceOnLogo className="w-8 h-8 mr-2 shrink-0" /><span className="text-xl font-bold">Invoice<span className="text-[#800020]">On</span></span>
        </div>
        <button onClick={() => setIsMobileMenuOpen(true)} className="p-2"><Menu className="w-6 h-6" /></button>
      </div>

      {/* Mobile Overlay */}
      {isMobileMenuOpen && <div className="fixed inset-0 bg-gray-900/40 z-30 md:hidden" onClick={() => setIsMobileMenuOpen(false)}></div>}

      {/* Fixed Desktop Sidebar */}
      <aside className={`fixed inset-y-0 left-0 z-40 w-64 bg-white border-r border-gray-200 flex flex-col transition-transform ${isMobileMenuOpen ? 'translate-x-0' : '-translate-x-full'} md:translate-x-0 h-full`}>
        <div className="flex-1 overflow-y-auto">
          <div className="p-6 flex items-center justify-between">
            <div className="flex items-center"><InvoiceOnLogo className="w-8 h-8 mr-2 shrink-0" /><span className="text-xl font-bold">Invoice<span className="text-[#800020]">On</span></span></div>
            <button onClick={() => setIsMobileMenuOpen(false)} className="md:hidden"><X className="w-5 h-5" /></button>
          </div>
          <nav className="px-3 space-y-1 flex-1 overflow-y-auto">
            <NavItem icon={LayoutDashboard} label="Dashboard" active={currentView === 'dashboard'} onClick={() => navigate('dashboard')}/>
            
            <div className="pt-6 pb-2 px-4 text-[10px] font-bold text-gray-400 uppercase tracking-widest">Sales</div>
            <NavItem icon={FileText} label="Invoices" active={currentView.includes('invoice')} onClick={() => navigate('invoices-list')}/>
            <NavItem icon={CreditCard} label="Payments" active={currentView === 'payments-list'} onClick={() => navigate('payments-list')}/>
            <NavItem icon={Users} label="Clients" active={currentView.includes('client')} onClick={() => navigate('clients-list')}/>
            
            <div className="pt-6 pb-2 px-4 text-[10px] font-bold text-gray-400 uppercase tracking-widest">Spending</div>
            <NavItem icon={Receipt} label="Expenses" active={currentView.includes('expense')} onClick={() => navigate('expenses-list')}/>
          </nav>
        </div>
        <div className="p-3 border-t"><NavItem icon={Settings} label="Settings" active={currentView === 'settings'} onClick={() => navigate('settings')}/></div>
      </aside>

      {/* Main Area */}
      <main className="flex-1 h-full overflow-y-auto bg-gray-50 relative z-0 flex flex-col pt-16 md:pt-0 md:ml-64">
        {currentView === 'dashboard' && <DashboardView setView={navigate} clients={enrichedClients} invoices={detailedInvoices} expenses={expenses} payments={payments} deductions={deductions} businessProfile={businessProfile}/>}
        {currentView === 'invoices-list' && <InvoicesListView data={detailedInvoices} setView={navigate} confirmDelete={confirmDelete}/>}
        {currentView === 'invoice-detail' && <InvoiceDetailView setView={navigate} invoice={detailedEditingItem} onOpenPayment={()=>setModals({...modals,payment:true})} onOpenDeduction={()=>setModals({...modals,deduction:true})} confirmDelete={confirmDelete} clients={enrichedClients}/>}
        {currentView === 'new-invoice' && <NewInvoiceView clients={enrichedClients} setView={navigate} onSave={updateInvoices} editItem={detailedEditingItem} taxProfiles={taxProfiles} showToast={showToast} invoices={invoices} />}
        {currentView === 'expenses-list' && <ExpensesListView data={expenses} setView={navigate} confirmDelete={confirmDelete} expenseCategories={expenseCategories}/>}
        {currentView === 'new-expense' && <NewExpenseView expenseCategories={expenseCategories} onSave={updateExpenses} setView={navigate} editItem={editingItem} showToast={showToast} expenses={expenses} />}
        {currentView === 'clients-list' && <ClientsListView data={enrichedClients} setView={navigate} confirmDelete={confirmDelete}/>}
        {currentView === 'client-detail' && <ClientDetailView client={enrichedClients.find(c=>c && c.id===editingItem?.id)} setView={navigate} confirmDelete={confirmDelete}/>}
        {currentView === 'new-client' && <NewClientView onSave={updateClients} setView={navigate} editItem={editingItem} showToast={showToast} clients={clients} />}
        {currentView === 'payments-list' && <PaymentsListView data={payments} confirmDelete={confirmDelete}/>}
        {currentView === 'settings' && <SettingsView businessProfile={businessProfile || {}} setBusinessProfile={setBusinessProfile} taxProfiles={taxProfiles} setTaxProfiles={setTaxProfiles} expenseCategories={expenseCategories} setExpenseCategories={setExpenseCategories} showToast={showToast}/>}
        
        {/* Contextual Floating Action Button */}
        {['dashboard', 'invoices-list', 'expenses-list', 'clients-list'].includes(currentView) && (
          <div className="fixed bottom-8 right-8 z-40 flex flex-col items-end">
            {currentView === 'dashboard' && isFabMenuOpen && (
              <>
                <div className="fixed inset-0 z-30" onClick={() => setIsFabMenuOpen(false)}></div>
                <div className="mb-4 bg-white border border-gray-100 rounded-xl shadow-xl p-2 w-48 animate-in slide-in-from-bottom-2 duration-200 z-40 relative">
                  <button onClick={() => navigate('new-invoice')} className="w-full text-left px-4 py-2.5 text-sm font-medium text-gray-700 hover:bg-[#FDF5F6] hover:text-[#800020] rounded-lg flex items-center transition-colors"><FileText className="w-4 h-4 mr-3 text-[#800020]"/>New Invoice</button>
                  <button onClick={() => navigate('new-expense')} className="w-full text-left px-4 py-2.5 text-sm font-medium text-gray-700 hover:bg-[#FDF5F6] hover:text-[#800020] rounded-lg flex items-center transition-colors"><Receipt className="w-4 h-4 mr-3 text-[#800020]"/>Log Expense</button>
                  <button onClick={() => navigate('new-client')} className="w-full text-left px-4 py-2.5 text-sm font-medium text-gray-700 hover:bg-[#FDF5F6] hover:text-[#800020] rounded-lg flex items-center transition-colors"><Users className="w-4 h-4 mr-3 text-[#800020]"/>Add Client</button>
                </div>
              </>
            )}
            <button onClick={handleFabClick} className="w-14 h-14 bg-[#800020] hover:bg-[#5a0016] text-white rounded-full shadow-lg flex items-center justify-center transition-transform hover:scale-105 active:scale-95 z-40 relative">
              {currentView === 'dashboard' && isFabMenuOpen ? <X className="w-6 h-6" /> : <Plus className="w-6 h-6" />}
            </button>
          </div>
        )}
      </main>
      {modals.payment && <RecordPaymentModal isOpen={modals.payment} onClose={()=>setModals({...modals,payment:false})} invoice={detailedEditingItem} onSave={handleSavePayment} showToast={showToast} payments={payments} />}
      {modals.deduction && <RecordDeductionModal isOpen={modals.deduction} onClose={()=>setModals({...modals,deduction:false})} invoice={detailedEditingItem} onSave={handleSaveDeduction} showToast={showToast} deductions={deductions} />}
      {toast.show && <Toast {...toast} onClose={()=>setToast({...toast,show:false})}/>}
      {deleteReq.show && <ConfirmModal {...deleteReq} onClose={()=>setDeleteReq({...deleteReq,show:false})} onConfirm={executeDelete}/>}
    </div>
  );
}