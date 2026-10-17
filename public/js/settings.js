/**
 * Display settings
 * ----------------
 * Units, clock style, and preview language, stored in this browser. Every
 * formatter in format.js reads from `settings`, so changing one and
 * re-rendering is enough to switch the whole UI.
 *
 * The infrastructure category table is the only app-generated text that gets
 * a real translation table; place and facility names come from OpenStreetMap's
 * own name:* tags, never machine translation.
 *
 * localStorage is guarded so this module also loads under Node for tests.
 */
const SETTINGS_KEY = "geoscope-settings";
const DEFAULTS = { dist: "both", temp: "both", clock: "12", lang: "en", infraLang: "off" };

const storage = typeof localStorage !== "undefined" ? localStorage : null;

function loadStored() {
  try { return JSON.parse(storage?.getItem(SETTINGS_KEY) || "{}") || {}; }
  catch { return {}; } // a corrupt entry must not take the whole app down
}

export const settings = Object.assign({}, DEFAULTS, loadStored());

export function saveSettings() {
  try { storage?.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch { /* private mode / quota */ }
}

/* must match the labels in sources/infrastructure.js (checked by a test) */
export const INFRA_LABEL_ORDER = ["Hospitals", "Clinics", "Schools", "Universities", "Police stations", "Fire stations", "Supermarkets", "Places of worship", "Rail stations", "Airports & airfields", "Parks", "Museums"];

export const INFRA_I18N = {
  es: ["Hospitales", "Clínicas", "Escuelas", "Universidades", "Comisarías", "Estaciones de bomberos", "Supermercados", "Lugares de culto", "Estaciones de tren", "Aeropuertos y aeródromos", "Parques", "Museos"],
  fr: ["Hôpitaux", "Cliniques", "Écoles", "Universités", "Commissariats", "Casernes de pompiers", "Supermarchés", "Lieux de culte", "Gares ferroviaires", "Aéroports et aérodromes", "Parcs", "Musées"],
  de: ["Krankenhäuser", "Kliniken", "Schulen", "Universitäten", "Polizeiwachen", "Feuerwachen", "Supermärkte", "Gotteshäuser", "Bahnhöfe", "Flughäfen und Flugplätze", "Parks", "Museen"],
  pt: ["Hospitais", "Clínicas", "Escolas", "Universidades", "Delegacias", "Quartéis de bombeiros", "Supermercados", "Locais de culto", "Estações ferroviárias", "Aeroportos e aeródromos", "Parques", "Museus"],
  it: ["Ospedali", "Cliniche", "Scuole", "Università", "Stazioni di polizia", "Caserme dei vigili del fuoco", "Supermercati", "Luoghi di culto", "Stazioni ferroviarie", "Aeroporti e aviosuperfici", "Parchi", "Musei"],
  nl: ["Ziekenhuizen", "Klinieken", "Scholen", "Universiteiten", "Politiebureaus", "Brandweerkazernes", "Supermarkten", "Gebedshuizen", "Treinstations", "Luchthavens en vliegvelden", "Parken", "Musea"],
  pl: ["Szpitale", "Kliniki", "Szkoły", "Uniwersytety", "Komisariaty", "Remizy strażackie", "Supermarkety", "Miejsca kultu", "Stacje kolejowe", "Lotniska", "Parki", "Muzea"],
  sv: ["Sjukhus", "Kliniker", "Skolor", "Universitet", "Polisstationer", "Brandstationer", "Stormarknader", "Gudstjänstlokaler", "Järnvägsstationer", "Flygplatser", "Parker", "Museer"],
  ru: ["Больницы", "Клиники", "Школы", "Университеты", "Полицейские участки", "Пожарные части", "Супермаркеты", "Места богослужения", "Ж/д станции", "Аэропорты и аэродромы", "Парки", "Музеи"],
  uk: ["Лікарні", "Клініки", "Школи", "Університети", "Поліцейські відділки", "Пожежні частини", "Супермаркети", "Місця богослужінь", "Залізничні станції", "Аеропорти та аеродроми", "Парки", "Музеї"],
  tr: ["Hastaneler", "Klinikler", "Okullar", "Üniversiteler", "Polis karakolları", "İtfaiye istasyonları", "Süpermarketler", "İbadet yerleri", "Tren istasyonları", "Havalimanları", "Parklar", "Müzeler"],
  ar: ["المستشفيات", "العيادات", "المدارس", "الجامعات", "مراكز الشرطة", "محطات الإطفاء", "محلات السوبر ماركت", "دور العبادة", "محطات القطار", "المطارات", "الحدائق", "المتاحف"],
  fa: ["بیمارستان‌ها", "درمانگاه‌ها", "مدارس", "دانشگاه‌ها", "کلانتری‌ها", "ایستگاه‌های آتش‌نشانی", "سوپرمارکت‌ها", "اماکن عبادی", "ایستگاه‌های قطار", "فرودگاه‌ها", "پارک‌ها", "موزه‌ها"],
  he: ["בתי חולים", "מרפאות", "בתי ספר", "אוניברסיטאות", "תחנות משטרה", "תחנות כיבוי אש", "סופרמרקטים", "מקומות פולחן", "תחנות רכבת", "שדות תעופה", "פארקים", "מוזיאונים"],
  hi: ["अस्पताल", "क्लिनिक", "स्कूल", "विश्वविद्यालय", "पुलिस थाने", "दमकल केंद्र", "सुपरमार्केट", "पूजा स्थल", "रेलवे स्टेशन", "हवाई अड्डे", "पार्क", "संग्रहालय"],
  zh: ["医院", "诊所", "学校", "大学", "警察局", "消防站", "超市", "宗教场所", "火车站", "机场", "公园", "博物馆"],
  ja: ["病院", "クリニック", "学校", "大学", "警察署", "消防署", "スーパーマーケット", "礼拝所", "鉄道駅", "空港", "公園", "博物館"],
  ko: ["병원", "의원", "학교", "대학교", "경찰서", "소방서", "슈퍼마켓", "예배 장소", "기차역", "공항", "공원", "박물관"],
  vi: ["Bệnh viện", "Phòng khám", "Trường học", "Đại học", "Đồn cảnh sát", "Trạm cứu hỏa", "Siêu thị", "Nơi thờ tự", "Ga đường sắt", "Sân bay", "Công viên", "Bảo tàng"],
  id: ["Rumah sakit", "Klinik", "Sekolah", "Universitas", "Kantor polisi", "Pos pemadam kebakaran", "Supermarket", "Tempat ibadah", "Stasiun kereta", "Bandara", "Taman", "Museum"],
};

/* an infrastructure category label in the display language (when enabled) */
export function tInfra(label) {
  if (settings.infraLang !== "on" || settings.lang === "en") return label;
  const i = INFRA_LABEL_ORDER.indexOf(label);
  return (INFRA_I18N[settings.lang] && i >= 0 && INFRA_I18N[settings.lang][i]) || label;
}

/* display form for an OSM-named thing: "translated (original)" when they differ */
export function localized(name, localName) {
  return localName && localName !== name ? `${localName} (${name})` : name;
}
