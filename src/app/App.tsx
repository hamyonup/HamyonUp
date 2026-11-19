import { useState, useRef, useCallback, useEffect } from "react";
import { toast, Toaster } from "sonner";
import { cancelAssistantReminders, scheduleAssistantReminders } from "./device-notifications";
import {
  Home, Target, Settings, Plus, Wallet, TrendingDown, TrendingUp, Bell, BellOff, Store, ShoppingBag,
  Pencil, Trash2, Camera, Sun, Moon, Check, X,
  BookOpen, Bus, Coffee, Gamepad2, MoreHorizontal,
  Info, HelpCircle, ChevronDown, ChevronUp, PiggyBank, Shield,
  Trophy, Star, Zap,
  Globe2, Music2, Volume2, VolumeX, MessageCircle, Sparkles,
} from "lucide-react";

// ─── Sound system ─────────────────────────────────────────────────────────────

let _audioCtx: AudioContext | null = null;
let _sfxEnabled = true;
function getAudioCtx() {
  if (!_audioCtx) _audioCtx = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
  if (_audioCtx.state === "suspended") _audioCtx.resume();
  return _audioCtx;
}
function note(freq: number, dur: number, type: OscillatorType = "sine", vol = 0.12) {
  if (!_sfxEnabled) return;
  try {
    const ctx = getAudioCtx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain); gain.connect(ctx.destination);
    osc.type = type; osc.frequency.value = freq;
    gain.gain.setValueAtTime(vol, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + dur);
    osc.start(); osc.stop(ctx.currentTime + dur);
  } catch { /* ignore */ }
}
const sfx = {
  splash:    () => { [523, 659, 784, 1047].forEach((f, i) => setTimeout(() => note(f, 0.5, "sine", 0.1), i * 130)); },
  click:     () => note(750, 0.07, "sine", 0.07),
  save:      () => { note(880, 0.1, "sine", 0.1); setTimeout(() => note(1100, 0.15, "sine", 0.08), 80); },
  delete:    () => note(180, 0.18, "triangle", 0.08),
  nav:       () => note(550, 0.06, "sine", 0.06),
  toggleOn:  () => { note(500, 0.07, "sine", 0.07); setTimeout(() => note(720, 0.1, "sine", 0.06), 60); },
  toggleOff: () => { note(720, 0.07, "sine", 0.07); setTimeout(() => note(500, 0.1, "sine", 0.06), 60); },
  goalDone:  () => { [784, 988, 1175, 1568].forEach((f, i) => setTimeout(() => note(f, 0.3, "sine", 0.11), i * 100)); },
  coin:      () => { note(1047, 0.1, "sine", 0.09); setTimeout(() => note(1319, 0.15, "sine", 0.07), 70); },
  levelUp:   () => { [523, 659, 784, 1047, 1319].forEach((f, i) => setTimeout(() => note(f, 0.2, "sine", 0.13), i * 90)); },
};

function helperChirp(mood: string, skin?: string) {
  const patterns: Record<string, number[]> = {
    "😴": [392], "🥱": [349, 392], "👀": [740, 988], "🤔": [523, 659], "🧐": [587, 740],
    "✨": [880, 1175], "😉": [659, 880], "🥰": [784, 988, 1175], "😢": [494, 392],
    "😭": [440, 370, 330], "😠": [330, 440], "😤": [392, 330], "😎": [587, 784],
    "🤩": [784, 1047, 1319], "😲": [587, 1047], "😳": [740, 587], "🥳": [784, 988, 1175],
    "😇": [659, 784, 988], "😋": [659, 784], "🤗": [587, 740, 880], "🤫": [523],
  };
  const tones = patterns[mood] ?? [659, 880];
  const pitch = skin === "helper_leaf" ? 0.9 : skin === "helper_nebula" ? 1.14 : skin === "helper_royal" ? 1.04 : 1;
  const wave: OscillatorType = skin === "helper_leaf" ? "triangle" : skin === "helper_royal" ? "sine" : "sine";
  tones.forEach((frequency, index) => window.setTimeout(() => note(frequency * pitch, 0.13, wave, 0.045), index * (skin === "helper_nebula" ? 75 : 95)));
}

// ─── Music Synthesizer ────────────────────────────────────────────────────────

class MusicSynth {
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private _playing = false;
  private timerID: ReturnType<typeof setTimeout> | null = null;
  private nextNoteTime = 0;
  private currentBeat = 0;
  private mode: "snake" | "memory" | "math" = "snake";
  private readonly beatDur = 60 / 108;
  private readonly lookahead = 0.25;
  private readonly schedInterval = 35;

  private bassLine = [130.8, 98.0,  110.0, 146.8, 130.8, 98.0,  123.5, 110.0];
  private melody   = [523.3, 0,     659.3, 587.3, 493.9, 0,     587.3, 523.3];
  private harmony  = [329.6, 0,     392.0, 349.2, 293.7, 0,     349.2, 329.6];

  private ensureCtx(): boolean {
    if (!this.ctx) {
      try {
        this.ctx = new AudioContext();
        this.masterGain = this.ctx.createGain();
        this.masterGain.gain.value = 0.28;
        this.masterGain.connect(this.ctx.destination);
      } catch { return false; }
    }
    if (this.ctx.state === "suspended") this.ctx.resume();
    return true;
  }

  private schedNote(freq: number, time: number, dur: number, type: OscillatorType = "sine", vol = 0.1) {
    if (!freq || !this.ctx || !this.masterGain) return;
    try {
      const osc = this.ctx.createOscillator();
      const g = this.ctx.createGain();
      osc.connect(g); g.connect(this.masterGain);
      osc.type = type; osc.frequency.value = freq;
      g.gain.setValueAtTime(0, time);
      g.gain.linearRampToValueAtTime(vol, time + 0.015);
      g.gain.exponentialRampToValueAtTime(0.001, time + dur);
      osc.start(time); osc.stop(time + dur + 0.02);
    } catch { /* ignore */ }
  }

  private scheduler() {
    if (!this.ctx) return;
    const track = this.mode === "memory"
      ? { bass: [110, 98, 130.8, 146.8, 110, 82.4, 98, 123.5], melody: [659.3, 0, 523.3, 587.3, 0, 493.9, 587.3, 0], harmony: [392, 0, 329.6, 349.2, 392, 0, 293.7, 349.2], beat: 60 / 90 }
      : this.mode === "math"
        ? { bass: [146.8, 146.8, 196, 164.8, 130.8, 164.8, 196, 220], melody: [784, 659.3, 880, 0, 987.8, 880, 1046.5, 0], harmony: [392, 493.9, 587.3, 0, 440, 523.3, 659.3, 0], beat: 60 / 124 }
        : { bass: this.bassLine, melody: this.melody, harmony: this.harmony, beat: this.beatDur };
    while (this.nextNoteTime < this.ctx.currentTime + this.lookahead) {
      const beat = this.currentBeat % 8;
      const t = this.nextNoteTime;
      this.schedNote(track.bass[beat], t, track.beat * 0.65, "sine", 0.13);
      if (track.melody[beat]) this.schedNote(track.melody[beat], t + track.beat * 0.1, track.beat * 0.48, "triangle", 0.075);
      if (track.harmony[beat] && beat % 2 === 1) this.schedNote(track.harmony[beat], t + 0.03, track.beat * 0.38, "sine", 0.045);
      this.schedNote(7800, t, 0.025, "square", 0.03);
      this.schedNote(7800, t + this.beatDur * 0.5, 0.018, "square", 0.018);
      this.currentBeat++;
      this.nextNoteTime += track.beat;
    }
  }

  play(mode: "snake" | "memory" | "math" = "snake") {
    if (this._playing && this.mode === mode) return;
    if (this._playing) this.pause();
    if (!this.ensureCtx()) return;
    this.mode = mode;
    this._playing = true;
    this.nextNoteTime = (this.ctx?.currentTime ?? 0) + 0.05;
    this.currentBeat = 0;
    const tick = () => {
      if (!this._playing) return;
      this.scheduler();
      this.timerID = setTimeout(tick, this.schedInterval);
    };
    tick();
  }

  pause() {
    this._playing = false;
    if (this.timerID !== null) { clearTimeout(this.timerID); this.timerID = null; }
  }

  get isPlaying() { return this._playing; }
}

const musicSynth = new MusicSynth();

// ─── Types ───────────────────────────────────────────────────────────────────

interface User { name: string; avatar: string | null; id: string; }
interface Expense { id: string; date: string; amount: number; category: string; note: string; }
interface MoneyEvent { id: string; date: string; amount: number; kind: "earned" | "saved"; goalName?: string; }
interface Goal { id: string; title: string; target: number; saved: number; emoji: string; achievedAt?: string; }
interface LeaderboardEntry { id: string; name: string; coins: number; avatar: string | null; updatedAt: number; }
type Tab = "home" | "goals" | "market" | "games" | "settings";
type Theme = "light" | "dark" | "midnight" | "orange";
type Language = "uz" | "en" | "ru";
type Currency = "UZS" | "RUB" | "USD";
type CosmeticSlot = "avatar" | "name" | "theme" | "helper";
interface CosmeticItem { id: string; slot: CosmeticSlot; price: number; title: [string, string, string]; description: [string, string, string]; icon: string; }

const COSMETICS: CosmeticItem[] = [
  { id: "avatar_aurora", slot: "avatar", price: 0, title: ["Aurora halqasi", "Aurora Frame", "Рамка «Аврора»"], description: ["Profil rasmingizni yaltiroq aurora bilan bezang.", "A shimmering aurora frame for your profile.", "Сияющая рамка аврора для вашего профиля."], icon: "🌌" },
  { id: "avatar_bloom", slot: "avatar", price: 0, title: ["Gul naqshi", "Bloom Frame", "Цветочная рамка"], description: ["Yumshoq gul ranglari va nafis yaproqlar.", "Soft floral colors and delicate leaves.", "Мягкие цветочные оттенки и изящные листья."], icon: "🌸" },
  { id: "avatar_comet", slot: "avatar", price: 0, title: ["Kometa izi", "Comet Trail", "След кометы"], description: ["Profilingiz atrofida yulduzli kometa izi.", "A sparkling comet trail around your profile.", "Искрящийся след кометы вокруг профиля."], icon: "☄️" },
  { id: "name_mint", slot: "name", price: 0, title: ["Yalpiz nuri", "Mint Glow", "Мятное сияние"], description: ["Nik uchun yengil yashil nur.", "A fresh mint glow for your name.", "Свежее мятное сияние для имени."], icon: "🍃" },
  { id: "name_rose", slot: "name", price: 0, title: ["Atirgul jilo", "Rose Shimmer", "Розовый блеск"], description: ["Ismingizni nafis pushti rangda ajrating.", "Highlight your name with a rose shimmer.", "Выделите имя нежным розовым блеском."], icon: "🌷" },
  { id: "name_solar", slot: "name", price: 0, title: ["Quyosh uchquni", "Solar Spark", "Солнечная искра"], description: ["Nik yonida jonli oltin uchqunlar.", "Bright golden sparks beside your name.", "Яркие золотые искры рядом с именем."], icon: "✨" },
  { id: "theme_sakura", slot: "theme", price: 0, title: ["Sakura tongi", "Sakura Dawn", "Рассвет сакуры"], description: ["Yengil pushti va gilos guli ranglaridagi ko'rinish.", "A light cherry-blossom inspired app theme.", "Светлая тема в оттенках цветущей сакуры."], icon: "🌸" },
  { id: "theme_ocean", slot: "theme", price: 0, title: ["Okean marvaridi", "Ocean Pearl", "Океанская жемчужина"], description: ["Moviy to'lqinlar va salqin dengiz ohanglari.", "Cool sea tones with a polished ocean feel.", "Прохладные морские оттенки и синие волны."], icon: "🌊" },
  { id: "theme_cosmos", slot: "theme", price: 0, title: ["Kosmik tun", "Cosmic Night", "Космическая ночь"], description: ["Yulduzli binafsha ranglardagi tungi ko'rinish.", "A starry, deep-violet night theme.", "Звёздная ночная тема в глубоких фиолетовых тонах."], icon: "🪐" },
  { id: "helper_leaf", slot: "helper", price: 0, title: ["Yaproq yordamchi", "Leaf Buddy", "Листочек"], description: ["Yumshoq yashil rang va bargli bezaklar.", "Soft green colors with leafy details.", "Мягкие зелёные оттенки и листовой декор."], icon: "🌱" },
  { id: "helper_nebula", slot: "helper", price: 0, title: ["Tumanlik yordamchi", "Nebula Buddy", "Туманность"], description: ["Kosmik binafsha jilo va yulduzcha.", "Cosmic violet shine with a tiny star.", "Космическое сияние и маленькая звезда."], icon: "🌠" },
  { id: "helper_royal", slot: "helper", price: 0, title: ["Qirollik yordamchi", "Royal Buddy", "Королевский помощник"], description: ["Toj va oltin rangli maxsus ko'rinish.", "A premium golden look with a little crown.", "Особый золотой образ с маленькой короной."], icon: "👑" },
];

let ACTIVE_LANGUAGE: Language = "uz";
let ACTIVE_CURRENCY: Currency = "UZS";
function tr(uz: string, en: string, ru: string) {
  return ACTIVE_LANGUAGE === "en" ? en : ACTIVE_LANGUAGE === "ru" ? ru : uz;
}
function activeLocale() {
  return ACTIVE_LANGUAGE === "en" ? "en-US" : ACTIVE_LANGUAGE === "ru" ? "ru-RU" : "uz-UZ";
}

const TEXT: Record<string, [string, string]> = {
  "Ovqat": ["Food", "Еда"], "Transport": ["Transport", "Транспорт"], "Maktab": ["School", "Школа"],
  "Xarid": ["Shopping", "Покупки"], "O'yin": ["Game", "Игра"], "Boshqa": ["Other", "Другое"],
  "Boshlang'ich": ["Beginner", "Начальный"], "Tajribali": ["Skilled", "Опытный"], "Ustoz": ["Master", "Мастер"],
  "Chempion": ["Champion", "Чемпион"], "Afsonaviy": ["Legendary", "Легендарный"],
  "Ilova qanday ishlaydi?": ["How does the app work?", "Как работает приложение?"],
  "HamyonUp — o'quvchilar uchun mo'ljallangan shaxsiy moliya ilovasi. Har kuni qancha pul sarflayotganingizni kiritib kuzatib borish va maqsadlaringizga erishishingizga yordam beradi.":
    ["HamyonUp is a personal finance app for students. It helps you track daily spending and reach your savings goals.", "HamyonUp — приложение личных финансов для школьников. Оно помогает следить за расходами и достигать целей."],
  "Topgan pulimni balansga qanday qo'shaman?": ["How do I add earned money to my balance?", "Как добавить заработанное к балансу?"],
  "Asosiy sahifadagi «Mablag' qo'shish» orqali topgan pulingizni balansga kiriting. Joriy qoldiq ustiga qo'shiladi; kuniga 3 marta kiritish mumkin.":
    ["Add earned money from Home. It is added to your current balance; you can add money up to 3 times a day.", "Добавляйте доход на главной. Он прибавляется к остатку; вводить его можно до 3 раз в день."],
  "Xarajat qanday qo'shiladi?": ["How do I add an expense?", "Как добавить расход?"],
  "«Xarajat qo'shish» tugmasini bosib, miqdor, kategoriya va izoh kiriting. Xarajat avtomatik ravishda balansdan ayiriladi.":
    ["Tap “Add expense”, then enter the amount, category and note. It is automatically deducted from your balance.", "Нажмите «Добавить расход», укажите сумму, категорию и заметку. Сумма автоматически вычтется из баланса."],
  "Maqsadga qanday pul tejayman?": ["How do I save toward a goal?", "Как копить на цель?"],
  "Bosh sahifadagi «Tejash» tugmasini bosib, maqsadni tanlang va miqdorni kiriting. Bu summa balansdan ayiriladi va maqsad balansi oshadi.":
    ["Tap “Save” on the home page, choose a goal and enter an amount. It moves from your balance to the goal.", "Нажмите «Копить» на главной, выберите цель и сумму. Она перейдёт с баланса в накопления цели."],
  "Ma'lumotlar qayerda saqlanadi?": ["Where is my data stored?", "Где хранятся данные?"],
  "Barcha ma'lumotlar faqat sizning qurilmangizda saqlanadi. Server yoki internet kerak emas.":
    ["Your private finance data is stored on this device. No internet is required.", "Личные финансовые данные хранятся на этом устройстве. Интернет не требуется."],
};
function lt(uz: string) {
  const translated = TEXT[uz];
  return ACTIVE_LANGUAGE === "uz" || !translated ? uz : translated[ACTIVE_LANGUAGE === "en" ? 0 : 1];
}

// ─── Constants ───────────────────────────────────────────────────────────────

const CATEGORIES = [
  { id: "food",      label: "Ovqat",     icon: Coffee },
  { id: "transport", label: "Transport", icon: Bus },
  { id: "school",    label: "Maktab",    icon: BookOpen },
  { id: "shopping",  label: "Xarid",     icon: ShoppingBag },
  { id: "games",     label: "O'yin",     icon: Gamepad2 },
  { id: "other",     label: "Boshqa",    icon: MoreHorizontal },
];

const GOAL_EMOJIS = [
  "🎯","📱","👟","🎮","🎒","📚","🚲","✈️","🎸","💎",
  "💻","⌚","🎧","📷","⚽","🏀","🛹","🎨","🧩","🔭",
  "🏕️","🎁","🪴","🐾","🏆","🧪","🎹","🛴","🗺️","🌟",
];

const LANGUAGE_OPTIONS: { id: Language; label: string; short: string }[] = [
  { id: "uz", label: "O'zbekcha", short: "UZ" },
  { id: "en", label: "English", short: "EN" },
  { id: "ru", label: "Русский", short: "RU" },
];

const CURRENCY_OPTIONS: { id: Currency; label: string; symbol: string }[] = [
  { id: "UZS", label: "So'm", symbol: "UZS" },
  { id: "RUB", label: "Rubl", symbol: "₽" },
  { id: "USD", label: "Dollar", symbol: "$" },
];
type CurrencyRates = Record<Currency, number>;
const CURRENCY_RATES_KEY = "hamyon_currency_rates";
// Official CBU rates observed 2026-11-14; refreshed from the CBU JSON feed when online.
const DEFAULT_CURRENCY_RATES: CurrencyRates = { UZS: 1, USD: 12014.37, RUB: 146.19 };
function validCurrency(value: unknown): value is Currency { return value === "UZS" || value === "RUB" || value === "USD"; }
function validRates(value: unknown): value is CurrencyRates {
  if (!value || typeof value !== "object") return false;
  const rates = value as Partial<CurrencyRates>;
  return rates.UZS === 1 && Number.isFinite(rates.USD) && rates.USD! > 0 && Number.isFinite(rates.RUB) && rates.RUB! > 0;
}
async function fetchCurrencyRates(): Promise<CurrencyRates | null> {
  try {
    const response = await fetch("https://cbu.uz/uz/arkhiv-kursov-valyut/json/", { signal: AbortSignal.timeout(5000), cache: "no-store" });
    if (!response.ok) return null;
    const rows: unknown = await response.json();
    if (!Array.isArray(rows)) return null;
    const rates: CurrencyRates = { UZS: 1, USD: 0, RUB: 0 };
    for (const row of rows) {
      if (!row || typeof row !== "object") continue;
      const item = row as { Ccy?: unknown; Rate?: unknown };
      if (item.Ccy !== "USD" && item.Ccy !== "RUB") continue;
      const rate = typeof item.Rate === "string" ? Number(item.Rate.replace(",", ".")) : item.Rate;
      if (typeof rate === "number" && Number.isFinite(rate) && rate > 0) rates[item.Ccy] = rate;
    }
    if (!validRates(rates)) return null;
    try { localStorage.setItem(CURRENCY_RATES_KEY, JSON.stringify({ rates, updatedAt: Date.now() })); } catch {}
    return rates;
  } catch { return null; }
}
function cachedCurrencyRates(): CurrencyRates {
  try {
    const cached = JSON.parse(localStorage.getItem(CURRENCY_RATES_KEY) ?? "null") as { rates?: unknown; updatedAt?: unknown } | null;
    if (cached && validRates(cached.rates) && typeof cached.updatedAt === "number" && Date.now() - cached.updatedAt < 45 * 24 * 60 * 60 * 1000) return cached.rates;
  } catch {}
  return DEFAULT_CURRENCY_RATES;
}
const roundMoney = (value: number, currency: Currency) => {
  const places = currency === "UZS" ? 0 : 2;
  const scale = 10 ** places;
  return Math.round((value + Number.EPSILON) * scale) / scale;
};
// Persist money in one base unit and convert only for display/input. This prevents
// repeated currency switches from accumulating cent rounding errors.
const toBaseMoney = (amount: number, currency: Currency, rates: CurrencyRates) => amount * rates[currency];
const fromBaseMoney = (amount: number, currency: Currency, rates: CurrencyRates) => roundMoney(amount / rates[currency], currency);
const currencyName = () => CURRENCY_OPTIONS.find((item) => item.id === ACTIVE_CURRENCY)?.symbol ?? "UZS";
const parseMoney = (value: string) => {
  const amount = Number.parseFloat(value);
  return Number.isFinite(amount) && amount >= 0 ? Math.min(amount, 1_000_000_000_000) : 0;
};

const COPY = {
  uz: {
    settings: "Sozlamalar", appearance: "Ko'rinish", notifications: "Bildirishnomalar",
    gameMusic: "O'yin musiqasi", sounds: "Tugma ovozlari", language: "Ilova tili", market: "Market",
    home: "Asosiy", goals: "Maqsadlar", games: "O'yinlar", close: "Yopish",
    helper: "Yordamchi", helperSetting: "Yordamchi personaj", soon: "Tez kunda",
    soonText: "Yordamchining yangi imkoniyatlari tez kunda ochiladi!",
    student: "O'quvchi", edit: "Tahrirlash", account: "Akkaunt va ilova parametrlari",
  },
  en: {
    settings: "Settings", appearance: "Appearance", notifications: "Notifications",
    gameMusic: "Game music", sounds: "Button sounds", language: "App language", market: "Market",
    home: "Home", goals: "Goals", games: "Games", close: "Close",
    helper: "Helper", helperSetting: "Helper character", soon: "Coming soon",
    soonText: "New Helper abilities are coming soon!",
    student: "Student", edit: "Edit", account: "Account and app preferences",
  },
  ru: {
    settings: "Настройки", appearance: "Оформление", notifications: "Уведомления", market: "Маркет",
    gameMusic: "Музыка в игре", sounds: "Звуки кнопок", language: "Язык приложения",
    home: "Главная", goals: "Цели", games: "Игры", close: "Закрыть",
    helper: "Помощник", helperSetting: "Персонаж-помощник", soon: "Скоро",
    soonText: "Новые возможности Помощника появятся совсем скоро!",
    student: "Ученик", edit: "Изменить", account: "Аккаунт и настройки приложения",
  },
} satisfies Record<Language, Record<string, string>>;

const HOW_IT_WORKS = [
  { q: "Ilova qanday ishlaydi?",
    a: "HamyonUp — o'quvchilar uchun mo'ljallangan shaxsiy moliya ilovasi. Har kuni qancha pul sarflayotganingizni kiritib kuzatib borish va maqsadlaringizga erishishingizga yordam beradi." },
  { q: "Topgan pulimni balansga qanday qo'shaman?",
    a: "Asosiy sahifadagi «Mablag' qo'shish» tugmasini bosing. Kiritilgan summa mavjud qoldiq ustiga qo'shiladi; bir kunda 3 martagacha kiritish mumkin." },
  { q: "Xarajat qanday qo'shiladi?",
    a: "«Xarajat qo'shish» tugmasini bosib, miqdor, kategoriya va izoh kiriting. Xarajat avtomatik ravishda balansdan ayiriladi." },
  { q: "Maqsadga qanday pul tejayman?",
    a: "Bosh sahifadagi «Tejash» tugmasini bosib, maqsadni tanlang va miqdorni kiriting. Bu summa balansdan ayiriladi va maqsad balansi oshadi." },
  { q: "Ma'lumotlar qayerda saqlanadi?",
    a: "Barcha ma'lumotlar faqat sizning qurilmangizda saqlanadi. Server yoki internet kerak emas." },
];

const STORAGE_KEY = "hamyon_data";
const LEADERBOARD_KEY = "hamyon_leaderboard";
const VIRTUAL_DISCLAIMER_KEY = "hamyon_disclaimer_shown";
const buildEnv = (import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env ?? {};
const RANKING_URL = (() => {
  try {
    const configured = buildEnv.VITE_SUPABASE_URL;
    if (!configured) return "";
    const url = new URL(configured);
    return url.protocol === "https:" && !url.username && !url.password ? url.origin : "";
  } catch { return ""; }
})();
const RANKING_KEY = buildEnv.VITE_SUPABASE_ANON_KEY ?? "";
const hasGlobalRanking = Boolean(RANKING_URL && RANKING_KEY);

const MILESTONES: { score: number; coins: number; label: string }[] = [
  { score: 5,   coins: 3,  label: "Boshlang'ich" },
  { score: 10,  coins: 5,  label: "Tajribali"    },
  { score: 25,  coins: 15, label: "Ustoz"        },
  { score: 50,  coins: 30, label: "Chempion"     },
  { score: 100, coins: 60, label: "Afsonaviy"    },
];

const COIN_LEVELS = [
  { min: 0,    max: 9,        rank: ["Yangi boshlovchi","Beginner","Новичок"],         color: "#64748B", icon: "🌱" },
  { min: 10,   max: 24,       rank: ["Izlanuvchi","Explorer","Исследователь"],         color: "#0891B2", icon: "🧭" },
  { min: 25,   max: 49,       rank: ["Chaqqon","Quick learner","Ловкач"],              color: "#059669", icon: "⚡" },
  { min: 50,   max: 89,       rank: ["Tajribali","Skilled","Опытный"],                 color: "#16A34A", icon: "🔥" },
  { min: 90,   max: 149,      rank: ["Strateg","Strategist","Стратег"],                color: "#2563EB", icon: "🧠" },
  { min: 150,  max: 249,      rank: ["Ustoz","Master","Мастер"],                       color: "#4F46E5", icon: "💫" },
  { min: 250,  max: 399,      rank: ["Elita","Elite","Элита"],                         color: "#7C3AED", icon: "💎" },
  { min: 400,  max: 699,      rank: ["Chempion","Champion","Чемпион"],                 color: "#DB2777", icon: "👑" },
  { min: 700,  max: 1199,     rank: ["Buyuk chempion","Grand champion","Гранд-чемпион"], color: "#EA580C", icon: "🏆" },
  { min: 1200, max: Infinity, rank: ["Afsonaviy","Legendary","Легендарный"],            color: "#D97706", icon: "🌟" },
];

function getCoinLevel(coins: number) {
  return COIN_LEVELS.find((l) => coins >= l.min && coins <= l.max) ?? COIN_LEVELS[0];
}
function rankName(level: (typeof COIN_LEVELS)[number]) {
  return level.rank[ACTIVE_LANGUAGE === "en" ? 1 : ACTIVE_LANGUAGE === "ru" ? 2 : 0];
}

const formatMoney = (n: number) => new Intl.NumberFormat(activeLocale(), {
  style: "currency", currency: ACTIVE_CURRENCY, maximumFractionDigits: ACTIVE_CURRENCY === "UZS" ? 0 : 2,
}).format(n);
const localDayStr = (date = new Date()) => {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
};
const todayStr = () => localDayStr();
const last7Days = () => {
  const days: string[] = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(); d.setDate(d.getDate() - i);
    days.push(localDayStr(d));
  }
  return days;
};
const dayLabel = (s: string) => {
  const labels = ACTIVE_LANGUAGE === "en"
    ? ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"]
    : ACTIVE_LANGUAGE === "ru"
      ? ["Вс","Пн","Вт","Ср","Чт","Пт","Сб"]
      : ["Yak","Du","Se","Cho","Pay","Ju","Sha"];
  const [year, month, day] = s.split("-").map(Number);
  return labels[new Date(year, month - 1, day).getDay()];
};
const genId = () => `u_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
function readAvatarFile(file: File, onReady: (avatar: string) => void) {
  if (!["image/png", "image/jpeg", "image/webp", "image/gif"].includes(file.type)) {
    toast.error(tr("PNG, JPG, WEBP yoki GIF rasm tanlang.", "Choose a PNG, JPG, WEBP or GIF image.", "Выберите изображение PNG, JPG, WEBP или GIF."));
    return;
  }
  if (file.size > 700 * 1024) {
    toast.error(tr("Rasm hajmi 700 KB dan kichik bo'lishi kerak.", "The image must be smaller than 700 KB.", "Размер изображения должен быть меньше 700 КБ."));
    return;
  }
  const reader = new FileReader();
  reader.onload = () => { if (typeof reader.result === "string" && reader.result.length <= 1_000_000) onReady(reader.result); };
  reader.onerror = () => toast.error(tr("Rasmni o'qib bo'lmadi.", "Could not read the image.", "Не удалось прочитать изображение."));
  reader.readAsDataURL(file);
}

// ─── Leaderboard helpers ──────────────────────────────────────────────────────

function loadLeaderboard(): LeaderboardEntry[] {
  try {
    const raw = localStorage.getItem(LEADERBOARD_KEY);
    if (!raw) return [];
    const monthAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;
    const rows: unknown = JSON.parse(raw);
    if (!Array.isArray(rows)) return [];
    return rows.filter((entry): entry is LeaderboardEntry => Boolean(entry && typeof entry === "object" &&
        typeof entry.id === "string" && /^u_[\w-]{4,80}$/.test(entry.id) &&
        typeof entry.name === "string" && entry.name.trim().length >= 2 && entry.name.length <= 40 &&
        Number.isSafeInteger(entry.coins) && entry.coins >= 0 && entry.coins <= 2_000_000_000 &&
        (entry.avatar === null || (typeof entry.avatar === "string" && entry.avatar.length <= 1_000_000 && /^data:image\/(png|jpeg|webp|gif);base64,/i.test(entry.avatar))) &&
        Number.isFinite(entry.updatedAt) && entry.updatedAt >= monthAgo && entry.updatedAt <= Date.now() + 60_000))
      .sort((a, b) => b.coins - a.coins)
      .slice(0, 100);
  } catch { return []; }
}

function saveLeaderboard(entries: LeaderboardEntry[]) {
  try { localStorage.setItem(LEADERBOARD_KEY, JSON.stringify(entries)); } catch {}
}

function upsertLeaderboard(entry: LeaderboardEntry) {
  const safeName = entry.name.normalize("NFKC").replace(/[\u0000-\u001F\u007F-\u009F]/g, "").trim().slice(0, 40);
  const safeCoins = Number.isSafeInteger(entry.coins) ? Math.max(0, Math.min(2_000_000_000, entry.coins)) : 0;
  const safeEntry = { ...entry, name: safeName || "Hamyonchi", coins: safeCoins, avatar: null };
  const entries = loadLeaderboard();
  const idx = entries.findIndex((e) => e.id === safeEntry.id);
  if (idx >= 0) entries[idx] = safeEntry;
  else entries.push(safeEntry);
  saveLeaderboard(entries.sort((a, b) => b.coins - a.coins).slice(0, 100));
  if (hasGlobalRanking) {
    void fetch(`${RANKING_URL}/rest/v1/leaderboard?on_conflict=id`, {
      method: "POST",
      signal: AbortSignal.timeout(7000),
      headers: { apikey: RANKING_KEY, Authorization: `Bearer ${RANKING_KEY}`, "Content-Type": "application/json", Prefer: "resolution=merge-duplicates" },
      // Keep personal profile photos on-device; only public score/name are shared.
      body: JSON.stringify({ id: safeEntry.id, name: safeEntry.name, coins: safeEntry.coins, avatar: null, updated_at: new Date(safeEntry.updatedAt).toISOString() }),
    }).catch(() => undefined);
  }
}

async function fetchGlobalLeaderboard(): Promise<LeaderboardEntry[] | null> {
  if (!hasGlobalRanking) return null;
  try {
    const response = await fetch(`${RANKING_URL}/rest/v1/leaderboard?select=id,name,coins,updated_at&order=coins.desc&limit=100`, {
      signal: AbortSignal.timeout(7000),
      headers: { apikey: RANKING_KEY, Authorization: `Bearer ${RANKING_KEY}` },
    });
    if (!response.ok) return null;
    const rows: unknown = await response.json();
    if (!Array.isArray(rows)) return null;
    return rows.filter((row) => row && typeof row.id === "string" && /^u_[\w-]{4,80}$/.test(row.id) && typeof row.name === "string" && row.name.trim().length >= 2 && row.name.length <= 40 && Number.isSafeInteger(row.coins) && row.coins >= 0 && row.coins <= 2_000_000_000)
      .map((row) => ({ id: row.id as string, name: (row.name as string).slice(0, 40), coins: row.coins as number, avatar: null, updatedAt: Date.parse(row.updated_at) || Date.now() }));
  } catch { return null; }
}

// ─── LocalStorage helpers ─────────────────────────────────────────────────────

function loadData() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const d: unknown = JSON.parse(raw);
    if (!d || typeof d !== "object") return null;
    const data = d as Record<string, unknown>;
    const validTheme = (v: unknown): v is Theme => v === "light" || v === "dark" || v === "midnight" || v === "orange";
    const validLanguage = (v: unknown): v is Language => v === "uz" || v === "en" || v === "ru";
    const safeAmount = (v: unknown) => typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= 1_000_000_000_000_000_000;
    const safeUser = (value: unknown): User | null => {
      if (!value || typeof value !== "object") return null;
      const candidate = value as Record<string, unknown>;
      if (typeof candidate.name !== "string" || candidate.name.trim().length < 1 || candidate.name.length > 40) return null;
      const id = typeof candidate.id === "string" && /^u_[\w-]{4,80}$/.test(candidate.id) ? candidate.id : genId();
      const avatar = typeof candidate.avatar === "string" && candidate.avatar.length <= 1_000_000 && /^data:image\/(png|jpeg|webp|gif);base64,/i.test(candidate.avatar) ? candidate.avatar : null;
      return { id, name: candidate.name.trim(), avatar };
    };
    const expenses = Array.isArray(data.expenses) ? data.expenses.slice(0, 5000).filter((item): item is Expense => Boolean(item && typeof item === "object" && typeof item.id === "string" && item.id.length <= 100 && safeAmount(item.amount) && typeof item.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(item.date) && typeof item.category === "string" && CATEGORIES.some((c) => c.id === item.category) && typeof item.note === "string" && item.note.length <= 200)) : [];
    const moneyEvents = Array.isArray(data.moneyEvents) ? data.moneyEvents.slice(-5000).filter((item): item is MoneyEvent => Boolean(item && typeof item === "object" && typeof item.id === "string" && item.id.length <= 100 && safeAmount(item.amount) && item.amount > 0 && typeof item.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(item.date) && (item.kind === "earned" || item.kind === "saved") && (item.goalName === undefined || (typeof item.goalName === "string" && item.goalName.length <= 80)))) : [];
    const goals = Array.isArray(data.goals) ? data.goals.slice(0, 500).filter((item): item is Goal => Boolean(item && typeof item === "object" && typeof item.id === "string" && item.id.length <= 100 && typeof item.title === "string" && item.title.trim().length > 0 && item.title.length <= 80 && safeAmount(item.target) && safeAmount(item.saved) && typeof item.emoji === "string" && item.emoji.length <= 16 && (item.achievedAt === undefined || (typeof item.achievedAt === "string" && item.achievedAt.length <= 40 && Number.isFinite(Date.parse(item.achievedAt)))))) : [];
    const knownCosmeticIds = new Set(COSMETICS.map((item) => item.id));
    const ownedCosmetics = Array.isArray(data.ownedCosmetics)
      ? [...new Set(data.ownedCosmetics.filter((id): id is string => typeof id === "string" && knownCosmeticIds.has(id)))].slice(0, COSMETICS.length)
      : [];
    const rawEquipped = data.equippedCosmetics && typeof data.equippedCosmetics === "object" ? data.equippedCosmetics as Record<string, unknown> : {};
    const equippedCosmetics: Partial<Record<CosmeticSlot, string>> = {};
    for (const slot of ["avatar", "name", "theme", "helper"] as const) {
      const id = rawEquipped[slot];
      const item = COSMETICS.find((candidate) => candidate.id === id && candidate.slot === slot);
      if (item && ownedCosmetics.includes(item.id)) equippedCosmetics[slot] = item.id;
    }
    return { user: safeUser(data.user), balance: safeAmount(data.balance) ? data.balance : 0, expenses, moneyEvents, goals,
      ownedCosmetics, equippedCosmetics,
      incomeEntryDate: typeof data.incomeEntryDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(data.incomeEntryDate) ? data.incomeEntryDate : localDayStr(),
      incomeEntriesToday: Number.isSafeInteger(data.incomeEntriesToday) && (data.incomeEntriesToday as number) >= 0 && (data.incomeEntriesToday as number) <= 3 ? data.incomeEntriesToday as number : 0,
      totalEarned: safeAmount(data.totalEarned) ? data.totalEarned : 0,
      totalSaved: safeAmount(data.totalSaved) ? data.totalSaved : undefined,
      theme: validTheme(data.theme) ? data.theme : "light", notifications: data.notifications !== false,
      currency: validCurrency(data.currency) ? data.currency : "UZS", gameCoins: Number.isSafeInteger(data.gameCoins) && (data.gameCoins as number) >= 0 && (data.gameCoins as number) <= 2_000_000_000 ? data.gameCoins as number : 0,
      gameMusic: data.gameMusic !== false, language: validLanguage(data.language) ? data.language : "uz",
      assistantEnabled: data.assistantEnabled !== false, sfxEnabled: data.sfxEnabled !== false,
      moneyUnit: data.moneyUnit === "UZS" ? "UZS" : undefined };
  } catch { return null; }
}

function saveData(data: {
  user: User | null; balance: number; expenses: Expense[]; moneyEvents: MoneyEvent[];
  ownedCosmetics: string[]; equippedCosmetics: Partial<Record<CosmeticSlot, string>>;
  incomeEntryDate: string; incomeEntriesToday: number; totalEarned: number; totalSaved: number;
  goals: Goal[]; theme: Theme; notifications: boolean; currency: Currency;
  gameCoins: number; gameMusic: boolean; language: Language;
  assistantEnabled: boolean; sfxEnabled: boolean;
  moneyUnit: "UZS";
}) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(data)); } catch {}
}

// ─── Animated Button ─────────────────────────────────────────────────────────

function Btn({ onClick, className = "", children, disabled, sound = "click" }: {
  onClick?: () => void; className?: string; children: React.ReactNode;
  disabled?: boolean; sound?: keyof typeof sfx | "none";
}) {
  const [pressed, setPressed] = useState(false);
  const [popping, setPopping] = useState(false);
  return (
    <button disabled={disabled}
      onClick={() => { if (disabled) return; if (sound !== "none") sfx[sound](); setPopping(true); window.setTimeout(() => setPopping(false), 260); onClick?.(); }}
      onPointerDown={() => setPressed(true)}
      onPointerUp={() => setPressed(false)}
      onPointerLeave={() => setPressed(false)}
      className={`app-button-3d ${className}`}
      style={{ transform: pressed ? "translateY(2px) scale(.975)" : undefined, animation: popping && !pressed ? "buttonPop .26s cubic-bezier(.2,.9,.3,1.4)" : undefined }}
    >{children}</button>
  );
}

function CloseButton({ onClick, label, className = "" }: { onClick: () => void; label?: string; className?: string }) {
  return <button type="button" aria-label={label ?? tr("Yopish", "Close", "Закрыть")} onClick={() => { sfx.click(); onClick(); }} className={`modal-close-button ${className}`}><X size={19} aria-hidden="true" /></button>;
}

function SettingsToggleRow({ icon, title, description, value, onChange }: {
  icon: React.ReactNode; title: string; description: string; value: boolean; onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-center gap-3 py-3.5 border-b border-border last:border-0">
      <div className={`w-10 h-10 rounded-xl flex items-center justify-center transition-colors ${value ? "bg-primary/15 text-primary" : "bg-input-background text-muted-foreground"}`}>
        {icon}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-bold text-foreground">{title}</p>
        <p className="text-[11px] text-muted-foreground mt-0.5">{description}</p>
      </div>
      <button aria-label={title} aria-pressed={value}
        onClick={() => { value ? sfx.toggleOff() : sfx.toggleOn(); onChange(!value); }}
        className={`app-button-3d relative w-12 h-7 shrink-0 rounded-full transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 focus:ring-offset-card ${value ? "bg-primary" : "bg-switch-background"}`}>
        <span className={`absolute top-1 left-1 w-5 h-5 rounded-full bg-white shadow-md transition-transform ${value ? "translate-x-5" : ""}`} />
      </button>
    </div>
  );
}

// ─── Splash Screen ────────────────────────────────────────────────────────────

function SplashScreen({ onDone }: { onDone: () => void }) {
  const [phase, setPhase] = useState<"in" | "hold" | "out">("in");
  useEffect(() => {
    const t0 = setTimeout(() => { sfx.splash(); setPhase("hold"); }, 80);
    const t1 = setTimeout(() => setPhase("out"), 2500);
    const t2 = setTimeout(onDone, 3000);
    return () => { clearTimeout(t0); clearTimeout(t1); clearTimeout(t2); };
  }, [onDone]);
  const show = phase === "hold";
  return (
    <div className="fixed inset-0 flex flex-col items-center justify-center bg-primary z-[100]"
      style={{ opacity: phase === "out" ? 0 : 1, transition: "opacity 0.5s ease" }}>
      <div style={{ opacity: show ? 1 : 0, transform: show ? "scale(1)" : "scale(0.5)", transition: "opacity 0.5s ease, transform 0.6s cubic-bezier(0.34,1.56,0.64,1)" }}
        className="w-24 h-24 rounded-3xl overflow-hidden mb-6 shadow-2xl ring-4 ring-white/30">
        <img src="/wallet-logo.png" alt="HamyonUp" className="h-full w-full object-cover" />
      </div>
      <div style={{ opacity: show ? 1 : 0, transform: show ? "translateY(0)" : "translateY(20px)", transition: "opacity 0.5s ease 0.15s, transform 0.5s ease 0.15s" }}
        className="text-center mb-8">
        <h1 className="text-white text-3xl font-bold tracking-tight">HamyonUp</h1>
        <p className="text-white/60 text-sm mt-1">{tr("O'quvchilar uchun xarajat hisoblovchi", "A spending tracker for students", "Учёт расходов для школьников")}</p>
      </div>
      <div style={{ opacity: show ? 1 : 0, transition: "opacity 0.4s ease 0.3s" }} className="flex gap-2">
        {[0, 1, 2].map((i) => (
          <span key={i} className="w-2 h-2 rounded-full bg-white/50"
            style={{ animation: `bounce 1s ease ${i * 0.15}s infinite` }} />
        ))}
      </div>
      <style>{`@keyframes bounce{0%,80%,100%{transform:translateY(0)}40%{transform:translateY(-8px)}}`}</style>
    </div>
  );
}

// ─── Virtual Money Disclaimer Modal ───────────────────────────────────────────

function VirtualMoneyModal({ onClose }: { onClose: () => void }) {
  const [visible, setVisible] = useState(false);
  useEffect(() => { const t = setTimeout(() => setVisible(true), 80); return () => clearTimeout(t); }, []);
  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-[200] p-5"
      style={{ backdropFilter: "blur(6px)" }}>
      <div style={{ opacity: visible ? 1 : 0, transform: visible ? "scale(1) translateY(0)" : "scale(0.85) translateY(30px)", transition: "opacity 0.4s ease, transform 0.4s cubic-bezier(0.34,1.56,0.64,1)" }}
        className="w-full max-w-sm bg-card rounded-3xl p-6 shadow-2xl border border-border">
        <div className="flex flex-col items-center text-center mb-5">
          <div className="w-16 h-16 rounded-2xl bg-primary/15 flex items-center justify-center mb-4">
            <Shield size={32} className="text-primary" />
          </div>
          <h2 className="text-xl font-bold text-foreground mb-1">{tr("Muhim ma'lumot", "Important information", "Важная информация")}</h2>
          <p className="text-sm text-muted-foreground font-semibold">{tr("Ilova haqida xavfsizlik eslatmasi", "App safety notice", "Уведомление о безопасности")}</p>
        </div>
        <div className="bg-primary/8 border border-primary/20 rounded-2xl p-4 mb-5 space-y-3">
          {[
            ["⚠️", tr("Ushbu ilova faqat virtual (hayoliy) mablag' bilan ishlaydi.", "This app works only with virtual money.", "Приложение работает только с виртуальными деньгами.")],
            ["🔒", tr("Ilova siz kiritgan summalarni faqat hisob-kitob maqsadida saqlab boradi. Hech qanday real pul mablag'laridan foydalanilmaydi.", "Entered amounts are stored only for calculations. No real money is used.", "Введённые суммы хранятся только для расчётов. Реальные деньги не используются.")],
            ["🛡️", tr("Ilova hech qachon foydalanuvchilardan haqiqiy pul mablag' kiritishni so'ramaydi. Bu foydalanuvchilarga nisbatan kelib chiqishi mumkin bo'lgan og'riq va ko'zboyamachiliklarni oldini olish uchun qilingan.", "The app never asks users to deposit real money. This protects students from deception.", "Приложение никогда не просит внести реальные деньги. Это защищает учеников от обмана.")],
            ["📱", tr("Barcha ma'lumotlar faqat qurilmangizda saqlanadi.", "Private data is stored only on your device.", "Личные данные хранятся только на вашем устройстве.")],
          ].map(([icon, text], i) => (
            <div key={i} className="flex items-start gap-3">
              <span className="shrink-0 mt-0.5 text-base">{icon}</span>
              <p className="text-sm text-muted-foreground leading-relaxed">{text}</p>
            </div>
          ))}
        </div>
        <Btn sound="save" onClick={onClose}
          className="w-full py-3.5 rounded-2xl bg-primary text-primary-foreground font-bold text-base hover:opacity-90">
          {tr("Tushundim, davom etish", "I understand, continue", "Понятно, продолжить")}
        </Btn>
      </div>
    </div>
  );
}

// ─── Registration ─────────────────────────────────────────────────────────────

function QuickSettingsModal({ theme, language, notifications, gameMusic, assistantEnabled, sfxEnabled, onTheme, onLanguage, onNotifications, onGameMusic, onAssistant, onSfx, onClose }: {
  theme: Theme; language: Language; notifications: boolean; gameMusic: boolean; assistantEnabled: boolean; sfxEnabled: boolean;
  onTheme: (v: Theme) => void; onLanguage: (v: Language) => void; onNotifications: (v: boolean) => void;
  onGameMusic: (v: boolean) => void; onAssistant: (v: boolean) => void; onSfx: (v: boolean) => void; onClose: () => void;
}) {
  const c = COPY[language];
  const stateText = (value: boolean) => value
    ? tr("Yoqilgan", "Enabled", "Включено")
    : tr("O'chirilgan", "Disabled", "Выключено");
  return (
    <div className="fixed inset-0 z-[160] bg-black/60 flex items-end sm:items-center justify-center p-0 sm:p-5" onClick={onClose}>
      <div className="w-full max-w-sm bg-card rounded-t-[2rem] sm:rounded-[2rem] p-5 pb-8 shadow-2xl border border-border" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-5">
          <div className="flex items-center gap-2"><Settings size={19} className="text-primary" /><h2 className="text-lg font-bold text-foreground">{c.settings}</h2></div>
          <CloseButton onClick={onClose} />
        </div>
        <p className="text-[11px] font-extrabold text-muted-foreground uppercase tracking-[0.14em] mb-2">{c.appearance}</p>
        <div className="grid grid-cols-4 gap-2 mb-5">
          {(["light", "dark", "midnight", "orange"] as Theme[]).map((item) => (
            <Btn key={item} onClick={() => onTheme(item)}
              className={`h-16 rounded-2xl border-2 flex flex-col items-center justify-center gap-1 ${theme === item ? "border-primary bg-primary/10 text-primary" : "border-border bg-input-background text-muted-foreground"}`}>
              {item === "light" ? <Sun size={18} /> : item === "dark" ? <Moon size={18} /> : item === "midnight" ? <span>🌌</span> : <span>🔥</span>}
              <span className="text-[10px] font-bold">{item === "light" ? tr("Standart", "Default", "Стандартная") : item === "dark" ? tr("Qorong'i", "Dark", "Тёмная") : item === "midnight" ? tr("Yarim tun", "Midnight", "Полночь") : tr("Olovrang", "Orange", "Оранжевая")}</span>
            </Btn>
          ))}
        </div>
        <p className="text-[11px] font-extrabold text-muted-foreground uppercase tracking-[0.14em] mb-2">{c.language}</p>
        <div className="grid grid-cols-3 gap-2 mb-4">
          {LANGUAGE_OPTIONS.map((item) => (
            <Btn key={item.id} onClick={() => onLanguage(item.id)}
              className={`py-2.5 rounded-xl border text-xs font-bold ${language === item.id ? "bg-primary text-primary-foreground border-primary" : "bg-input-background text-muted-foreground border-border"}`}>
              {item.short}
            </Btn>
          ))}
        </div>
        <div>
          <SettingsToggleRow icon={<Bell size={18} />} title={c.notifications} description={stateText(notifications)} value={notifications} onChange={onNotifications} />
          <SettingsToggleRow icon={<Music2 size={18} />} title={c.gameMusic} description={stateText(gameMusic)} value={gameMusic} onChange={onGameMusic} />
          <SettingsToggleRow icon={<Sparkles size={18} />} title={c.helperSetting} description={stateText(assistantEnabled)} value={assistantEnabled} onChange={onAssistant} />
          <SettingsToggleRow icon={sfxEnabled ? <Volume2 size={18} /> : <VolumeX size={18} />} title={c.sounds} description={stateText(sfxEnabled)} value={sfxEnabled} onChange={onSfx} />
        </div>
        <Btn onClick={onClose} className="w-full mt-5 py-3 rounded-2xl bg-primary text-primary-foreground font-bold">{c.close}</Btn>
      </div>
    </div>
  );
}

function RegisterScreen({ onRegister, theme, language, notifications, gameMusic, assistantEnabled, sfxEnabled, onTheme, onLanguage, onNotifications, onGameMusic, onAssistant, onSfx }: {
  onRegister: (u: User) => void; theme: Theme; language: Language; notifications: boolean; gameMusic: boolean; assistantEnabled: boolean; sfxEnabled: boolean;
  onTheme: (v: Theme) => void; onLanguage: (v: Language) => void; onNotifications: (v: boolean) => void;
  onGameMusic: (v: boolean) => void; onAssistant: (v: boolean) => void; onSfx: (v: boolean) => void;
}) {
  const [name, setName] = useState("");
  const [avatar, setAvatar] = useState<string | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const r = {
    uz: { subtitle: "O'quvchilar uchun xarajat hisoblovchi", photo: "Profil rasmi (ixtiyoriy)", name: "Ismingiz", placeholder: "Masalan: Alibek", about: "Ro'yxatdan o'tish haqida", one: "Bir martalik — keyingi safar avtomatik kirasiz", two: "Ismingizni kiriting va ixtiyoriy ravishda profil rasmini qo'shing", three: "Barcha ma'lumotlar faqat qurilmangizda saqlanadi", start: "Boshlash", noEmail: "Elektron pochta talab qilinmaydi" },
    en: { subtitle: "A spending tracker for students", photo: "Profile photo (optional)", name: "Your name", placeholder: "For example: Alex", about: "About registration", one: "Register once — next time you will enter automatically", two: "Enter your name and optionally add a profile photo", three: "Your private data is stored on this device", start: "Get started", noEmail: "No email address required" },
    ru: { subtitle: "Учёт расходов для школьников", photo: "Фото профиля (необязательно)", name: "Ваше имя", placeholder: "Например: Алишер", about: "О регистрации", one: "Регистрация один раз — затем автоматический вход", two: "Введите имя и при желании добавьте фото", three: "Личные данные хранятся на этом устройстве", start: "Начать", noEmail: "Электронная почта не требуется" },
  }[language];
  const fileRef = useRef<HTMLInputElement>(null);
  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]; if (!f) return;
    readAvatarFile(f, setAvatar);
    e.currentTarget.value = "";
  };
  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-6 relative overflow-hidden">
      <Btn onClick={() => setShowSettings(true)} className="absolute right-5 top-5 w-11 h-11 rounded-2xl bg-card border border-border shadow-lg flex items-center justify-center text-primary" >
        <Settings size={21} />
      </Btn>
      <div className="w-full max-w-sm">
        <div className="text-center mb-10">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl overflow-hidden bg-primary mb-4 shadow-lg">
            <img src="/wallet-logo.png" alt="HamyonUp" className="h-full w-full object-cover" />
          </div>
          <h1 className="text-2xl font-bold text-foreground">HamyonUp</h1>
          <p className="text-muted-foreground text-sm mt-1">{r.subtitle}</p>
        </div>
        <div className="flex flex-col items-center mb-8">
          <Btn onClick={() => fileRef.current?.click()}
            className="relative w-24 h-24 rounded-full bg-secondary border-2 border-dashed border-primary/40 flex items-center justify-center overflow-hidden hover:border-primary transition-colors group">
            {avatar
              ? <img src={avatar} alt="profil" className="w-full h-full object-cover" />
              : <div className="flex flex-col items-center gap-1 text-muted-foreground group-hover:text-primary transition-colors"><Camera size={24} /><span className="text-xs">{tr("Rasm", "Photo", "Фото")}</span></div>}
            <div className="absolute bottom-0 right-0 w-7 h-7 bg-primary rounded-full flex items-center justify-center shadow">
              <Plus size={14} className="text-primary-foreground" />
            </div>
          </Btn>
          <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp,image/gif" className="hidden" onChange={handleFile} />
          <p className="text-xs text-muted-foreground mt-2">{r.photo}</p>
        </div>
        <div className="mb-6">
          <label className="block text-sm font-semibold text-foreground mb-2">{r.name}</label>
          <input type="text" placeholder={r.placeholder} value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && name.trim() && onRegister({ name: name.trim(), avatar, id: genId() })}
            className="w-full px-4 py-3 rounded-xl bg-input-background border border-border text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring transition" />
        </div>
        <div className="bg-secondary border border-border rounded-2xl p-4 mb-5">
          <p className="text-xs font-bold text-primary uppercase tracking-wide mb-2">{r.about}</p>
          <ul className="space-y-1.5 text-xs text-muted-foreground">
            <li className="flex items-start gap-2"><span className="text-primary mt-0.5">•</span>{r.one}</li>
            <li className="flex items-start gap-2"><span className="text-primary mt-0.5">•</span>{r.two}</li>
            <li className="flex items-start gap-2"><span className="text-primary mt-0.5">•</span>{r.three}</li>
          </ul>
        </div>
        <Btn sound="save" disabled={!name.trim()} onClick={() => onRegister({ name: name.trim(), avatar, id: genId() })}
          className="w-full py-3.5 rounded-xl bg-primary text-primary-foreground font-bold text-base hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed">
          {r.start}
        </Btn>
        <p className="text-center text-xs text-muted-foreground mt-4">{r.noEmail}</p>
      </div>
      {showSettings && (
        <QuickSettingsModal theme={theme} language={language} notifications={notifications} gameMusic={gameMusic} assistantEnabled={assistantEnabled} sfxEnabled={sfxEnabled}
          onTheme={onTheme} onLanguage={onLanguage} onNotifications={onNotifications} onGameMusic={onGameMusic} onAssistant={onAssistant} onSfx={onSfx}
          onClose={() => setShowSettings(false)} />
      )}
    </div>
  );
}

// ─── Add Expense Modal ────────────────────────────────────────────────────────

function AddExpenseModal({ balance, onClose, onSave }: { balance: number; onClose: () => void; onSave: (e: Omit<Expense, "id">) => boolean; }) {
  const [amount, setAmount] = useState("");
  const [category, setCategory] = useState("food");
  const [note, setNote] = useState("");
  const handle = () => {
    const n = parseMoney(amount);
    if (!n) return;
    if (n > balance) {
      toast.error(tr("Hisobingizda yetarlicha mablag' mavjud emas.", "You don't have enough funds in your balance.", "На балансе недостаточно средств."));
      return;
    }
    if (onSave({ date: todayStr(), amount: n, category, note })) onClose();
  };
  return (
    <div className="fixed inset-0 bg-black/50 flex items-end justify-center z-50" onClick={onClose}>
      <div className="w-full max-w-sm bg-card rounded-t-3xl p-6 pb-10" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-5">
          <h3 className="font-bold text-lg text-foreground">{tr("Xarajat qo'shish", "Add expense", "Добавить расход")}</h3>
          <CloseButton onClick={onClose} />
        </div>
        <label className="block text-xs font-semibold text-muted-foreground mb-1 uppercase tracking-wide">{tr(`Miqdor (${currencyName()})`, `Amount (${currencyName()})`, `Сумма (${currencyName()})`)}</label>
        <input type="number" min="0" max="1000000000000" step={ACTIVE_CURRENCY === "UZS" ? "1" : "0.01"} placeholder="0" value={amount} onChange={(e) => setAmount(e.target.value)}
          className="w-full px-4 py-3 rounded-xl bg-input-background border border-border text-foreground text-xl font-bold placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-ring mb-4"
          style={{ fontFamily: "DM Mono, monospace" }} autoFocus />
        <label className="block text-xs font-semibold text-muted-foreground mb-2 uppercase tracking-wide">{tr("Kategoriya", "Category", "Категория")}</label>
        <div className="grid grid-cols-3 gap-2 mb-4">
          {CATEGORIES.map((c) => {
            const Icon = c.icon;
            return (
              <Btn key={c.id} onClick={() => setCategory(c.id)}
                className={`flex flex-col items-center gap-1 py-2.5 rounded-xl border text-xs font-semibold transition-colors ${
                  category === c.id ? "bg-primary border-primary text-primary-foreground" : "bg-input-background border-border text-muted-foreground hover:border-primary/40"}`}>
                <Icon size={18} />{lt(c.label)}
              </Btn>
            );
          })}
        </div>
        <label className="block text-xs font-semibold text-muted-foreground mb-1 uppercase tracking-wide">{tr("Izoh (ixtiyoriy)", "Note (optional)", "Заметка (необязательно)")}</label>
        <input type="text" placeholder={tr("Nima uchun sarfladingiz?", "What did you spend it on?", "На что вы потратили?")} value={note} onChange={(e) => setNote(e.target.value)}
          className="w-full px-4 py-3 rounded-xl bg-input-background border border-border text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring mb-5" />
        <Btn sound="save" onClick={handle} disabled={!amount}
          className="w-full py-3.5 rounded-xl bg-primary text-primary-foreground font-bold hover:opacity-90 disabled:opacity-40">
          {tr("Saqlash", "Save", "Сохранить")}
        </Btn>
      </div>
    </div>
  );
}

// ─── Set Balance Modal ────────────────────────────────────────────────────────

function SetBalanceModal({ current, entriesLeft, onClose, onSave }: { current: number; entriesLeft: number; onClose: () => void; onSave: (n: number) => boolean; }) {
  const [val, setVal] = useState("");
  return (
    <div className="fixed inset-0 bg-black/50 flex items-end justify-center z-50" onClick={onClose}>
      <div className="w-full max-w-sm bg-card rounded-t-3xl p-6 pb-10" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-5">
          <h3 className="font-bold text-lg text-foreground">{tr("Topilgan mablag'ni qo'shish", "Add earned money", "Добавить доход")}</h3>
          <CloseButton onClick={onClose} />
        </div>
        <p className="text-xs text-muted-foreground mb-2">{tr("Bu summa joriy balansingizga qo'shiladi. Kuniga 3 martagacha kiritish mumkin.", "This amount is added to your current balance. You can add money up to 3 times a day.", "Сумма добавится к текущему балансу. Вводить доход можно до 3 раз в день.")}</p>
        <label className="block text-xs font-semibold text-muted-foreground mb-1 uppercase tracking-wide">{tr(`Qo'shiladigan summa (${currencyName()})`, `Amount to add (${currencyName()})`, `Добавляемая сумма (${currencyName()})`)}</label>
        <input type="number" min="0" max="1000000000000" step={ACTIVE_CURRENCY === "UZS" ? "1" : "0.01"} placeholder="0" value={val} onChange={(e) => setVal(e.target.value)} autoFocus
          className="w-full px-4 py-3 rounded-xl bg-input-background border border-border text-foreground text-2xl font-bold placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-ring mb-3"
          style={{ fontFamily: "DM Mono, monospace" }} />
        <div className="flex items-start gap-2.5 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700/40 rounded-xl p-3 mb-5">
          <Shield size={15} className="text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
          <p className="text-xs text-amber-700 dark:text-amber-300 leading-relaxed">
            {tr(`Joriy balans: ${formatMoney(current)}. Bugun yana ${entriesLeft} marta mablag' qo'shishingiz mumkin.`, `Current balance: ${formatMoney(current)}. You can add money ${entriesLeft} more times today.`, `Текущий баланс: ${formatMoney(current)}. Сегодня можно добавить доход ещё ${entriesLeft} раз.`)}
          </p>
        </div>
        <Btn sound="save" disabled={!val || parseMoney(val) <= 0 || entriesLeft <= 0} onClick={() => { if (onSave(parseMoney(val))) onClose(); }}
          className="w-full py-3.5 rounded-xl bg-primary text-primary-foreground font-bold hover:opacity-90 disabled:opacity-40">
          {entriesLeft > 0 ? tr("Balansga qo'shish", "Add to balance", "Добавить к балансу") : tr("Bugungi limit tugadi", "Daily limit reached", "Дневной лимит исчерпан")}
        </Btn>
      </div>
    </div>
  );
}

// ─── Save to Goal Modal ───────────────────────────────────────────────────────

function SaveToGoalModal({ balance, goals, onClose, onSave }: {
  balance: number; goals: Goal[]; onClose: () => void; onSave: (goalId: string, amount: number) => boolean;
}) {
  const activeGoals = goals.filter((g) => !g.achievedAt && g.saved < g.target);
  const [selectedGoal, setSelectedGoal] = useState(activeGoals[0]?.id ?? "");
  const [amount, setAmount] = useState("");

  if (activeGoals.length === 0) {
    return (
      <div className="fixed inset-0 bg-black/50 flex items-end justify-center z-50" onClick={onClose}>
        <div className="w-full max-w-sm bg-card rounded-t-3xl p-6 pb-10" onClick={(e) => e.stopPropagation()}>
          <div className="flex items-center justify-between mb-5">
            <h3 className="font-bold text-lg text-foreground">{tr("Maqsadga tejash", "Save toward a goal", "Копить на цель")}</h3>
            <CloseButton onClick={onClose} />
          </div>
          <div className="text-center py-8">
            <Target size={40} className="mx-auto mb-3 text-muted-foreground opacity-40" />
            <p className="text-muted-foreground text-sm">{tr("Hali faol maqsad yo'q.", "No active goals yet.", "Активных целей пока нет.")}</p>
            <p className="text-muted-foreground text-xs mt-1">{tr("Avval «Maqsadlar» bo'limida maqsad qo'shing.", "Add a goal in the Goals section first.", "Сначала добавьте цель в разделе «Цели».")}</p>
          </div>
        </div>
      </div>
    );
  }

  const handle = () => {
    const n = parseMoney(amount);
    if (!n || !selectedGoal) return;
    if (n > balance) {
      toast.error(tr("Hisobingizda yetarlicha mablag' mavjud emas.", "You don't have enough funds in your balance.", "На балансе недостаточно средств."));
      return;
    }
    if (onSave(selectedGoal, n)) onClose();
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-end justify-center z-50" onClick={onClose}>
      <div className="w-full max-w-sm bg-card rounded-t-3xl p-6 pb-10" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-5">
          <h3 className="font-bold text-lg text-foreground">{tr("Maqsadga tejash", "Save toward a goal", "Копить на цель")}</h3>
          <CloseButton onClick={onClose} />
        </div>
        <p className="text-xs text-muted-foreground mb-4">
          {tr("Mavjud balans:", "Available balance:", "Доступный баланс:")} <span className="font-bold text-foreground" style={{ fontFamily: "DM Mono, monospace" }}>{formatMoney(balance)}</span>
        </p>
        <label className="block text-xs font-semibold text-muted-foreground mb-2 uppercase tracking-wide">{tr("Maqsad tanlang", "Choose a goal", "Выберите цель")}</label>
        <div className="space-y-2 mb-4 max-h-40 overflow-y-auto">
          {activeGoals.map((g) => {
            const pct = Math.round((g.saved / g.target) * 100);
            return (
              <Btn key={g.id} onClick={() => setSelectedGoal(g.id)}
                className={`w-full flex items-center gap-3 p-3 rounded-xl border-2 text-left transition-colors ${
                  selectedGoal === g.id ? "border-primary bg-secondary" : "border-border bg-input-background hover:border-primary/40"}`}>
                <span className="text-xl">{g.emoji}</span>
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-sm text-foreground truncate">{g.title}</p>
                  <p className="text-xs text-muted-foreground">{pct}% {tr("bajarildi", "complete", "выполнено")}</p>
                </div>
                {selectedGoal === g.id && <Check size={16} className="text-primary shrink-0" />}
              </Btn>
            );
          })}
        </div>
        <label className="block text-xs font-semibold text-muted-foreground mb-1 uppercase tracking-wide">{tr(`Miqdor (${currencyName()})`, `Amount (${currencyName()})`, `Сумма (${currencyName()})`)}</label>
        <input type="number" min="0" max="1000000000000" step={ACTIVE_CURRENCY === "UZS" ? "1" : "0.01"} placeholder="0" value={amount} onChange={(e) => setAmount(e.target.value)}
          className="w-full px-4 py-3 rounded-xl bg-input-background border border-border text-foreground text-xl font-bold placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-ring mb-5"
          style={{ fontFamily: "DM Mono, monospace" }} />
        <Btn sound="save" onClick={handle} disabled={!amount || !selectedGoal || parseMoney(amount) <= 0}
          className="w-full py-3.5 rounded-xl bg-primary text-primary-foreground font-bold hover:opacity-90 disabled:opacity-40">
          {tr("Tejash", "Save", "Копить")}
        </Btn>
      </div>
    </div>
  );
}

// ─── Weekly Bar Chart ─────────────────────────────────────────────────────────

function WeeklyBarChart({ data }: { data: { date: string; label: string; sum: number }[] }) {
  const [activeIdx, setActiveIdx] = useState<number | null>(null);
  const max = Math.max(...data.map((d) => d.sum), 1);
  const H = 120; const barW = 30; const gap = 7;
  const totalW = data.length * (barW + gap) - gap;
  const labelH = 20; const tipH = 22;
  return (
    <svg width="100%" viewBox={`0 0 ${totalW} ${H + labelH + tipH}`} preserveAspectRatio="xMidYMid meet"
      style={{ userSelect: "none", touchAction: "none" }}>
      {data.map((d, i) => {
        const barH = Math.max(4, (d.sum / max) * H);
        const x = i * (barW + gap); const y = tipH + H - barH;
        const isActive = activeIdx === i; const cx = x + barW / 2;
        return (
          <g key={d.date} onPointerEnter={() => setActiveIdx(i)} onPointerLeave={() => setActiveIdx(null)}
            onPointerDown={() => setActiveIdx(i)} onPointerUp={() => setTimeout(() => setActiveIdx(null), 1200)}
            style={{ cursor: "pointer" }}>
            <rect x={x} y={tipH} width={barW} height={H} fill="transparent" />
            {isActive && d.sum > 0 && (
              <>
                <rect x={Math.min(Math.max(cx - 38, 0), totalW - 76)} y={0} width={76} height={tipH - 2} rx={6} fill="var(--primary)" />
                <text x={Math.min(Math.max(cx, 38), totalW - 38)} y={tipH - 7} textAnchor="middle" fontSize={9.5}
                  fontWeight="700" fill="var(--primary-foreground)" fontFamily="DM Mono, monospace">{formatMoney(d.sum)}</text>
              </>
            )}
            {isActive && d.sum === 0 && (
              <>
                <rect x={Math.min(Math.max(cx - 24, 0), totalW - 48)} y={0} width={48} height={tipH - 2} rx={6} fill="var(--muted)" />
                <text x={Math.min(Math.max(cx, 24), totalW - 24)} y={tipH - 7} textAnchor="middle" fontSize={9}
                  fill="var(--muted-foreground)" fontFamily="Nunito, sans-serif">{formatMoney(0)}</text>
              </>
            )}
            <rect x={x} y={y} width={barW} height={barH} rx={6}
              fill={isActive ? "var(--accent)" : "var(--primary)"} opacity={isActive ? 1 : 0.82} />
            <text x={cx} y={tipH + H + labelH - 4} textAnchor="middle" fontSize={11}
              fill={isActive ? "var(--primary)" : "var(--muted-foreground)"}
              fontWeight={isActive ? "700" : "400"} fontFamily="Nunito, sans-serif">{d.label}</text>
          </g>
        );
      })}
    </svg>
  );
}

function MoneyDetailsModal({ initialKind, events, totalEarned, totalSaved, onClose }: {
  initialKind: "earned" | "saved"; events: MoneyEvent[]; totalEarned: number; totalSaved: number; onClose: () => void;
}) {
  const kind = initialKind;
  const [range, setRange] = useState<7 | 30 | 90>(30);
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  const total = kind === "earned" ? totalEarned : totalSaved;
  const currentEvents = events.filter((event) => event.kind === kind);
  const dates = Array.from({ length: range }, (_, index) => {
    const date = new Date(); date.setDate(date.getDate() - (range - 1 - index));
    return localDayStr(date);
  });
  const daily = dates.map((date) => ({
    date,
    label: dayLabel(date),
    amount: currentEvents.filter((event) => event.date === date).reduce((sum, event) => sum + event.amount, 0),
  }));
  const activeDays = daily.filter((day) => day.amount > 0);
  const topDay = activeDays.reduce<typeof activeDays[number] | null>((best, day) => !best || day.amount > best.amount ? day : best, null);
  const lowDay = activeDays.reduce<typeof activeDays[number] | null>((best, day) => !best || day.amount < best.amount ? day : best, null);
  const periodTotal = daily.reduce((sum, day) => sum + day.amount, 0);
  const average = activeDays.length ? periodTotal / activeDays.length : 0;
  const chartDays = daily.slice(-7);
  const maxBar = Math.max(...chartDays.map((day) => day.amount), 1);
  const dailyRows = activeDays.slice().sort((left, right) => right.date.localeCompare(left.date)).slice(0, 12);
  const kindLabel = kind === "earned" ? tr("Topilgan mablag'", "Earned money", "Получено") : tr("Tejalgan mablag'", "Money saved", "Отложено");
  return (
    <div className="fixed inset-0 z-[80] flex items-end justify-center bg-black/55 p-2 backdrop-blur-sm sm:items-center sm:p-4" onClick={onClose}>
      <section className="flex max-h-[92dvh] w-full max-w-lg flex-col overflow-hidden rounded-t-[2rem] border border-border bg-card shadow-2xl sm:rounded-[2rem]" onClick={(event) => event.stopPropagation()}>
        <header className="flex items-center gap-3 border-b border-border px-5 py-4">
          <div className={`flex h-11 w-11 items-center justify-center rounded-2xl ${kind === "earned" ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300" : "bg-sky-100 text-sky-700 dark:bg-sky-900/40 dark:text-sky-300"}`}>{kind === "earned" ? <TrendingUp size={21}/> : <PiggyBank size={21}/>}</div>
          <div className="min-w-0 flex-1"><h2 className="text-lg font-extrabold text-foreground">{kind === "earned" ? tr("Topilgan pul tafsilotlari", "Earned money details", "Детали полученных средств") : tr("Tejalgan pul tafsilotlari", "Saved money details", "Детали сбережений")}</h2><p className="text-xs text-muted-foreground">{kindLabel}</p></div>
          <CloseButton onClick={onClose} />
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-5 pt-4">
          <div className="mt-3 rounded-3xl bg-gradient-to-br from-primary/15 via-primary/5 to-secondary p-4">
            <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">{tr("Jami hisob", "Lifetime total", "Всего")}</p>
            <p className="mt-1 text-3xl font-black tracking-tight text-foreground" style={{ fontFamily: "DM Mono, monospace" }}>{formatMoney(total)}</p>
            <p className="mt-1 text-xs text-muted-foreground">{currentEvents.length} {tr("ta yozuv", "entries", "записей")}</p>
          </div>
          <div className="mt-4 flex items-center justify-between gap-2"><h3 className="font-extrabold text-foreground">{tr("Kunlik tahlil", "Daily overview", "По дням")}</h3><div className="flex rounded-xl bg-secondary p-1">{([7, 30, 90] as const).map((days) => <Btn key={days} sound="nav" onClick={() => { setRange(days); setSelectedDay(null); }} className={`rounded-lg px-2.5 py-1.5 text-[10px] font-extrabold ${range === days ? "bg-card text-primary shadow-sm" : "text-muted-foreground"}`}>{days} {tr("kun", "days", "дн.")}</Btn>)}</div></div>
          <div className="mt-3 rounded-2xl border border-border bg-background/70 p-3">
            <div className="flex h-28 items-end justify-between gap-1.5">{chartDays.map((day) => <button key={day.date} aria-label={`${day.date}: ${formatMoney(day.amount)}`} onClick={() => { sfx.nav(); setSelectedDay(day.date); }} className="group flex h-full min-w-0 flex-1 flex-col items-center justify-end gap-1.5 rounded-xl px-0.5 pt-2 focus:outline-none focus:ring-2 focus:ring-ring">
              <span className={`w-full max-w-8 rounded-t-lg transition-all duration-500 ${selectedDay === day.date ? "bg-accent" : "bg-primary/80 group-hover:bg-primary"}`} style={{ height: `${Math.max(5, Math.round(day.amount / maxBar * 76))}px` }}/>
              <span className={`text-[9px] font-bold ${selectedDay === day.date ? "text-primary" : "text-muted-foreground"}`}>{day.label}</span>
            </button>)}</div>
            {selectedDay && <p className="mt-2 text-center text-xs font-bold text-primary">{selectedDay} · {formatMoney(daily.find((day) => day.date === selectedDay)?.amount ?? 0)}</p>}
          </div>
          <div className="mt-3 grid grid-cols-2 gap-2">
            <div className="rounded-2xl border border-emerald-200/70 bg-emerald-50/80 p-3 dark:border-emerald-900/50 dark:bg-emerald-950/20"><p className="text-[10px] font-bold uppercase tracking-wide text-emerald-700 dark:text-emerald-300">{tr("Eng ko'p", "Highest day", "Максимум")}</p>{topDay ? <><p className="mt-1 text-xs font-bold text-foreground">{topDay.date}</p><p className="text-sm font-extrabold text-foreground">{formatMoney(topDay.amount)}</p></> : <p className="mt-2 text-xs text-muted-foreground">{tr("Yozuv yo'q", "No entries", "Нет записей")}</p>}</div>
            <div className="rounded-2xl border border-sky-200/70 bg-sky-50/80 p-3 dark:border-sky-900/50 dark:bg-sky-950/20"><p className="text-[10px] font-bold uppercase tracking-wide text-sky-700 dark:text-sky-300">{tr("Eng kam (faol kun)", "Lowest active day", "Минимум за активный день")}</p>{lowDay ? <><p className="mt-1 text-xs font-bold text-foreground">{lowDay.date}</p><p className="text-sm font-extrabold text-foreground">{formatMoney(lowDay.amount)}</p></> : <p className="mt-2 text-xs text-muted-foreground">{tr("Yozuv yo'q", "No entries", "Нет записей")}</p>}</div>
          </div>
          <p className="mt-2 text-center text-[11px] text-muted-foreground">{tr(`${range} kunda faol kunlik o'rtacha: ${formatMoney(average)}`, `Active-day average over ${range} days: ${formatMoney(average)}`, `Среднее за активный день за ${range} дн.: ${formatMoney(average)}`)}</p>
          <h3 className="mb-2 mt-5 font-extrabold text-foreground">{tr("Kunlar bo'yicha yozuvlar", "Daily entries", "Записи по дням")}</h3>
          {activeDays.length === 0 ? <div className="rounded-2xl border border-dashed border-border bg-secondary/40 p-4 text-center"><p className="text-sm font-bold text-foreground">{tr("Bu davrda yozuv yo'q", "No entries in this period", "За этот период записей нет")}</p><p className="mt-1 text-xs text-muted-foreground">{total > 0 ? tr("Oldingi umumiy summa saqlangan. Kunlik tahlil yangi kiritilgan ma'lumotlardan yig'iladi.", "Your previous total is preserved. Daily details start with new entries.", "Предыдущая общая сумма сохранена. Подробная статистика начнётся с новых записей.") : tr("Mablag' qo'shing yoki maqsadga tejang — kunlik ma'lumotlar shu yerda ko'rinadi.", "Add money or save toward a goal to see daily details here.", "Добавьте доход или отложите деньги на цель, чтобы видеть статистику.")}</p></div> : <div className="space-y-2">{dailyRows.map((day) => <div key={day.date} className="flex items-center gap-3 rounded-xl border border-border/70 bg-background/60 px-3 py-2.5"><span className={`flex h-8 w-8 items-center justify-center rounded-lg ${kind === "earned" ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40" : "bg-sky-100 text-sky-700 dark:bg-sky-900/40"}`}>{kind === "earned" ? <TrendingUp size={15}/> : <PiggyBank size={15}/>}</span><div className="min-w-0 flex-1"><p className="truncate text-xs font-bold text-foreground">{day.date} · {day.label}</p><p className="text-[10px] text-muted-foreground">{currentEvents.filter((event) => event.date === day.date).length} {tr("ta amal", "entries", "операций")}</p></div><p className="shrink-0 text-xs font-extrabold text-foreground" style={{fontFamily:"DM Mono, monospace"}}>{formatMoney(day.amount)}</p></div>)}</div>}
        </div>
      </section>
    </div>
  );
}

// ─── Home Tab ─────────────────────────────────────────────────────────────────

function HomeTab({ user, balance, expenses, goals, moneyEvents, totalEarned, totalSaved, entriesLeft, cosmetics, onSetBalance, onAddExpense, onSaveToGoal }: {
  user: User; balance: number; expenses: Expense[]; goals: Goal[]; moneyEvents: MoneyEvent[]; totalEarned: number; totalSaved: number; entriesLeft: number; cosmetics: Partial<Record<CosmeticSlot, string>>;
  onSetBalance: (n: number) => boolean;
  onAddExpense: (e: Omit<Expense, "id">) => boolean;
  onSaveToGoal: (goalId: string, amount: number) => boolean;
}) {
  const [showBalance, setShowBalance] = useState(false);
  const [showExpense, setShowExpense] = useState(false);
  const [showSaveGoal, setShowSaveGoal] = useState(false);
  const [showMoneyDetail, setShowMoneyDetail] = useState<"earned" | "saved" | null>(null);

  const days = last7Days();
  const chartData = days.map((d) => ({
    date: d, label: dayLabel(d),
    sum: expenses.filter((e) => e.date === d).reduce((a, b) => a + b.amount, 0),
  }));
  const todayExpenses = expenses.filter((e) => e.date === todayStr());
  const todayTotal = todayExpenses.reduce((a, b) => a + b.amount, 0);
  const weekStart = days[0];
  const weekTotal = expenses.filter((e) => e.date >= weekStart && e.date <= todayStr()).reduce((a, b) => a + b.amount, 0);
  const categoryTotals = CATEGORIES.map((category) => ({
    ...category,
    amount: expenses.filter((e) => e.category === category.id && e.date >= weekStart && e.date <= todayStr()).reduce((sum, expense) => sum + expense.amount, 0),
  })).filter((category) => category.amount > 0).sort((a, b) => b.amount - a.amount);
  const maxCategoryTotal = categoryTotals[0]?.amount ?? 1;
  const getCatLabel = (id: string) => {
    const label = CATEGORIES.find((c) => c.id === id)?.label;
    return label ? lt(label) : id;
  };

  return (
    <div className="flex-1 overflow-y-auto pb-24">
      <div className="bg-primary px-5 pt-10 pb-20">
        <div className="flex items-center gap-3">
          <ProfileAvatar name={user.name} avatar={user.avatar} decoration={cosmetics.avatar} className="h-12 w-12 rounded-2xl" />
          <div className="min-w-0">
            <p className="text-primary-foreground/70 text-xs">{tr("Salom,", "Hello,", "Привет,")}</p>
            <div className="inline-block bg-white/15 rounded-xl px-3 py-1 mt-0.5 max-w-[200px]">
              <p className="text-primary-foreground font-bold text-base truncate leading-tight"><DecoratedName name={user.name} decoration={cosmetics.name} /> 👋</p>
            </div>
          </div>
        </div>
      </div>
      <div className="px-4 -mt-14 space-y-4">
        <div className="bg-card rounded-2xl shadow-lg p-5" data-tour="home-balance">
          <p className="text-muted-foreground text-xs font-semibold uppercase tracking-wide mb-1">{tr("Hozirgi mablag'", "Current balance", "Текущий баланс")}</p>
          <p className="text-3xl font-bold text-foreground mb-4" style={{ fontFamily: "DM Mono, monospace" }}>{formatMoney(balance)}</p>
          <div className="grid grid-cols-3 gap-2" data-tour="home-actions">
            <Btn onClick={() => setShowBalance(true)}
              className="flex items-center justify-center gap-1.5 py-2.5 rounded-xl bg-secondary text-primary font-semibold text-xs hover:bg-primary hover:text-primary-foreground transition-colors">
              <Wallet size={14} />{tr("Mablag'", "Balance", "Баланс")}
            </Btn>
            <Btn onClick={() => setShowExpense(true)}
              className="flex items-center justify-center gap-1.5 py-2.5 rounded-xl bg-secondary text-primary font-semibold text-xs hover:bg-primary hover:text-primary-foreground transition-colors">
              <Plus size={14} />{tr("Xarajat", "Expense", "Расход")}
            </Btn>
            <Btn onClick={() => setShowSaveGoal(true)}
              className="flex items-center justify-center gap-1.5 py-2.5 rounded-xl bg-secondary text-primary font-semibold text-xs hover:bg-primary hover:text-primary-foreground transition-colors">
              <PiggyBank size={14} />{tr("Tejash", "Save", "Копить")}
            </Btn>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="bg-card rounded-2xl p-4">
            <div className="flex items-center gap-2 mb-2">
              <div className="w-8 h-8 rounded-lg bg-red-100 dark:bg-red-900/30 flex items-center justify-center">
                <TrendingDown size={16} className="text-red-500" />
              </div>
              <span className="text-xs text-muted-foreground font-medium">{tr("Bugun", "Today", "Сегодня")}</span>
            </div>
            <p className="font-bold text-foreground" style={{ fontFamily: "DM Mono, monospace", fontSize: "14px" }}>{formatMoney(todayTotal)}</p>
          </div>
          <div className="bg-card rounded-2xl p-4">
            <div className="flex items-center gap-2 mb-2">
              <div className="w-8 h-8 rounded-lg bg-amber-100 dark:bg-amber-900/30 flex items-center justify-center">
                <TrendingUp size={16} className="text-amber-500" />
              </div>
              <span className="text-xs text-muted-foreground font-medium">{tr("Bu hafta", "This week", "Эта неделя")}</span>
            </div>
            <p className="font-bold text-foreground" style={{ fontFamily: "DM Mono, monospace", fontSize: "14px" }}>{formatMoney(weekTotal)}</p>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Btn sound="click" onClick={() => setShowMoneyDetail("earned")} aria-label={tr("Topilgan mablag' tafsilotlari", "Earned money details", "Детали дохода")} className="group bg-card rounded-2xl p-4 border border-emerald-200/60 dark:border-emerald-900/50 text-left shadow-sm hover:-translate-y-0.5 hover:shadow-md transition-all">
            <div className="flex items-center gap-2 mb-2"><div className="w-8 h-8 rounded-lg bg-emerald-100 dark:bg-emerald-900/30 flex items-center justify-center"><TrendingUp size={16} className="text-emerald-600" /></div><span className="text-xs text-muted-foreground font-medium">{tr("Topilgan jami", "Total earned", "Всего получено")}</span></div>
            <p className="font-bold text-foreground" style={{ fontFamily: "DM Mono, monospace", fontSize: "14px" }}>{formatMoney(totalEarned)}</p>
            <p className="mt-2 flex items-center gap-1 text-[10px] font-bold text-emerald-700 dark:text-emerald-300">{tr("Kunlik tahlil", "Daily details", "Детали по дням")} <ChevronDown size={12} className="-rotate-90 transition-transform group-hover:translate-x-0.5"/></p>
          </Btn>
          <Btn sound="click" onClick={() => setShowMoneyDetail("saved")} aria-label={tr("Tejalgan mablag' tafsilotlari", "Saved money details", "Детали накоплений")} className="group bg-card rounded-2xl p-4 border border-sky-200/60 dark:border-sky-900/50 text-left shadow-sm hover:-translate-y-0.5 hover:shadow-md transition-all">
            <div className="flex items-center gap-2 mb-2"><div className="w-8 h-8 rounded-lg bg-sky-100 dark:bg-sky-900/30 flex items-center justify-center"><PiggyBank size={16} className="text-sky-600" /></div><span className="text-xs text-muted-foreground font-medium">{tr("Tejalgan jami", "Total saved", "Всего отложено")}</span></div>
            <p className="font-bold text-foreground" style={{ fontFamily: "DM Mono, monospace", fontSize: "14px" }}>{formatMoney(totalSaved)}</p>
            <p className="mt-2 flex items-center gap-1 text-[10px] font-bold text-sky-700 dark:text-sky-300">{tr("Kunlik tahlil", "Daily details", "Детали по дням")} <ChevronDown size={12} className="-rotate-90 transition-transform group-hover:translate-x-0.5"/></p>
          </Btn>
        </div>
        <div className="bg-card rounded-2xl p-4" data-tour="statistics">
          <h3 className="font-bold text-foreground mb-3">{tr("Haftalik statistika", "Weekly statistics", "Статистика за неделю")}</h3>
          <WeeklyBarChart data={chartData} />
        </div>
        <div className="bg-card rounded-2xl p-4 border border-primary/10">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-bold text-foreground">{tr("Hafta sarflari", "Weekly spending", "Расходы за неделю")}</h3>
            <span className="text-xs font-bold text-primary">{formatMoney(weekTotal)}</span>
          </div>
          {categoryTotals.length === 0 ? <p className="text-xs text-muted-foreground">{tr("Xarajat qo'shsangiz, toifalar shu yerda ko'rinadi.", "Add an expense to see your category breakdown.", "Добавьте расход, чтобы увидеть разбивку по категориям.")}</p> : (
            <div className="space-y-3">
              {categoryTotals.slice(0, 3).map(({ id, label, icon: Icon, amount }) => (
                <div key={id}>
                  <div className="flex items-center justify-between text-xs mb-1.5">
                    <span className="inline-flex items-center gap-1.5 text-foreground font-semibold"><Icon size={13} className="text-primary" />{lt(label)}</span>
                    <span className="text-muted-foreground">{formatMoney(amount)}</span>
                  </div>
                  <div className="h-2 rounded-full bg-secondary overflow-hidden"><div className="h-full rounded-full bg-primary transition-all" style={{ width: `${Math.max(5, amount / maxCategoryTotal * 100)}%` }} /></div>
                </div>
              ))}
              <p className="pt-1 text-[11px] text-muted-foreground">{tr("Eng ko'p xarajat qilgan toifangiz yuqorida.", "Your highest spending category is shown first.", "Сверху показана категория с самыми высокими расходами.")}</p>
            </div>
          )}
        </div>
        <div className="bg-card rounded-2xl p-4" data-tour="expenses">
          <h3 className="font-bold text-foreground mb-3">{tr("Bugungi xarajatlar", "Today's expenses", "Расходы сегодня")}</h3>
          {todayExpenses.length === 0
            ? <p className="text-muted-foreground text-sm text-center py-4">{tr("Bugun hali xarajat yo'q", "No expenses today", "Сегодня расходов нет")}</p>
            : (
              <div className="space-y-2">
                {todayExpenses.map((e) => {
                  const cat = CATEGORIES.find((c) => c.id === e.category);
                  const Icon = cat?.icon ?? MoreHorizontal;
                  return (
                    <div key={e.id} className="flex items-center gap-3 py-2">
                      <div className="w-9 h-9 rounded-xl bg-secondary flex items-center justify-center shrink-0">
                        <Icon size={16} className="text-primary" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="font-semibold text-sm text-foreground truncate">{e.note || getCatLabel(e.category)}</p>
                        <p className="text-xs text-muted-foreground">{getCatLabel(e.category)}</p>
                      </div>
                      <p className="font-bold text-sm text-foreground shrink-0" style={{ fontFamily: "DM Mono, monospace" }}>-{formatMoney(e.amount)}</p>
                    </div>
                  );
                })}
              </div>
            )}
        </div>
      </div>
      {showBalance && <SetBalanceModal current={balance} entriesLeft={entriesLeft} onClose={() => setShowBalance(false)} onSave={onSetBalance} />}
      {showExpense && <AddExpenseModal balance={balance} onClose={() => setShowExpense(false)} onSave={onAddExpense} />}
      {showSaveGoal && <SaveToGoalModal balance={balance} goals={goals} onClose={() => setShowSaveGoal(false)} onSave={onSaveToGoal} />}
      {showMoneyDetail && <MoneyDetailsModal initialKind={showMoneyDetail} events={moneyEvents} totalEarned={totalEarned} totalSaved={totalSaved} onClose={() => setShowMoneyDetail(null)} />}
    </div>
  );
}

// ─── Goal Form ────────────────────────────────────────────────────────────────

function GoalForm({ onSave, onClose, initial }: { onSave: (g: Omit<Goal, "id">) => void; onClose: () => void; initial?: Goal; }) {
  const [title, setTitle] = useState(initial?.title ?? "");
  const [target, setTarget] = useState(initial?.target ? String(initial.target) : "");
  const [emoji, setEmoji] = useState(initial?.emoji ?? "🎯");
  return (
    <div className="fixed inset-0 bg-black/50 flex items-end justify-center z-50" onClick={onClose}>
      <div className="w-full max-w-sm bg-card rounded-t-3xl p-6 pb-10" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-5">
          <h3 className="font-bold text-lg text-foreground">{initial ? tr("Maqsadni tahrirlash", "Edit goal", "Изменить цель") : tr("Yangi maqsad", "New goal", "Новая цель")}</h3>
          <CloseButton onClick={onClose} />
        </div>
        <label className="block text-xs font-semibold text-muted-foreground mb-2 uppercase tracking-wide">{tr("Belgi", "Icon", "Значок")}</label>
        <div className="flex flex-wrap gap-2 mb-4">
          {GOAL_EMOJIS.map((e) => (
            <Btn key={e} onClick={() => setEmoji(e)}
              className={`w-10 h-10 rounded-xl text-xl flex items-center justify-center transition-colors ${emoji === e ? "bg-primary" : "bg-input-background hover:bg-secondary"}`}>
              {e}
            </Btn>
          ))}
        </div>
        <label className="block text-xs font-semibold text-muted-foreground mb-1 uppercase tracking-wide">{tr("Maqsad nomi", "Goal name", "Название цели")}</label>
        <input type="text" maxLength={80} placeholder={tr("Masalan: Yangi telefon", "For example: New phone", "Например: Новый телефон")} value={title} onChange={(e) => setTitle(e.target.value)}
          className="w-full px-4 py-3 rounded-xl bg-input-background border border-border text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring mb-3" />
        <label className="block text-xs font-semibold text-muted-foreground mb-1 uppercase tracking-wide">{tr(`Maqsad miqdori (${currencyName()})`, `Goal amount (${currencyName()})`, `Сумма цели (${currencyName()})`)}</label>
        <input type="number" min="0" max="1000000000000" step={ACTIVE_CURRENCY === "UZS" ? "1" : "0.01"} placeholder="0" value={target} onChange={(e) => setTarget(e.target.value)}
          className="w-full px-4 py-3 rounded-xl bg-input-background border border-border text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring mb-3"
          style={{ fontFamily: "DM Mono, monospace" }} />
        {initial && <p className="text-xs text-muted-foreground mb-5">{tr(`Yig'ilgan summa o'zgarmaydi: ${formatMoney(initial.saved)}. Yangi mablag'ni Asosiy sahifadagi «Tejash» orqali qo'shing.`, `Saved funds stay at ${formatMoney(initial.saved)}. Add money through Save on the Home screen.`, `Накопленная сумма (${formatMoney(initial.saved)}) сохраняется. Пополняйте цель через «Копить» на главном экране.`)}</p>}
        <Btn sound="save" disabled={!title.trim() || !target}
          onClick={() => onSave({ title: title.trim(), target: parseMoney(target), saved: initial?.saved ?? 0, emoji })}
          className="w-full py-3.5 rounded-xl bg-primary text-primary-foreground font-bold hover:opacity-90 disabled:opacity-40">
          {initial ? tr("Saqlash", "Save", "Сохранить") : tr("Qo'shish", "Add", "Добавить")}
        </Btn>
      </div>
    </div>
  );
}

// ─── Goals Tab ────────────────────────────────────────────────────────────────

function GoalsTab({ goals, onAdd, onEdit, onDelete }: {
  goals: Goal[]; onAdd: (g: Omit<Goal, "id">) => void;
  onEdit: (id: string, g: Omit<Goal, "id">) => void; onDelete: (id: string) => void;
}) {
  const [subTab, setSubTab] = useState<"current" | "achieved">("current");
  const [showForm, setShowForm] = useState(false);
  const [editGoal, setEditGoal] = useState<Goal | null>(null);

  const currentGoals = goals.filter((g) => !g.achievedAt && g.saved < g.target);
  const achievedGoals = goals.filter((g) => g.achievedAt || g.saved >= g.target);
  const totalSaved = currentGoals.reduce((a, b) => a + b.saved, 0);
  const totalTarget = currentGoals.reduce((a, b) => a + b.target, 0);

  return (
    <div className="flex-1 overflow-y-auto pb-24" data-tour="goals">
      {/* Header */}
      <div className="bg-primary px-5 pt-12 pb-6 rounded-b-[2rem] shadow-lg">
        <div className="inline-flex items-center gap-2 bg-white/15 rounded-2xl px-4 py-2 mb-3">
          <Target size={18} className="text-primary-foreground" />
          <h2 className="text-primary-foreground text-xl font-bold">{tr("Maqsadlarim", "My goals", "Мои цели")}</h2>
        </div>
        {/* Sub-tabs */}
        <div className="grid grid-cols-2 rounded-2xl bg-secondary p-1">
          <Btn sound="nav" onClick={() => setSubTab("current")}
            className={`rounded-xl py-2.5 font-extrabold text-sm transition-all flex items-center justify-center gap-1.5 ${subTab === "current" ? "bg-card text-primary shadow" : "text-muted-foreground"}`}>
            <Target size={14} />{tr("Joriy", "Current", "Текущие")}
            {currentGoals.length > 0 && (
              <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-extrabold ${subTab === "current" ? "bg-primary/10 text-primary" : "bg-secondary text-muted-foreground"}`}>
                {currentGoals.length}
              </span>
            )}
          </Btn>
          <Btn sound="nav" onClick={() => setSubTab("achieved")}
            className={`rounded-xl py-2.5 font-extrabold text-sm transition-all flex items-center justify-center gap-1.5 ${subTab === "achieved" ? "bg-card text-primary shadow" : "text-muted-foreground"}`}>
            <Trophy size={14} />{tr("Erishilgan", "Achieved", "Достигнутые")}
            {achievedGoals.length > 0 && (
              <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-extrabold ${subTab === "achieved" ? "bg-primary/10 text-primary" : "bg-secondary text-muted-foreground"}`}>
                {achievedGoals.length}
              </span>
            )}
          </Btn>
        </div>
      </div>

      <div className="px-4 py-4">
        {/* ── Joriy maqsadlar ── */}
        {subTab === "current" && (
          <>
            {currentGoals.length > 0 && (
              <div className="bg-card rounded-2xl p-4 mb-4">
                <p className="text-xs text-muted-foreground font-semibold uppercase tracking-wide mb-3">{tr("Umumiy holat", "Overall progress", "Общий прогресс")}</p>
                <div className="flex justify-between text-sm mb-2">
                  <span className="text-muted-foreground">{tr("Yig'ilgan", "Saved", "Накоплено")}</span>
                  <span className="font-bold text-primary" style={{ fontFamily: "DM Mono, monospace" }}>{formatMoney(totalSaved)}</span>
                </div>
                <div className="flex justify-between text-sm mb-3">
                  <span className="text-muted-foreground">{tr("Jami maqsad", "Total target", "Общая цель")}</span>
                  <span className="font-bold text-foreground" style={{ fontFamily: "DM Mono, monospace" }}>{formatMoney(totalTarget)}</span>
                </div>
                <div className="w-full bg-muted rounded-full h-2.5">
                  <div className="bg-primary h-2.5 rounded-full transition-all"
                    style={{ width: `${totalTarget ? Math.min(100, (totalSaved / totalTarget) * 100) : 0}%` }} />
                </div>
                <p className="text-right text-xs text-muted-foreground mt-1">
                  {totalTarget ? Math.round((totalSaved / totalTarget) * 100) : 0}%
                </p>
              </div>
            )}

            <div className="space-y-3 mb-4">
              {currentGoals.map((g) => {
                const pct = g.target ? Math.min(100, Math.round((g.saved / g.target) * 100)) : 0;
                const remaining = Math.max(0, g.target - g.saved);
                return (
                  <div key={g.id} className="bg-card rounded-2xl p-4">
                    <div className="flex items-start gap-3">
                      <span className="text-3xl">{g.emoji}</span>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between mb-1">
                          <h3 className="font-bold text-foreground truncate">{g.title}</h3>
                          <div className="flex items-center gap-1 ml-2 shrink-0">
                            <Btn onClick={() => setEditGoal(g)}
                              className="w-7 h-7 rounded-lg bg-secondary flex items-center justify-center text-muted-foreground hover:text-primary transition-colors">
                              <Pencil size={13} />
                            </Btn>
                            <Btn sound="delete" onClick={() => onDelete(g.id)}
                              className="w-7 h-7 rounded-lg bg-secondary flex items-center justify-center text-muted-foreground hover:text-destructive transition-colors">
                              <Trash2 size={13} />
                            </Btn>
                          </div>
                        </div>
                        <div className="flex justify-between text-xs text-muted-foreground mb-2">
                          <span>{formatMoney(g.saved)} / {formatMoney(g.target)}</span>
                          <span className="font-semibold text-primary">{pct}%</span>
                        </div>
                        <div className="w-full bg-muted rounded-full h-2">
                          <div className="bg-primary h-2 rounded-full transition-all" style={{ width: `${pct}%` }} />
                        </div>
                        <p className="text-xs text-muted-foreground mt-2">
                          {tr("Maqsadgacha:", "Remaining:", "Осталось:")} <span className="font-semibold text-foreground" style={{ fontFamily: "DM Mono, monospace" }}>{formatMoney(remaining)}</span>
                        </p>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            {currentGoals.length === 0 && (
              <div className="text-center py-12 text-muted-foreground">
                <Target size={44} className="mx-auto mb-3 opacity-25" />
                <p className="text-sm font-medium">{tr("Hali joriy maqsad yo'q", "No current goals yet", "Текущих целей пока нет")}</p>
                <p className="text-xs mt-1 opacity-70">{tr("Yangi maqsad qo'shing!", "Add a new goal!", "Добавьте новую цель!")}</p>
              </div>
            )}

            <div data-tour="goals-create"><Btn onClick={() => setShowForm(true)}
              className="w-full flex items-center justify-center gap-2 py-3.5 rounded-2xl border-2 border-dashed border-primary/40 text-primary font-semibold text-sm hover:bg-secondary transition-colors">
              <Plus size={18} />{tr("Yangi maqsad qo'shish", "Add new goal", "Добавить цель")}
            </Btn></div>
          </>
        )}

        {/* ── Erishilgan maqsadlar ── */}
        {subTab === "achieved" && (
          <>
            {achievedGoals.length === 0 ? (
              <div className="text-center py-12 text-muted-foreground">
                <Trophy size={44} className="mx-auto mb-3 opacity-25" />
                <p className="text-sm font-medium">{tr("Hali erishilgan maqsad yo'q", "No achieved goals yet", "Достигнутых целей пока нет")}</p>
                <p className="text-xs mt-1 opacity-70">{tr("Maqsadlaringizni bajaring!", "Keep working toward your goals!", "Продолжайте двигаться к целям!")}</p>
              </div>
            ) : (
              <>
                <div className="bg-gradient-to-r from-amber-100 to-yellow-50 dark:from-amber-900/30 dark:to-yellow-900/20 rounded-2xl p-4 mb-4 border border-amber-200 dark:border-amber-700/40">
                  <div className="flex items-center gap-3">
                    <span className="text-3xl">🏆</span>
                    <div>
                      <p className="font-bold text-amber-800 dark:text-amber-300 text-sm">{tr("Tabriklaymiz!", "Congratulations!", "Поздравляем!")}</p>
                      <p className="text-xs text-amber-700 dark:text-amber-400">{tr(`${achievedGoals.length} ta maqsadga erishdingiz`, `${achievedGoals.length} goals achieved`, `Достигнуто целей: ${achievedGoals.length}`)}</p>
                    </div>
                    <div className="ml-auto">
                      <Star size={24} className="text-amber-500" />
                    </div>
                  </div>
                </div>

                <div className="space-y-3">
                  {achievedGoals.map((g) => {
                    const achievedDate = g.achievedAt ? new Date(g.achievedAt).toLocaleDateString(activeLocale()) : "";
                    return (
                      <div key={g.id} className="bg-card rounded-2xl p-4 ring-2 ring-amber-400/30 relative overflow-hidden">
                        {/* Subtle confetti background */}
                        <div className="absolute top-0 right-0 text-6xl opacity-5 leading-none select-none">🎉</div>
                        <div className="flex items-start gap-3">
                          <div className="relative shrink-0">
                            <span className="text-3xl">{g.emoji}</span>
                            <span className="absolute -bottom-1 -right-1 text-sm">✅</span>
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center justify-between mb-1">
                              <h3 className="font-bold text-foreground truncate">{g.title}</h3>
                              <Btn sound="delete" onClick={() => onDelete(g.id)}
                                className="w-7 h-7 rounded-lg bg-secondary flex items-center justify-center text-muted-foreground hover:text-destructive transition-colors ml-2 shrink-0">
                                <Trash2 size={13} />
                              </Btn>
                            </div>
                            <div className="flex justify-between text-xs mb-2">
                              <span className="text-muted-foreground">{formatMoney(g.target)} {tr("yig'ildi", "saved", "накоплено")}</span>
                              <span className="font-bold text-amber-500">100% ✓</span>
                            </div>
                            <div className="w-full bg-amber-100 dark:bg-amber-900/30 rounded-full h-2">
                              <div className="bg-amber-500 h-2 rounded-full w-full" />
                            </div>
                            <div className="flex items-center gap-1.5 mt-2 bg-amber-50 dark:bg-amber-900/20 rounded-lg px-2 py-1">
                              <Check size={13} className="text-amber-600 dark:text-amber-400" />
                              <p className="text-xs text-amber-700 dark:text-amber-300 font-bold">
                                {tr("Maqsadga erishildi!", "Goal achieved!", "Цель достигнута!")} 🎉
                                {achievedDate && <span className="font-normal ml-1 opacity-70">({achievedDate})</span>}
                              </p>
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </>
            )}
          </>
        )}
      </div>

      {showForm && <GoalForm onSave={(g) => { onAdd(g); setShowForm(false); }} onClose={() => setShowForm(false)} />}
      {editGoal && <GoalForm initial={editGoal} onSave={(g) => { onEdit(editGoal.id, g); setEditGoal(null); }} onClose={() => setEditGoal(null)} />}
    </div>
  );
}

// ─── Edit Profile Modal ───────────────────────────────────────────────────────

function EditProfileModal({ user, onSave, onClose }: { user: User; onSave: (u: User) => void; onClose: () => void; }) {
  const [name, setName] = useState(user.name);
  const [avatar, setAvatar] = useState<string | null>(user.avatar);
  const fileRef = useRef<HTMLInputElement>(null);
  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]; if (!f) return;
    readAvatarFile(f, setAvatar);
    e.currentTarget.value = "";
  };
  return (
    <div className="fixed inset-0 bg-black/50 flex items-end justify-center z-50" onClick={onClose}>
      <div className="w-full max-w-sm bg-card rounded-t-3xl p-6 pb-10" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-5">
          <h3 className="font-bold text-lg text-foreground">{tr("Profilni tahrirlash", "Edit profile", "Изменить профиль")}</h3>
          <CloseButton onClick={onClose} />
        </div>
        <div className="flex justify-center mb-5">
          <Btn onClick={() => fileRef.current?.click()}
            className={`relative w-20 h-20 rounded-full overflow-hidden border-2 transition-colors ${!avatar ? "profile-avatar-empty" : "bg-secondary border-primary/30 hover:border-primary"}`}>
            {avatar ? <img src={avatar} alt="" className="w-full h-full object-cover" />
              : <div className="w-full h-full flex items-center justify-center text-2xl font-bold text-primary">{name[0]?.toUpperCase() ?? "?"}</div>}
            <div className="absolute bottom-0 right-0 w-6 h-6 bg-primary rounded-full flex items-center justify-center">
              <Camera size={12} className="text-primary-foreground" />
            </div>
          </Btn>
          <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp,image/gif" className="hidden" onChange={handleFile} />
        </div>
        <label className="block text-xs font-semibold text-muted-foreground mb-1 uppercase tracking-wide">{tr("Ism", "Name", "Имя")}</label>
        <input type="text" value={name} onChange={(e) => setName(e.target.value)}
          className="w-full px-4 py-3 rounded-xl bg-input-background border border-border text-foreground focus:outline-none focus:ring-2 focus:ring-ring mb-5" />
        <Btn disabled={!name.trim()} onClick={() => { onSave({ ...user, name: name.trim(), avatar }); onClose(); }}
          className="w-full py-3.5 rounded-xl bg-primary text-primary-foreground font-bold hover:opacity-90 disabled:opacity-40">
          {tr("Saqlash", "Save", "Сохранить")}
        </Btn>
      </div>
    </div>
  );
}

// ─── Accordion ────────────────────────────────────────────────────────────────

function Accordion({ q, a }: { q: string; a: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="border-b border-border last:border-0">
      <Btn onClick={() => setOpen((v) => !v)} className="w-full flex items-center justify-between gap-3 py-3.5 text-left">
        <span className="font-semibold text-sm text-foreground flex-1">{q}</span>
        {open ? <ChevronUp size={16} className="text-muted-foreground shrink-0" /> : <ChevronDown size={16} className="text-muted-foreground shrink-0" />}
      </Btn>
      {open && <p className="text-sm text-muted-foreground pb-3.5 leading-relaxed">{a}</p>}
    </div>
  );
}

function ProfileAvatar({ name, avatar, decoration, className = "" }: { name: string; avatar?: string | null; decoration?: string; className?: string }) {
  return (
    <div className={`profile-avatar-wrap ${!avatar ? "profile-avatar-empty" : ""} ${decoration ? `profile-frame-${decoration}` : ""} ${className}`}>
      {avatar ? <img src={avatar} alt={name} className="h-full w-full rounded-full object-cover" />
        : <span className="profile-avatar-initial">{name.trim().charAt(0).toUpperCase()}</span>}
      {decoration === "avatar_aurora" && <span className="profile-frame-spark" aria-hidden="true">✦</span>}
      {decoration === "avatar_bloom" && <span className="profile-frame-spark" aria-hidden="true">❀</span>}
      {decoration === "avatar_comet" && <span className="profile-frame-spark" aria-hidden="true">☄</span>}
    </div>
  );
}

function DecoratedName({ name, decoration, className = "" }: { name: string; decoration?: string; className?: string }) {
  return <span className={`profile-name ${decoration ? `profile-name-${decoration}` : ""} ${className}`}>{name}{decoration === "name_solar" && <span className="ml-1 text-amber-400" aria-hidden="true">✦</span>}{decoration === "name_rose" && <span className="ml-1 text-pink-400" aria-hidden="true">❀</span>}</span>;
}

function CosmeticPreview({ item }: { item: CosmeticItem }) {
  if (item.slot === "avatar") return <div className="flex items-center justify-center py-2"><ProfileAvatar name="H" decoration={item.id} className="h-16 w-16" /></div>;
  if (item.slot === "name") return <div className="flex items-center justify-center py-2"><DecoratedName name="Hamyonchi" decoration={item.id} className="text-lg font-extrabold" /></div>;
  if (item.slot === "helper") return <div className="flex items-center justify-center py-2"><WalletAvatar mood="🤩" skin={item.id} className="h-14 w-16" /></div>;
  const themePreview: Record<string, string> = {
    theme_sakura: "from-pink-100 via-rose-50 to-fuchsia-100",
    theme_ocean: "from-sky-100 via-cyan-50 to-blue-200",
    theme_cosmos: "from-indigo-950 via-violet-950 to-slate-900",
  };
  return <div className={`mx-auto my-2 h-16 w-full max-w-[170px] rounded-2xl bg-gradient-to-br ${themePreview[item.id] ?? "from-primary/20 to-secondary"} p-2 shadow-inner`}><div className="flex h-full items-end gap-1"><span className="h-6 w-9 rounded-t-lg bg-white/75 shadow-sm"/><span className="h-9 flex-1 rounded-xl bg-white/85 shadow-sm"/><span className="h-5 w-7 rounded-t-lg bg-primary/50"/></div></div>;
}

function MarketTab({ language, coins, owned, equipped, onBuy, onEquip }: {
  language: Language; coins: number; owned: string[]; equipped: Partial<Record<CosmeticSlot, string>>;
  onBuy: (id: string) => boolean; onEquip: (id: string) => void;
}) {
  const [view, setView] = useState<"shop" | "owned">("shop");
  const [filter, setFilter] = useState<CosmeticSlot | "all">("all");
  const title = (item: CosmeticItem) => item.title[language === "en" ? 1 : language === "ru" ? 2 : 0];
  const description = (item: CosmeticItem) => item.description[language === "en" ? 1 : language === "ru" ? 2 : 0];
  const slotTitle = (slot: CosmeticSlot) => ({ avatar: tr("Profil ramkasi", "Avatar frames", "Рамки профиля"), name: tr("Nik bezagi", "Name styles", "Стили имени"), theme: tr("Ilova mavzusi", "App themes", "Темы приложения"), helper: tr("Yordamchi", "Helper looks", "Образы помощника") })[slot];
  const filters: (CosmeticSlot | "all")[] = ["all", "avatar", "name", "theme", "helper"];
  const items = COSMETICS.filter((item) => (view === "owned" ? owned.includes(item.id) : !owned.includes(item.id)) && (filter === "all" || item.slot === filter));
  return (
    <div className="flex-1 overflow-y-auto pb-24" data-tour="market">
      <div className="bg-primary px-5 pt-12 pb-6 rounded-b-[2rem] shadow-lg">
        <div className="flex items-center justify-between gap-3">
          <div><div className="inline-flex items-center gap-2 bg-white/15 rounded-2xl px-4 py-2"><Store size={19} className="text-primary-foreground"/><h2 className="text-primary-foreground text-xl font-bold">{COPY[language].market}</h2></div><p className="text-primary-foreground/70 text-sm mt-2 px-1">{tr("Barcha bezaklar bepul — xohlaganingizni tanlang.", "Every cosmetic is free. Pick your favorites.", "Все украшения бесплатны — выбирайте любые.")}</p></div>
          <div className="shrink-0 rounded-2xl border border-white/20 bg-white/15 px-3 py-2 text-center text-white shadow-inner"><span className="block text-[10px] font-bold uppercase tracking-wide text-white/70">{tr("Tangalar", "Coins", "Монеты")}</span><span className="text-lg font-extrabold">{coins} 🪙</span></div>
        </div>
      </div>
      <div className="px-4 pt-4">
        <div className="grid grid-cols-2 rounded-2xl bg-secondary p-1 mb-4">
          <Btn sound="nav" onClick={() => setView("shop")} className={`rounded-xl py-2.5 text-sm font-extrabold transition-all ${view === "shop" ? "bg-card text-primary shadow" : "text-muted-foreground"}`}><ShoppingBag size={15} className="inline mr-1.5"/>{tr("Do'kon", "Shop", "Магазин")}</Btn>
          <Btn sound="nav" onClick={() => setView("owned")} className={`rounded-xl py-2.5 text-sm font-extrabold transition-all ${view === "owned" ? "bg-card text-primary shadow" : "text-muted-foreground"}`}><Check size={15} className="inline mr-1.5"/>{tr("Olinganlar", "Owned", "Куплено")} <span className="ml-1 rounded-full bg-primary/10 px-1.5 text-[10px]">{owned.length}</span></Btn>
        </div>
        <div className="flex gap-2 overflow-x-auto pb-3 no-scrollbar">{filters.map((slot) => <Btn key={slot} sound="nav" onClick={() => setFilter(slot)} className={`shrink-0 rounded-full border px-3.5 py-2 text-xs font-bold transition-all ${filter === slot ? "border-primary bg-primary text-primary-foreground" : "border-border bg-card text-muted-foreground"}`}>{slot === "all" ? tr("Barchasi", "All", "Все") : slotTitle(slot)}</Btn>)}</div>
        <div className="grid grid-cols-2 gap-3">{items.map((item, index) => {
          const isOwned = owned.includes(item.id); const isEquipped = equipped[item.slot] === item.id;
          return <article key={item.id} data-cosmetic={item.id} className="cosmetic-card overflow-hidden rounded-2xl border border-border bg-card p-3 shadow-sm" style={{ animationDelay: `${index * 45}ms` }}>
            <div data-cosmetic-preview={item.id} className="cosmetic-preview-panel relative rounded-xl bg-secondary/70 px-2"><span className="cosmetic-preview-symbol absolute right-2 top-2 text-lg">{item.icon}</span><CosmeticPreview item={item}/><span className="cosmetic-preview-glint" aria-hidden="true"/><span className="cosmetic-preview-orbit" aria-hidden="true"/></div>
            <p className="mt-3 text-[10px] font-extrabold uppercase tracking-wider text-primary">{slotTitle(item.slot)}</p><h3 className="mt-1 min-h-10 text-sm font-extrabold leading-tight text-foreground">{title(item)}</h3><p className="mt-1 min-h-12 text-[11px] leading-relaxed text-muted-foreground">{description(item)}</p>
            {isOwned ? <Btn sound="save" onClick={() => onEquip(item.id)} className={`mt-3 w-full rounded-xl py-2.5 text-xs font-extrabold ${isEquipped ? "bg-secondary text-primary" : "bg-primary text-primary-foreground"}`}>{isEquipped ? tr("Yechish", "Unequip", "Снять") : tr("Qo'llash", "Equip", "Применить")}</Btn>
              : <Btn sound="save" onClick={() => onBuy(item.id)} className="mt-3 flex w-full items-center justify-center gap-1.5 rounded-xl bg-primary py-2.5 text-xs font-extrabold text-primary-foreground"><Sparkles size={13}/>{tr("Bepul olish", "Get free", "Забрать бесплатно")}</Btn>}
          </article>;
        })}</div>
        {items.length === 0 && <div className="rounded-3xl border border-dashed border-border bg-card/70 px-5 py-12 text-center"><div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-secondary text-2xl">{view === "owned" ? "🎁" : "✨"}</div><h3 className="mt-3 font-extrabold text-foreground">{view === "owned" ? tr("Hozircha buyum yo'q", "Nothing owned yet", "Пока ничего нет") : view === "shop" && owned.length === COSMETICS.length ? tr("Hozircha boshqa bezaklar mavjud emas", "No other cosmetics available yet", "Других украшений пока нет") : tr("Bu turdagi bezaklar tugadi", "No more items in this category", "В этой категории пока нет товаров")}</h3><p className="mt-1 text-xs text-muted-foreground">{view === "owned" ? tr("Do'kondan bezak oling, so'ng bu yerdan qo'llang.", "Get a cosmetic in the shop, then equip it here.", "Получите украшение в магазине, затем примените его здесь.") : view === "shop" && owned.length === COSMETICS.length ? tr("Yangi bezaklar qo'shilganda shu yerda ko'rinadi.", "New cosmetics will appear here when available.", "Новые украшения появятся здесь, когда будут доступны.") : tr("Boshqa toifalarni ham ko'rib chiqing.", "Explore the other categories.", "Посмотрите другие категории.")}</p></div>}
      </div>
    </div>
  );
}

// ─── Settings Tab ─────────────────────────────────────────────────────────────

function SettingsTab({ user, theme, language, currency, notifications, gameMusic, assistantEnabled, sfxEnabled, cosmetics, onEditUser, onThemeChange, onLanguageChange, onCurrencyChange, onNotifChange, onGameMusicChange, onAssistantChange, onSfxChange, onLogout }: {
  user: User; theme: Theme; language: Language; currency: Currency; notifications: boolean; gameMusic: boolean; assistantEnabled: boolean; sfxEnabled: boolean; cosmetics: Partial<Record<CosmeticSlot, string>>;
  onEditUser: (u: User) => void; onThemeChange: (t: Theme) => void; onCurrencyChange: (c: Currency) => void;
  onLanguageChange: (v: Language) => void; onNotifChange: (n: boolean) => void; onGameMusicChange: (v: boolean) => void;
  onAssistantChange: (v: boolean) => void; onSfxChange: (v: boolean) => void; onLogout: () => void;
}) {
  const [showEdit, setShowEdit] = useState(false);
  const c = COPY[language];
  const equippedThemeItem = COSMETICS.find((item) => item.id === cosmetics.theme);
  const usesDefaultTheme = !cosmetics.theme;

  const themeOptions: { id: Theme; label: string; icon: React.ReactNode; desc: string }[] = [
    { id: "light",    label: tr("Standart", "Default", "Стандартная"), icon: <Sun size={20} />, desc: tr("Oq va yashil", "White and green", "Белая и зелёная") },
    { id: "dark",     label: tr("Qorong'i", "Dark", "Тёмная"), icon: <Moon size={20} />, desc: tr("To'q yashil", "Deep green", "Тёмно-зелёная") },
    { id: "midnight", label: tr("Yarim tun", "Midnight", "Полночь"), icon: <span className="text-base">🌌</span>, desc: tr("Tungi binafsha", "Night violet", "Ночной фиолет") },
    { id: "orange", label: tr("Olovrang", "Orange", "Оранжевая"), icon: <span className="text-base">🔥</span>, desc: tr("Iliq olovrang", "Warm orange", "Тёплый оранжевый") },
  ];
  const stateText = (value: boolean) => value
    ? tr("Yoqilgan", "Enabled", "Включено")
    : tr("O'chirilgan", "Disabled", "Выключено");

  return (
    <div className="flex-1 overflow-y-auto pb-24">
      <div className="bg-primary px-5 pt-12 pb-8 rounded-b-[2rem] shadow-lg">
        <div className="inline-flex items-center gap-2 bg-white/15 rounded-2xl px-4 py-2 mb-1">
          <Settings size={18} className="text-primary-foreground" />
          <h2 className="text-primary-foreground text-xl font-bold">{c.settings}</h2>
        </div>
        <p className="text-primary-foreground/70 text-sm mt-1 px-1">{c.account}</p>
      </div>

      <div className="px-4 py-4 space-y-4">
        {/* Profile */}
        <div className="bg-card rounded-2xl p-4 flex items-center gap-4" data-tour="profile">
          <ProfileAvatar name={user.name} avatar={user.avatar} decoration={cosmetics.avatar} className="h-14 w-14 bg-secondary" />
          <div className="flex-1 min-w-0">
            <p className="font-bold text-foreground truncate"><DecoratedName name={user.name} decoration={cosmetics.name} /></p>
            <p className="text-xs text-muted-foreground">{c.student}</p>
          </div>
          <Btn onClick={() => setShowEdit(true)}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-secondary text-primary text-sm font-semibold hover:bg-primary hover:text-primary-foreground transition-colors">
            <Pencil size={14} />{c.edit}
          </Btn>
        </div>

        {/* Language */}
        <div className="bg-card rounded-2xl p-4">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3 flex items-center gap-2">
            <Globe2 size={15} className="text-primary" />{c.language}
          </p>
          <div className="grid grid-cols-3 gap-2">
            {LANGUAGE_OPTIONS.map((item) => (
              <Btn key={item.id} onClick={() => onLanguageChange(item.id)}
                className={`py-3 rounded-xl border-2 text-xs font-bold transition-colors ${language === item.id ? "bg-primary text-primary-foreground border-primary" : "bg-input-background text-muted-foreground border-border"}`}>
                <span className="block text-sm mb-0.5">{item.short}</span>{item.label}
              </Btn>
            ))}
          </div>
        </div>

        {/* Theme */}
        <div className="bg-card rounded-2xl overflow-hidden" data-tour="appearance">
          <p className="px-4 pt-4 pb-2 text-xs font-semibold text-muted-foreground uppercase tracking-wide">{c.appearance}</p>
          {equippedThemeItem && <div className="mx-4 mb-3 flex items-center gap-2 rounded-xl border border-primary/20 bg-primary/5 px-3 py-2.5 text-xs"><span className="text-lg">{equippedThemeItem.icon}</span><span className="text-muted-foreground">{tr("Market mavzusi yoqilgan:", "Market theme active:", "Активна тема из Маркета:")} <strong className="text-primary">{equippedThemeItem.title[language === "en" ? 1 : language === "ru" ? 2 : 0]}</strong><span className="block">{tr("O'zgartirish uchun Market → Olinganlarga o'ting.", "Change it in Market → Owned.", "Измените её в Маркете → Куплено.")}</span></span></div>}
          <div className="grid grid-cols-2 gap-2 px-4 pb-4">
            {themeOptions.map((t) => (
              <Btn key={t.id} disabled={Boolean(cosmetics.theme)} onClick={() => onThemeChange(t.id)}
                className={`flex flex-col items-center gap-1 py-3 rounded-xl border-2 transition-all ${
                  usesDefaultTheme && theme === t.id
                    ? "border-primary bg-primary/10 shadow-md"
                    : "border-border bg-input-background hover:border-primary/40"}`}>
                <span className={usesDefaultTheme && theme === t.id ? "text-primary" : "text-muted-foreground"}>{t.icon}</span>
                <span className={`text-xs font-bold ${usesDefaultTheme && theme === t.id ? "text-primary" : "text-muted-foreground"}`}>{t.label}</span>
                <span className="text-[9px] text-muted-foreground leading-tight text-center">{t.desc}</span>
                {usesDefaultTheme && theme === t.id && <Check size={11} className="text-primary" />}
              </Btn>
            ))}
          </div>
        </div>

        <div className="bg-card rounded-2xl p-4" data-tour="currency">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">{tr("Valyuta", "Currency", "Валюта")}</p>
          <div className="grid grid-cols-3 gap-2">
            {CURRENCY_OPTIONS.map((item) => (
              <Btn key={item.id} onClick={() => onCurrencyChange(item.id)} className={`rounded-xl border-2 px-2 py-3 text-sm font-bold ${currency === item.id ? "border-primary bg-primary/10 text-primary" : "border-border bg-input-background text-muted-foreground"}`}>
                <span className="block text-base">{item.symbol}</span>{item.label}
              </Btn>
            ))}
          </div>
        </div>

        {/* Unified behavior controls */}
        <div className="bg-card rounded-2xl p-4 divide-y divide-border" data-tour="preferences">
          <SettingsToggleRow icon={notifications ? <Bell size={19} /> : <BellOff size={19} />} title={c.notifications} description={stateText(notifications)} value={notifications} onChange={onNotifChange} />
          <SettingsToggleRow icon={<Music2 size={19} />} title={c.gameMusic} description={gameMusic ? tr("Bossa nova musiqasi", "Bossa nova music", "Музыка босса-нова") : stateText(false)} value={gameMusic} onChange={(v) => { onGameMusicChange(v); if (!v) musicSynth.pause(); }} />
          <SettingsToggleRow icon={<Sparkles size={19} />} title={c.helperSetting} description={stateText(assistantEnabled)} value={assistantEnabled} onChange={onAssistantChange} />
          <SettingsToggleRow icon={sfxEnabled ? <Volume2 size={19} /> : <VolumeX size={19} />} title={c.sounds} description={stateText(sfxEnabled)} value={sfxEnabled} onChange={onSfxChange} />
        </div>
        {/* App info */}
        <div className="bg-card rounded-2xl p-4">
          <div className="flex items-center gap-2 mb-3">
            <Info size={18} className="text-primary" />
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">{tr("Ilova haqida", "About the app", "О приложении")}</p>
          </div>
          {[[tr("Ilova nomi","App name","Название"),"HamyonUp"],[tr("Versiya","Version","Версия"),"2.0.0"],[tr("Til","Language","Язык"),LANGUAGE_OPTIONS.find((x) => x.id === language)?.label ?? "O'zbekcha"],[tr("Muallif","Author","Автор"),"Raxmanov Asadbek"]].map(([k, v]) => (
            <div key={k} className="flex justify-between py-2.5 border-b border-border last:border-0">
              <span className="text-sm text-muted-foreground">{k}</span>
              <span className="text-sm text-foreground font-bold italic">{v}</span>
            </div>
          ))}
        </div>

        <Btn onClick={onLogout}
          className="w-full py-3.5 rounded-2xl border border-red-700/50 bg-gradient-to-b from-red-500 to-red-700 text-white font-extrabold text-sm shadow-[0_5px_0_#991b1b,0_9px_16px_rgba(127,29,29,.22)] hover:brightness-105 active:translate-y-1 active:shadow-[0_2px_0_#991b1b] transition-all">
          {tr("Chiqish", "Sign out", "Выйти")}
        </Btn>
      </div>
      {showEdit && <EditProfileModal user={user} onSave={onEditUser} onClose={() => setShowEdit(false)} />}
    </div>
  );
}

// ─── Snake Game ───────────────────────────────────────────────────────────────

const COLS = 20;
const ROWS = 20;
type Pt = { x: number; y: number };
type Dir = "U" | "D" | "L" | "R";

function randFood(snake: Pt[]): Pt {
  let p: Pt;
  do { p = { x: Math.floor(Math.random() * COLS), y: Math.floor(Math.random() * ROWS) }; }
  while (snake.some((s) => s.x === p.x && s.y === p.y));
  return p;
}

function SnakeGame({ onBack, onCoinsEarned, musicEnabled, currentCoins }: {
  onBack: () => void; onCoinsEarned: (n: number) => void; musicEnabled: boolean; currentCoins: number;
}) {
  const initSnake: Pt[] = [{ x: 10, y: 10 }, { x: 9, y: 10 }, { x: 8, y: 10 }];
  const [snake, setSnake]   = useState<Pt[]>(initSnake);
  const [food, setFood]     = useState<Pt>(() => randFood(initSnake));
  const [status, setStatus] = useState<"idle" | "playing" | "over">("idle");
  const [score, setScore]   = useState(0);
  const [best, setBest]     = useState(() => parseInt(localStorage.getItem("snake_best") ?? "0", 10));
  const [earnedCoins, setEarnedCoins] = useState(0);
  const [particles, setParticles]     = useState<{ id: number; x: number; y: number; color: string }[]>([]);
  const [viewport, setViewport] = useState(() => ({ width: window.innerWidth, height: window.innerHeight }));

  const dirRef    = useRef<Dir>("R");
  const snakeRef  = useRef<Pt[]>(initSnake);
  const foodRef   = useRef<Pt>(food);
  const statusRef = useRef<"idle" | "playing" | "over">("idle");
  const touchRef  = useRef<{ x: number; y: number } | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef    = useRef<number>(0);
  const lastRef   = useRef<number>(0);
  const scoreRef  = useRef(0);
  const milestonesHitRef = useRef<Set<number>>(new Set());
  const particleIdRef    = useRef(0);

  useEffect(() => {
    const resize = () => setViewport({ width: window.innerWidth, height: window.innerHeight });
    window.addEventListener("resize", resize);
    return () => window.removeEventListener("resize", resize);
  }, []);

  const W = Math.max(180, Math.min(viewport.width - 20, viewport.height - 240, 640));
  const CELL = Math.floor(W / COLS);
  const BOARD = CELL * COLS;

  useEffect(() => {
    if (musicEnabled && status === "playing") musicSynth.play();
    else musicSynth.pause();
    return () => { musicSynth.pause(); };
  }, [musicEnabled, status]);

  const spawnParticles = useCallback((gx: number, gy: number) => {
    const colors = ["#F59E0B", "#EF4444", "#10B981", "#6366F1", "#EC4899", "#ffffff"];
    const newParts = Array.from({ length: 8 }, (_, i) => ({
      id: ++particleIdRef.current, x: gx * CELL + CELL / 2, y: gy * CELL + CELL / 2, color: colors[i % colors.length],
    }));
    setParticles((p) => [...p.slice(-20), ...newParts]);
    setTimeout(() => setParticles((p) => p.filter((x) => !newParts.find((n) => n.id === x.id))), 700);
  }, [CELL]);

  const reset = () => {
    const s = [{ x: 10, y: 10 }, { x: 9, y: 10 }, { x: 8, y: 10 }];
    const f = randFood(s);
    snakeRef.current = s; foodRef.current = f; dirRef.current = "R";
    scoreRef.current = 0; milestonesHitRef.current = new Set();
    setSnake(s); setFood(f); setScore(0); setStatus("playing"); statusRef.current = "playing";
    setEarnedCoins(0); setParticles([]);
  };

  const draw = useCallback((ts = 0) => {
    const cv = canvasRef.current; if (!cv) return;
    const ctx = cv.getContext("2d")!;
    const s = snakeRef.current; const f = foodRef.current;
    const isDark = document.documentElement.classList.contains("dark");
    const isMidnight = document.documentElement.classList.contains("midnight");
    const isOrange = document.documentElement.classList.contains("orange");
    const bgColor  = isMidnight ? "#080A18" : isDark ? "#0F1A12" : isOrange ? "#FFF8F1" : "#F0FFF4";
    const gridCol  = isMidnight ? "rgba(99,102,241,0.04)" : isDark ? "rgba(255,255,255,0.04)" : "rgba(0,0,0,0.04)";
    const headC    = isMidnight ? "#6366F1" : isDark ? "#4CAF72" : isOrange ? "#F28A32" : "#2D8C4E";
    const bodyC    = isMidnight ? "#4F46E5" : isDark ? "#3a9460" : isOrange ? "#B94914" : "#1e6035";

    ctx.fillStyle = bgColor; ctx.fillRect(0, 0, BOARD, BOARD);
    for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
      if ((r + c) % 2 === 0) { ctx.fillStyle = gridCol; ctx.fillRect(c * CELL, r * CELL, CELL, CELL); }
    }

    // Food glow & apple
    const pulse = Math.sin(ts / 280) * 0.4 + 0.6;
    const fx = f.x * CELL + CELL / 2; const fy = f.y * CELL + CELL / 2;
    const glow = ctx.createRadialGradient(fx, fy, 0, fx, fy, CELL * 1.2);
    glow.addColorStop(0, `rgba(245,158,11,${0.5 * pulse})`); glow.addColorStop(1, "rgba(245,158,11,0)");
    ctx.fillStyle = glow; ctx.beginPath(); ctx.arc(fx, fy, CELL * 1.2, 0, Math.PI * 2); ctx.fill();
    const rr = CELL / 2 - 1.5;
    const ag = ctx.createRadialGradient(fx - rr * 0.3, fy - rr * 0.3, rr * 0.1, fx, fy, rr);
    ag.addColorStop(0, "#FF7043"); ag.addColorStop(0.65, "#F59E0B"); ag.addColorStop(1, "#D97706");
    ctx.fillStyle = ag; ctx.beginPath(); ctx.arc(fx, fy, rr * (0.88 + pulse * 0.12), 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = "rgba(255,255,255,0.45)"; ctx.beginPath(); ctx.arc(fx - rr * 0.28, fy - rr * 0.3, rr * 0.28, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = "#5D4037"; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(fx, fy - rr); ctx.lineTo(fx + 2, fy - rr - 5); ctx.stroke();

    // Snake
    s.forEach((p, i) => {
      const t = i / Math.max(1, s.length - 1);
      const seg = CELL - 2;
      const previous = s[Math.max(0, i - 1)]; const next = s[Math.min(s.length - 1, i + 1)];
      const dx = previous.x - next.x, dy = previous.y - next.y, length = Math.max(1, Math.hypot(dx, dy));
      const wave = Math.sin(ts / 135 - i * .62) * CELL * .09;
      const rx = p.x * CELL + 1 + (-dy / length) * wave; const ry = p.y * CELL + 1 + (dx / length) * wave;
      const alpha = Math.round((1 - t * 0.45) * 255).toString(16).padStart(2, "0");
      const grad = ctx.createLinearGradient(rx, ry, rx + seg, ry + seg);
      grad.addColorStop(0, i === 0 ? "#B7F7A5" : headC + alpha); grad.addColorStop(.32, headC + alpha); grad.addColorStop(1, bodyC + alpha);
      ctx.save(); ctx.shadowColor = bodyC; ctx.shadowBlur = i === 0 ? 12 : 7; ctx.shadowOffsetY = 3;
      ctx.fillStyle = grad; ctx.beginPath(); ctx.roundRect(rx, ry, seg, seg, i === 0 ? 6 : 4); ctx.fill();
      ctx.restore();
      ctx.fillStyle = "rgba(255,255,255,0.24)"; ctx.beginPath(); ctx.roundRect(rx + 2, ry + 2, seg - 4, Math.floor((seg - 4) / 2), 2); ctx.fill();
      ctx.fillStyle = "rgba(0,0,0,0.10)"; ctx.beginPath(); ctx.roundRect(rx + 3, ry + seg - 5, seg - 6, 2, 1); ctx.fill();
      if (i === 0) {
        const d = dirRef.current; const cx2 = p.x * CELL + CELL / 2; const cy2 = p.y * CELL + CELL / 2;
        [{ x: cx2 + (d==="R"?2:d==="L"?-2:-3), y: cy2 + (d==="D"?2:d==="U"?-2:-3) },
         { x: cx2 + (d==="R"?2:d==="L"?-2:3),  y: cy2 + (d==="D"?2:d==="U"?-2:3) }].forEach(({ x: ex, y: ey }) => {
          ctx.fillStyle = "#fff"; ctx.beginPath(); ctx.arc(ex, ey, 2.8, 0, Math.PI * 2); ctx.fill();
          ctx.fillStyle = "#111"; ctx.beginPath();
          ctx.arc(ex + (d==="R"?.7:d==="L"?-.7:0), ey + (d==="D"?.7:d==="U"?-.7:0), 1.4, 0, Math.PI * 2); ctx.fill();
        });
      }
    });
  }, [CELL, BOARD]);

  const step = useCallback(() => {
    if (statusRef.current !== "playing") return;
    const s = snakeRef.current; const d = dirRef.current; const head = s[0];
    const next: Pt = {
      x: (head.x + (d==="R"?1:d==="L"?-1:0) + COLS) % COLS,
      y: (head.y + (d==="D"?1:d==="U"?-1:0) + ROWS) % ROWS,
    };
    if (s.slice(1).some((p) => p.x === next.x && p.y === next.y)) {
      statusRef.current = "over"; setStatus("over"); sfx.delete();
      const nb = Math.max(scoreRef.current, parseInt(localStorage.getItem("snake_best") ?? "0", 10));
      localStorage.setItem("snake_best", String(nb)); setBest(nb);
      return;
    }
    const ate = next.x === foodRef.current.x && next.y === foodRef.current.y;
    const newSnake = [next, ...s.slice(0, ate ? undefined : s.length - 1)];
    snakeRef.current = newSnake; setSnake([...newSnake]);
    if (ate) {
      sfx.coin(); spawnParticles(next.x, next.y);
      const nf = randFood(newSnake); foodRef.current = nf; setFood(nf);
      scoreRef.current += 1; setScore(scoreRef.current);
      MILESTONES.forEach(({ score: ms, coins, label }) => {
        if (scoreRef.current >= ms && !milestonesHitRef.current.has(ms)) {
          milestonesHitRef.current.add(ms);
          setEarnedCoins((prev) => prev + coins);
          onCoinsEarned(coins);
          sfx.levelUp();
          toast.success(tr(`🏅 "${lt(label)}" darajasi! +${coins} 🪙`, `🏅 “${lt(label)}” milestone! +${coins} 🪙`, `🏅 Этап «${lt(label)}»! +${coins} 🪙`), { duration: 3500,
            description: tr(`${ms} ball — ajoyib natija!`, `${ms} points — great result!`, `${ms} очков — отличный результат!`) });
        }
      });
    }
  }, [onCoinsEarned, spawnParticles]);

  useEffect(() => {
    if (status !== "playing") { draw(0); return; }
    const speed = Math.max(75, 200 - scoreRef.current * 5);
    const loop = (ts: number) => {
      if (statusRef.current !== "playing") return;
      draw(ts);
      if (ts - lastRef.current >= speed) { step(); lastRef.current = ts; }
      rafRef.current = requestAnimationFrame(loop);
    };
    rafRef.current = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(rafRef.current);
  }, [status, step, draw]);

  useEffect(() => {
    const map: Record<string, Dir> = { ArrowUp:"U", ArrowDown:"D", ArrowLeft:"L", ArrowRight:"R", w:"U", s:"D", a:"L", d:"R" };
    const opp: Record<Dir, Dir> = { U:"D", D:"U", L:"R", R:"L" };
    const handler = (e: KeyboardEvent) => {
      const nd = map[e.key]; if (!nd) return;
      if (nd !== opp[dirRef.current]) { dirRef.current = nd; }
      if (statusRef.current === "idle") reset();
      e.preventDefault();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  const onTouchStart = (e: React.TouchEvent) => { touchRef.current = { x: e.touches[0].clientX, y: e.touches[0].clientY }; };
  const onTouchEnd = (e: React.TouchEvent) => {
    if (!touchRef.current) return;
    const dx = e.changedTouches[0].clientX - touchRef.current.x;
    const dy = e.changedTouches[0].clientY - touchRef.current.y;
    const opp: Record<Dir, Dir> = { U:"D", D:"U", L:"R", R:"L" };
    let nd: Dir = dirRef.current;
    if (Math.abs(dx) > Math.abs(dy)) nd = dx > 20 ? "R" : dx < -20 ? "L" : nd;
    else nd = dy > 20 ? "D" : dy < -20 ? "U" : nd;
    if (nd !== opp[dirRef.current]) dirRef.current = nd;
    if (statusRef.current === "idle") reset();
    touchRef.current = null;
  };

  const nextMilestone = MILESTONES.find((m) => score < m.score);
  const totalCoins = currentCoins;

  return (
    <div className="fixed inset-0 z-[150] flex flex-col overflow-hidden bg-background" style={{ height: "100dvh", touchAction: "none" }}>
      <div className="shrink-0 px-4 pb-3 pt-[max(1rem,env(safe-area-inset-top))]">
        <div className="mx-auto flex w-full max-w-sm items-center gap-3">
          <CloseButton onClick={onBack} className="!bg-card" />
          <div className="min-w-0 flex-1">
            <p className="text-[10px] font-extrabold uppercase tracking-[.16em] text-primary">{tr("Klassik o'yin", "Classic arcade", "Классическая игра")}</p>
            <h2 className="text-xl font-black text-foreground">Snake 🐍</h2>
          </div>
          {musicEnabled && status === "playing" && (
            <div className="ml-auto flex items-center gap-1.5 rounded-xl bg-secondary px-3 py-1.5">
              <span className="text-sm">🎵</span>
              <div className="flex gap-0.5 items-end h-4">
                {[0,1,2].map((i) => (
                  <div key={i} className="w-1 rounded-full bg-primary/70" style={{ height: `${8+i*4}px`, animation: `eqbar 0.8s ease ${i*0.15}s infinite alternate` }} />
                ))}
              </div>
            </div>
          )}
          {earnedCoins > 0 && (
            <div className={`${!(musicEnabled && status === "playing") ? "ml-auto" : ""} flex items-center gap-1 rounded-xl bg-amber-500/10 px-3 py-1.5`}>
              <span className="text-sm font-bold text-amber-600 dark:text-amber-300">+{earnedCoins}🪙</span>
            </div>
          )}
        </div>
      </div>

      <div className="flex-1 min-h-0 px-3 py-3 flex flex-col items-center justify-center gap-2">
        {/* Score row */}
        <div className="w-full flex gap-2 mb-3">
          <div className="flex-1 rounded-2xl border border-primary/15 bg-gradient-to-br from-primary/10 via-card to-card px-3 py-2.5 text-center">
            <p className="text-xs text-muted-foreground font-semibold uppercase tracking-wide">{tr("Ball", "Score", "Счёт")}</p>
            <p className="text-2xl font-bold text-foreground" style={{ fontFamily: "DM Mono, monospace" }}>{score}</p>
          </div>
          <div className="flex-1 rounded-2xl border border-primary/15 bg-gradient-to-br from-primary/10 via-card to-card px-3 py-2.5 text-center">
            <p className="text-xs text-muted-foreground font-semibold uppercase tracking-wide">{tr("Rekord", "Best", "Рекорд")}</p>
            <p className="text-2xl font-bold text-primary" style={{ fontFamily: "DM Mono, monospace" }}>{best}</p>
          </div>
          <div className="flex-1 rounded-2xl border border-amber-400/25 bg-gradient-to-br from-amber-400/10 via-card to-card px-3 py-2.5 text-center">
            <p className="text-xs text-muted-foreground font-semibold uppercase tracking-wide">{tr("Jami", "Total", "Всего")}🪙</p>
            <p className="text-2xl font-bold text-amber-500" style={{ fontFamily: "DM Mono, monospace" }}>{totalCoins}</p>
          </div>
        </div>

        {/* Next milestone progress */}
        {nextMilestone && status === "playing" && (
          <div className="mb-3 flex w-full items-center gap-3 rounded-2xl border border-primary/15 bg-gradient-to-r from-primary/10 via-card to-amber-400/10 p-2.5">
            <span className="text-lg">🏅</span>
            <div className="flex-1">
              <div className="flex justify-between text-xs mb-1">
                <span className="text-muted-foreground">{tr("Keyingi bosqich:", "Next milestone:", "Следующий этап:")} {nextMilestone.score} {tr("ball", "points", "очков")}</span>
                <span className="font-bold text-amber-500">+{nextMilestone.coins}🪙</span>
              </div>
            <div className="h-1.5 w-full rounded-full bg-muted">
                <div className="bg-amber-500 h-1.5 rounded-full transition-all"
                  style={{ width: `${Math.min(100, (score / nextMilestone.score) * 100)}%` }} />
              </div>
            </div>
          </div>
        )}

        {/* Canvas */}
        <div className="relative bg-card rounded-2xl overflow-hidden shadow-xl border border-border"
          style={{ width: BOARD, height: BOARD, maxWidth: "100%", maxHeight: "100%" }} onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>
          <canvas ref={canvasRef} width={BOARD} height={BOARD} style={{ display: "block", width: "100%", height: "100%" }} />
          <div className="absolute inset-0 pointer-events-none overflow-hidden">
            {particles.map((p) => (
              <div key={p.id} className="absolute w-2 h-2 rounded-full pointer-events-none"
                style={{ left: p.x, top: p.y, backgroundColor: p.color, animation: "particleFly 0.7s ease-out forwards" }} />
            ))}
          </div>

          {status === "idle" && (
            <div className="absolute inset-0 flex items-center justify-center rounded-2xl bg-background/85 p-3 backdrop-blur-md sm:p-5">
              <div className="w-full max-w-[330px] rounded-[1.65rem] border border-primary/20 bg-gradient-to-br from-primary/12 via-card to-emerald-400/10 p-4 text-center shadow-xl sm:p-5">
                <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-2xl border border-primary/20 bg-primary/10 text-4xl shadow-[inset_0_1px_0_rgba(255,255,255,.55),0_8px_20px_rgba(16,185,129,.16)]" style={{ animation: "snakeBounce 1.7s ease-in-out infinite" }}>🐍</div>
                <div className="mb-1 inline-flex items-center gap-1.5 rounded-full bg-primary/10 px-2.5 py-1 text-[10px] font-extrabold uppercase tracking-[.16em] text-primary"><Sparkles size={12}/>{tr("Klassik o'yin", "Classic arcade", "Классическая игра")}</div>
                <p className="text-xl font-extrabold text-foreground">Snake</p>
                <p className="mx-auto mb-3 mt-1 max-w-[250px] text-xs leading-relaxed text-muted-foreground">{tr("Ilonni barmog'ingiz bilan surib boshqaring va taomlarni yig'ing.", "Swipe to steer the snake and collect food.", "Проводите пальцем, управляйте змейкой и собирайте еду.")}</p>
                <div className="mb-3 grid grid-cols-3 gap-1.5">
                  {MILESTONES.map((m) => (
                    <div key={m.score} className="rounded-xl border border-border/70 bg-background/70 px-1.5 py-2 text-center">
                      <span className="block text-[10px] font-semibold text-muted-foreground">{m.score} {tr("ball", "pts", "очк.")}</span>
                      <span className="mt-0.5 block text-xs font-extrabold text-amber-600 dark:text-amber-300">+{m.coins} 🪙</span>
                    </div>
                  ))}
                </div>
                <Btn sound="click" onClick={reset} className="app-button-3d w-full rounded-2xl bg-primary py-3 text-sm font-extrabold text-primary-foreground hover:brightness-105">
                  <span className="inline-flex items-center justify-center gap-2"><Gamepad2 size={17}/>{tr("Boshlash", "Start game", "Начать игру")}</span>
                </Btn>
                <p className="mt-2 text-[10px] text-muted-foreground">{tr("O'yin davomida maydonda chapga, o'ngga, yuqoriga yoki pastga suring.", "Swipe left, right, up or down on the board while playing.", "Во время игры проводите по полю в нужном направлении.")}</p>
              </div>
            </div>
          )}

          {status === "over" && (
            <div className="absolute inset-0 flex flex-col items-center justify-center rounded-2xl"
              style={{ background: "rgba(0,0,0,0.65)", backdropFilter: "blur(4px)" }}>
              <div className="text-5xl mb-3">💀</div>
              <p className="text-white font-bold text-xl mb-1">{tr("O'yin tugadi!", "Game over!", "Игра окончена!")}</p>
              <p className="text-white/70 text-sm mb-1">{tr("Ball:", "Score:", "Счёт:")} <span className="font-bold text-white text-lg">{score}</span></p>
              {score > 0 && score >= best && <p className="text-amber-400 text-sm font-bold mb-1">🏆 {tr("Yangi rekord!", "New record!", "Новый рекорд!")}</p>}
              {earnedCoins > 0 && <p className="text-amber-300 text-sm font-bold mb-3">+{earnedCoins}🪙 {tr("tanga topildi!", "coins earned!", "монет заработано!")}</p>}
              {!(earnedCoins > 0 || (score > 0 && score >= best)) && <div className="mb-4" />}
              <Btn sound="click" onClick={reset} className="bg-primary text-primary-foreground px-8 py-3 rounded-2xl font-bold text-sm hover:opacity-90 mt-2">
                {tr("Qayta o'ynash", "Play again", "Играть снова")}
              </Btn>
            </div>
          )}
        </div>

        <p className="text-muted-foreground text-xs text-center">{tr("Ilonni boshqarish uchun ekranda kerakli tomonga suring.", "Swipe the board in the direction you want the snake to go.", "Проведите по полю в нужном направлении, чтобы управлять змейкой.")}</p>
      </div>

      <style>{`
        @keyframes snakeBounce{0%,100%{transform:translateY(0) scale(1)}50%{transform:translateY(-10px) scale(1.1)}}
        @keyframes eqbar{0%{height:4px}100%{height:16px}}
        @keyframes particleFly{0%{transform:translate(-50%,-50%) scale(1);opacity:1}100%{transform:translate(calc(-50% + 25px),calc(-50% - 35px)) scale(0);opacity:0}}
      `}</style>
    </div>
  );
}

// ─── Games Tab ────────────────────────────────────────────────────────────────

const MEMORY_SYMBOLS = ["🌙", "🍀", "🪙", "⭐", "🎈", "🧸", "🍉", "🚀", "💎", "🎧", "🌻", "🦋"];
function shuffledMemoryDeck(pairCount = 8) {
  return MEMORY_SYMBOLS.slice(0, pairCount).flatMap((symbol) => [symbol, symbol]).sort(() => Math.random() - 0.5);
}

function MemoryGame({ onBack, onCoinsEarned, musicEnabled }: { onBack: () => void; onCoinsEarned: (coins: number) => void; musicEnabled: boolean }) {
  const [pairCount, setPairCount] = useState(8);
  const [deck, setDeck] = useState(() => shuffledMemoryDeck(8));
  const [openCards, setOpenCards] = useState<number[]>([]);
  const [matched, setMatched] = useState<number[]>([]);
  const [moves, setMoves] = useState(0);
  const [complete, setComplete] = useState(false);
  const [started, setStarted] = useState(false);
  const [reward, setReward] = useState(0);
  const hideTimer = useRef<number | null>(null);
  const locked = openCards.length === 2;

  useEffect(() => {
    if (started && !complete && musicEnabled) musicSynth.play("memory");
    else musicSynth.pause();
    return () => musicSynth.pause();
  }, [started, complete, musicEnabled]);
  useEffect(() => () => { if (hideTimer.current) window.clearTimeout(hideTimer.current); }, []);

  const start = () => {
    if (hideTimer.current) window.clearTimeout(hideTimer.current);
    const freshDeck = shuffledMemoryDeck(pairCount);
    setDeck(freshDeck); setOpenCards([]); setMatched([]); setMoves(0); setReward(0); setComplete(false); setStarted(true);
    if (musicEnabled) musicSynth.play("memory");
    sfx.click();
  };
  const flip = (index: number) => {
    if (!started || complete || locked || openCards.includes(index) || matched.includes(index)) return;
    sfx.click();
    if (openCards.length === 0) { setOpenCards([index]); return; }
    const first = openCards[0]; const nextMoves = moves + 1; setMoves(nextMoves);
    if (deck[first] === deck[index]) {
      const nextMatched = [...matched, first, index]; setMatched(nextMatched); setOpenCards([]); sfx.save();
      if (nextMatched.length === deck.length) {
        const earned = Math.min(7, Math.round(pairCount / 3) + Math.max(0, 3 - Math.floor((nextMoves - pairCount) / pairCount)));
        setReward(earned); setComplete(true); onCoinsEarned(earned); sfx.levelUp();
      }
    } else {
      setOpenCards([first, index]);
      hideTimer.current = window.setTimeout(() => setOpenCards([]), 720);
    }
  };
  const choosePairs = (count: number) => { sfx.nav(); setPairCount(count); setDeck(shuffledMemoryDeck(count)); };

  return <div className="fixed inset-0 z-[150] flex flex-col overflow-y-auto bg-background px-4 pb-8 pt-[max(1rem,env(safe-area-inset-top))]" style={{ minHeight: "100dvh" }}>
    <div className="mx-auto flex w-full max-w-sm items-center gap-3 pb-4"><CloseButton onClick={onBack} className="!bg-card"/><div className="min-w-0 flex-1"><p className="text-[10px] font-extrabold uppercase tracking-[.16em] text-primary">{tr("Xotira o'yini", "Memory challenge", "Игра на память")}</p><h2 className="text-xl font-black text-foreground">Memory 🧠</h2></div><div className="rounded-2xl bg-secondary px-3 py-2 text-center"><span className="block text-[9px] font-bold uppercase text-muted-foreground">{tr("Yurishlar", "Moves", "Ходы")}</span><span className="font-extrabold text-foreground">{moves}</span></div></div>
    <div className="mx-auto mb-3 w-full max-w-sm rounded-3xl border border-primary/15 bg-gradient-to-br from-primary/12 via-card to-violet-400/10 p-4 text-center"><p className="text-sm font-bold text-foreground">{complete ? tr("Ajoyib xotira! Juftliklar topildi.", "Brilliant memory! All pairs found.", "Отличная память! Все пары найдены.") : tr("Bir xil belgilarni topib, barcha juftlarni oching.", "Find matching symbols and reveal every pair.", "Находите одинаковые символы и откройте все пары.")}</p><p className="mt-1 text-xs text-muted-foreground">{complete ? tr(`+${reward} tanga mukofot olindi!`, `You earned ${reward} coins!`, `Вы получили ${reward} монет!`) : tr("Qiyinlikni tanlang. Kam yurish — kattaroq mukofot.", "Choose a level. Fewer moves earn more coins.", "Выберите уровень. Меньше ходов — больше монет.")}</p></div>
    {(!started || complete) && <div className="mx-auto mb-3 grid w-full max-w-sm grid-cols-3 gap-2">{[{ n: 6, label: tr("Yengil", "Easy", "Легко"), pay: "2–5" }, { n: 8, label: tr("O'rta", "Medium", "Средне"), pay: "3–6" }, { n: 12, label: tr("Qiyin", "Hard", "Сложно"), pay: "4–7" }].map((level) => <button key={level.n} onClick={() => choosePairs(level.n)} className={`app-button-3d rounded-2xl border px-2 py-2 text-xs font-extrabold ${pairCount === level.n ? "border-primary bg-primary/10 text-primary" : "border-border bg-card text-muted-foreground"}`}><span className="block">{level.label}</span><span className="mt-0.5 block text-[9px] font-semibold">{level.n} {tr("juft", "pairs", "пар")} · {level.pay} 🪙</span></button>)}</div>}
    <div className={`mx-auto grid w-full max-w-sm grid-cols-4 gap-2 ${pairCount > 8 ? "gap-1.5" : "gap-2.5"}`}>{deck.map((symbol, index) => { const faceUp = openCards.includes(index) || matched.includes(index); return <button key={index} onClick={() => flip(index)} disabled={!started || complete || locked || matched.includes(index)} aria-label={`${tr("Karta", "Card", "Карта")} ${index + 1}`} className={`memory-card app-button-3d relative aspect-square overflow-hidden rounded-2xl border text-3xl transition-all duration-300 ${pairCount > 8 ? "text-2xl" : ""} ${matched.includes(index) ? "memory-card-matched border-emerald-300 bg-emerald-100/80 dark:bg-emerald-900/40" : faceUp ? "rotate-0 border-primary/40 bg-card" : "border-border bg-gradient-to-br from-primary to-emerald-700 text-white"}`}>{faceUp ? <span key="face" className="memory-card-face">{symbol}</span> : <span className="font-black text-white/85">✦</span>}</button>; })}</div>
    {!started || complete ? <button onClick={start} className="app-button-3d mx-auto mt-4 w-full max-w-sm rounded-2xl bg-primary py-3.5 font-extrabold text-primary-foreground">{complete ? tr("Yana o'ynash", "Play again", "Сыграть ещё") : tr("Boshlash", "Start", "Начать")}</button> : <div className="mx-auto mt-4 flex w-full max-w-sm items-center justify-center gap-2 rounded-2xl bg-secondary/70 p-3 text-xs font-bold text-muted-foreground"><Sparkles size={14} className="text-primary"/>{tr("Topilgan juftlar", "Matched pairs", "Найденные пары")} <span className="text-primary">{matched.length / 2} / {pairCount}</span></div>}
  </div>;
}

type QuizQuestion = { prompt: string; answer: number; options: number[] };
type QuizLevel = "easy" | "medium" | "hard";
function createQuizQuestion(level: QuizLevel): QuizQuestion {
  const random = (max: number, min = 2) => Math.floor(Math.random() * (max - min + 1)) + min;
  let prompt: string; let answer: number;
  if (level === "easy") {
    const a = random(40, 8), b = random(25, 3), subtract = Math.random() < .35;
    prompt = subtract ? `${Math.max(a, b)} − ${Math.min(a, b)}` : `${a} + ${b}`;
    answer = subtract ? Math.abs(a - b) : a + b;
  } else if (level === "medium") {
    if (Math.random() < .45) { const divisor = random(12, 2), quotient = random(12, 2); prompt = `${divisor * quotient} ÷ ${divisor}`; answer = quotient; }
    else { const a = random(15, 3), b = random(12, 3); prompt = `${a} × ${b}`; answer = a * b; }
  } else {
    const a = random(18, 4), b = random(16, 3), c = random(9, 2);
    if (Math.random() < .5) { prompt = `${a} + ${b} × ${c}`; answer = a + b * c; }
    else { prompt = `(${a} + ${b}) × ${c}`; answer = (a + b) * c; }
  }
  const optionSet = new Set([answer]);
  while (optionSet.size < 4) { const delta = random(Math.max(12, Math.round(answer * .18)), 1) * (Math.random() < .5 ? -1 : 1); optionSet.add(Math.max(0, answer + delta)); }
  return { prompt, answer, options: [...optionSet].sort(() => Math.random() - .5) };
}

function MathQuizGame({ onBack, onCoinsEarned, musicEnabled }: { onBack: () => void; onCoinsEarned: (coins: number) => void; musicEnabled: boolean }) {
  const [level, setLevel] = useState<QuizLevel>("medium");
  const [question, setQuestion] = useState(() => createQuizQuestion("medium"));
  const [questionIndex, setQuestionIndex] = useState(0);
  const [score, setScore] = useState(0);
  const [locked, setLocked] = useState(false);
  const [started, setStarted] = useState(false);
  const [complete, setComplete] = useState(false);
  const [feedback, setFeedback] = useState<boolean | null>(null);
  const [selectedAnswer, setSelectedAnswer] = useState<number | null>(null);
  const answerRef = useRef<number | null>(null);
  const timerRef = useRef<number | null>(null);
  const multiplier = level === "easy" ? 1 : level === "medium" ? 2 : 3;
  useEffect(() => {
    if (started && !complete && musicEnabled) musicSynth.play("math");
    else musicSynth.pause();
    return () => musicSynth.pause();
  }, [started, complete, musicEnabled]);
  useEffect(() => () => { if (timerRef.current) window.clearTimeout(timerRef.current); }, []);
  const start = () => {
    if (timerRef.current) window.clearTimeout(timerRef.current);
    setQuestion(createQuizQuestion(level)); setQuestionIndex(0); setScore(0); setLocked(false); setStarted(true); setComplete(false); setFeedback(null); setSelectedAnswer(null); answerRef.current = 0;
    if (musicEnabled) musicSynth.play("math");
    sfx.click();
  };
  const answer = (value: number) => {
    if (locked || complete || !started) return;
    const correct = value === question.answer; const nextScore = score + Number(correct);
    setSelectedAnswer(value); answerRef.current = nextScore; setScore(nextScore); setFeedback(correct); setLocked(true);
    if (correct) sfx.save(); else sfx.delete();
    timerRef.current = window.setTimeout(() => {
      if (questionIndex === 9) {
        setComplete(true); setLocked(false);
        const payout = (answerRef.current ?? 0) * multiplier;
        if (payout) { onCoinsEarned(payout); sfx.levelUp(); }
      } else {
        setQuestionIndex((index) => index + 1); setQuestion(createQuizQuestion(level)); setFeedback(null); setSelectedAnswer(null); setLocked(false);
      }
    }, 620);
  };
  const levelOptions: { id: QuizLevel; label: string; reward: number; detail: string }[] = [
    { id: "easy", label: tr("Yengil", "Easy", "Легко"), reward: 10, detail: tr("Qo'shish va ayirish", "Addition and subtraction", "Сложение и вычитание") },
    { id: "medium", label: tr("O'rta", "Medium", "Средне"), reward: 20, detail: tr("Ko'paytirish va bo'lish", "Multiplication and division", "Умножение и деление") },
    { id: "hard", label: tr("Qiyin", "Hard", "Сложно"), reward: 30, detail: tr("Aralash amallar", "Mixed operations", "Смешанные действия") },
  ];
  const payout = score * multiplier;

  return <div className="fixed inset-0 z-[150] flex flex-col overflow-y-auto bg-background px-4 pb-8 pt-[max(1rem,env(safe-area-inset-top))]" style={{ minHeight: "100dvh" }}>
    <div className="mx-auto flex w-full max-w-sm items-center gap-3 pb-4"><CloseButton onClick={onBack} className="!bg-card"/><div className="min-w-0 flex-1"><p className="text-[10px] font-extrabold uppercase tracking-[.16em] text-primary">{tr("Tezkor hisob", "Quick maths", "Быстрый счёт")}</p><h2 className="text-xl font-black text-foreground">Math Quiz 🧮</h2></div><div className="rounded-2xl bg-secondary px-3 py-2 text-center"><span className="block text-[9px] font-bold uppercase text-muted-foreground">{tr("Ball", "Score", "Счёт")}</span><span className="font-extrabold text-foreground">{score} / 10</span></div></div>
    {!started ? <div className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center"><div className="rounded-[2rem] border border-primary/15 bg-gradient-to-br from-primary/15 via-card to-cyan-400/10 p-5 text-center"><div className="mx-auto mb-3 flex h-16 w-16 items-center justify-center rounded-3xl bg-primary/10 text-4xl">🧮</div><h3 className="text-xl font-black text-foreground">{tr("Hisoblash marafoni", "Math sprint", "Математический спринт")}</h3><p className="mt-2 text-sm text-muted-foreground">{tr("10 ta xilma-xil savol. Har to'g'ri javob tanga olib keladi.", "10 varied questions. Every correct answer earns coins.", "10 разных вопросов. За каждый правильный ответ начисляются монеты.")}</p></div><div className="mt-4 space-y-2">{levelOptions.map((option) => <button key={option.id} onClick={() => { sfx.nav(); setLevel(option.id); }} className={`app-button-3d flex w-full items-center gap-3 rounded-2xl border p-3 text-left ${level === option.id ? "border-primary bg-primary/10" : "border-border bg-card"}`}><span className="flex h-10 w-10 items-center justify-center rounded-xl bg-secondary text-xl">{option.id === "easy" ? "🌱" : option.id === "medium" ? "⚡" : "🔥"}</span><span className="min-w-0 flex-1"><span className="block text-sm font-extrabold text-foreground">{option.label}</span><span className="block text-[10px] text-muted-foreground">{option.detail}</span></span><span className="text-xs font-black text-amber-500">{tr("10 tagacha", "Up to 10", "До 10")} · {option.reward} 🪙</span></button>)}</div><button onClick={start} className="app-button-3d mt-4 w-full rounded-2xl bg-primary py-3.5 font-extrabold text-primary-foreground">{tr("Boshlash", "Start quiz", "Начать викторину")}</button></div> : <>
      <div className="mx-auto mb-4 flex w-full max-w-sm items-center justify-between rounded-2xl bg-secondary/70 px-4 py-3"><span className="text-xs font-bold text-muted-foreground">{tr("Savol", "Question", "Вопрос")} {complete ? 10 : questionIndex + 1} / 10</span><div className="flex gap-1">{Array.from({ length: 10 }, (_, i) => <span key={i} className={`h-1.5 w-4 rounded-full ${i < score ? "bg-emerald-500" : i < questionIndex ? "bg-rose-300" : "bg-border"}`}/>)}</div></div>
      <div className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center"><div className="quiz-question-card relative overflow-hidden rounded-[2rem] border border-primary/15 bg-gradient-to-br from-primary via-emerald-700 to-teal-800 px-5 py-10 text-center text-white shadow-xl"><span className="absolute -right-5 -top-7 text-8xl opacity-10">✳</span><p className="relative text-[10px] font-extrabold uppercase tracking-[.2em] text-white/70">{complete ? tr("Natija", "Final result", "Итог") : `${tr("Qiyinlik", "Level", "Уровень")} · ${levelOptions.find((item) => item.id === level)?.label}`}</p><p className="relative mt-3 text-4xl font-black tracking-tight">{complete ? `${score} / 10` : `${question.prompt} = ?`}</p><p className="relative mt-3 text-sm font-bold text-white/80">{complete ? tr(`Mukofot: +${payout} tanga`, `Reward: +${payout} coins`, `Награда: +${payout} монет`) : tr(`Har to'g'ri javobga ${multiplier} tanga · jami 30 tagacha`, `${multiplier} coin per correct answer · up to 30`, `${multiplier} монеты за ответ · до 30`)}</p></div>
      {complete ? <button onClick={start} className="app-button-3d mt-5 w-full rounded-2xl bg-primary py-3.5 font-extrabold text-primary-foreground">{tr("Qayta o'ynash", "Play again", "Сыграть снова")}</button> : <div className="mt-5 grid grid-cols-2 gap-3">{question.options.map((option) => { const correctOption = locked && option === question.answer; const wrongChoice = locked && selectedAnswer === option && feedback === false; return <button key={option} disabled={locked} onClick={() => answer(option)} className={`app-button-3d rounded-2xl border-2 py-4 text-2xl font-black transition-all ${correctOption ? "border-emerald-500 bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200" : wrongChoice ? "border-rose-400 bg-rose-100 text-rose-800 dark:bg-rose-900/40 dark:text-rose-200" : "border-border bg-card text-foreground hover:border-primary/50"}`}>{option}</button>; })}</div>}
      </div>
    </>}
  </div>;
}

function GamesTab({ gameCoins, user, cosmetics, onCoinsEarned, musicEnabled }: {
  gameCoins: number; user: User; cosmetics: Partial<Record<CosmeticSlot, string>>;
  onCoinsEarned: (n: number) => void; musicEnabled: boolean;
}) {
  const [activeGame, setActiveGame] = useState<string | null>(null);
  const [subTab, setSubTab] = useState<"games" | "rating">("games");
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>(() => loadLeaderboard());
  const [liveTime, setLiveTime] = useState(() => new Date().toLocaleTimeString(activeLocale(), { hour: "2-digit", minute: "2-digit", second: "2-digit" }));
  const [rankingOnline, setRankingOnline] = useState(false);

  useEffect(() => {
    const showRanking = () => setSubTab("rating");
    window.addEventListener("hamyon:open-ranking", showRanking);
    return () => window.removeEventListener("hamyon:open-ranking", showRanking);
  }, []);

  // Refresh shared rankings when configured; keep the local list available offline.
  useEffect(() => {
    let active = true;
    const refresh = async () => {
      const global = await fetchGlobalLeaderboard();
      if (!active) return;
      if (global) { setRankingOnline(true); setLeaderboard(global); }
      else { setRankingOnline(false); setLeaderboard(loadLeaderboard().sort((a, b) => b.coins - a.coins)); }
      setLiveTime(new Date().toLocaleTimeString(activeLocale(), { hour: "2-digit", minute: "2-digit", second: "2-digit" }));
    };
    void refresh();
      const id = setInterval(() => { void refresh(); }, 30000);
    return () => { active = false; clearInterval(id); };
  }, []);

  if (activeGame === "snake") {
    return <SnakeGame onBack={() => setActiveGame(null)} onCoinsEarned={onCoinsEarned} musicEnabled={musicEnabled} currentCoins={gameCoins} />;
  }
  if (activeGame === "memory") return <MemoryGame onBack={() => setActiveGame(null)} onCoinsEarned={onCoinsEarned} musicEnabled={musicEnabled} />;
  if (activeGame === "math") return <MathQuizGame onBack={() => setActiveGame(null)} onCoinsEarned={onCoinsEarned} musicEnabled={musicEnabled} />;

  const games = [
    { id: "snake", name: "Snake", desc: tr("Ilonni boshqar, ovqat ye, rekord qo'y!", "Guide the snake, eat food and set a record!", "Управляй змейкой, ешь и ставь рекорд!"), emoji: "🐍", color: "bg-emerald-100 dark:bg-emerald-900/30", badge: tr("Klassik", "Classic", "Классика"), disabled: false },
    { id: "memory", name: "Memory", desc: tr("Kartochkalarni eslab qol va juftlashtirib top", "Remember the cards and match the pairs", "Запоминайте карточки и находите пары"), emoji: "🃏", color: "bg-blue-100 dark:bg-blue-900/30", badge: tr("O'ynash", "Play", "Играть"), disabled: false },
    { id: "math", name: "Math Quiz", desc: tr("10 ta tezkor misolni yechib, tangalar to'plang", "Solve 10 quick problems and earn coins", "Решите 10 примеров и получите монеты"), emoji: "🧮", color: "bg-purple-100 dark:bg-purple-900/30", badge: tr("O'ynash", "Play", "Играть"), disabled: false },
    { id: "checkers", name: "Checkers", desc: tr("Strategik shashka o'yini", "A classic strategy board game", "Классическая стратегическая игра"), emoji: "🔴", color: "bg-rose-100 dark:bg-rose-900/30", badge: tr("Tez kunda", "Coming soon", "Скоро"), disabled: true },
    { id: "chess", name: "Chess", desc: tr("Donalarni yuriting va shohni himoya qiling", "Plan your moves and protect the king", "Продумывайте ходы и защищайте короля"), emoji: "♟️", color: "bg-slate-100 dark:bg-slate-800/60", badge: tr("Tez kunda", "Coming soon", "Скоро"), disabled: true },
  ];

  const myLevel = getCoinLevel(gameCoins);
  const nextLevel = COIN_LEVELS.find((l) => l.min > gameCoins);
  const myRank = leaderboard.findIndex((e) => e.id === user.id) + 1;
  const levelNumber = COIN_LEVELS.indexOf(myLevel) + 1;

  return (
    <div className="flex-1 overflow-y-auto pb-24">
      <div className="bg-primary px-5 pt-12 pb-6 rounded-b-[2rem] shadow-lg">
        <div className="inline-flex items-center gap-2 bg-white/15 rounded-2xl px-4 py-2 mb-3">
          <Gamepad2 size={18} className="text-primary-foreground" />
          <h2 className="text-primary-foreground text-xl font-bold">{tr("Mini O'yinlar", "Mini Games", "Мини-игры")}</h2>
        </div>
        <div className="grid grid-cols-2 rounded-2xl bg-secondary p-1">
          {(["games", "rating"] as const).map((t) => (
            <Btn key={t} sound="nav" onClick={() => setSubTab(t)}
              className={`rounded-xl py-2.5 text-sm font-extrabold transition-all ${subTab === t ? "bg-card text-primary shadow" : "text-muted-foreground"}`}>
              {t === "games" ? `🎮 ${tr("O'yinlar", "Games", "Игры")}` : `🏆 ${tr("Reyting", "Ranking", "Рейтинг")}`}
            </Btn>
          ))}
        </div>
      </div>

      {subTab === "games" && (
        <div className="px-4 py-4 space-y-3" data-tour="games">
          {/* Coin wallet card */}
          <div className="bg-card rounded-2xl p-4 border border-amber-400/30">
            <div className="flex items-center gap-4 mb-3">
              <div className="w-14 h-14 rounded-2xl bg-amber-100 dark:bg-amber-900/30 flex items-center justify-center text-3xl shrink-0">{myLevel.icon}</div>
              <div className="flex-1">
                <p className="text-xs text-muted-foreground font-semibold uppercase tracking-wide">{tr("Sizning tangalaringiz", "Your coins", "Ваши монеты")}</p>
                <p className="text-2xl font-bold text-amber-500" style={{ fontFamily: "DM Mono, monospace" }}>{gameCoins} 🪙</p>
                <p className="text-xs font-semibold mt-0.5" style={{ color: myLevel.color }}>{myLevel.icon} {rankName(myLevel)}</p>
                <p className="text-[10px] text-muted-foreground mt-0.5">{tr("Daraja", "Rank", "Ранг")} {levelNumber}/{COIN_LEVELS.length}</p>
              </div>
              <div className="text-center">
                <p className="text-xs text-muted-foreground">{tr("O'rningiz", "Your place", "Ваше место")}</p>
                <p className="text-2xl font-bold text-primary">#{myRank || "?"}</p>
              </div>
            </div>
            {/* Level progress */}
            {nextLevel && (
              <div>
                <div className="flex justify-between text-xs mb-1">
                  <span className="text-muted-foreground">{tr("Keyingi daraja:", "Next rank:", "Следующий ранг:")} <span style={{ color: nextLevel.color }}>{nextLevel.icon} {rankName(nextLevel)}</span></span>
                  <span className="text-muted-foreground">{nextLevel.min - gameCoins} 🪙 {tr("qoldi", "left", "осталось")}</span>
                </div>
                <div className="w-full bg-muted rounded-full h-2">
                  <div className="h-2 rounded-full transition-all" style={{ width: `${Math.min(100, ((gameCoins - myLevel.min) / (nextLevel.min - myLevel.min)) * 100)}%`, backgroundColor: nextLevel.color }} />
                </div>
              </div>
            )}
            {!nextLevel && (
              <div className="bg-amber-100 dark:bg-amber-900/30 rounded-xl px-3 py-2 text-center">
                <p className="text-xs font-bold text-amber-600 dark:text-amber-400">🌟 {tr("Eng yuqori daraja! Siz Afsonavisiz!", "Top rank! You are Legendary!", "Высший ранг! Вы — легенда!")}</p>
              </div>
            )}
          </div>

          {games.map((g) => (
            <Btn key={g.id} sound="click"
              onClick={g.disabled ? undefined : () => setActiveGame(g.id)}
              className={`w-full flex items-center gap-4 p-4 rounded-2xl bg-card border border-border text-left ${g.disabled ? "opacity-60" : "hover:border-primary/40"} transition-all`}>
              <div className={`w-14 h-14 rounded-2xl ${g.color} flex items-center justify-center text-3xl shrink-0`}>{g.emoji}</div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-0.5">
                  <p className="font-bold text-foreground">{g.name}</p>
                  <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${g.disabled ? "bg-muted text-muted-foreground" : "bg-primary/10 text-primary"}`}>{g.badge}</span>
                </div>
                <p className="text-sm text-muted-foreground">{g.desc}</p>
              </div>
              {!g.disabled && <span className="text-muted-foreground text-xl shrink-0">›</span>}
            </Btn>
          ))}

          <div className="bg-secondary/50 rounded-2xl p-3.5 space-y-1">
            <p className="text-xs font-bold text-foreground mb-1">{tr("Milestone mukofotlari", "Milestone rewards", "Награды за этапы")}</p>
            {MILESTONES.map((m) => (
              <div key={m.score} className="flex items-center justify-between text-xs">
                <span className="text-muted-foreground">🏅 {m.score} {tr("ball", "points", "очков")} → <span className="font-semibold text-foreground">{lt(m.label)}</span></span>
                <span className="font-bold text-amber-500">+{m.coins}🪙</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {subTab === "rating" && (
        <div className="px-4 py-4" data-tour="rating">
          {/* Live indicator */}
          <div className="flex items-center gap-2 mb-3 px-1">
            <div className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-green-500 inline-block" style={{ animation: "livePulse 1.5s ease infinite" }} />
              <span className="text-xs font-bold text-green-500 uppercase tracking-wide">{tr("JONLI", "LIVE", "ОНЛАЙН")}</span>
            </div>
            <span className={`text-[10px] font-bold ml-auto ${rankingOnline ? "text-emerald-600" : "text-amber-600"}`}>{rankingOnline ? tr("ONLAYN", "ONLINE", "ОНЛАЙН") : tr("QURILMA", "LOCAL", "ЛОКАЛЬНО")}</span>
            <span className="text-xs text-muted-foreground">{liveTime}</span>
          </div>

          <div className="bg-card rounded-2xl overflow-hidden border border-border">
            <div className="px-4 py-3 border-b border-border bg-secondary/40 flex items-center justify-between">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">{tr("O'quvchilar reytingi", "Student ranking", "Рейтинг учеников")}</p>
              <span className="text-xs text-muted-foreground">{leaderboard.length} {tr("nafar", "players", "игроков")}</span>
            </div>

            {leaderboard.length === 0 ? (
              <div className="px-4 py-8 text-center">
                <Trophy size={36} className="mx-auto mb-3 text-muted-foreground opacity-30" />
                <p className="text-sm text-muted-foreground">{tr("Hali o'yinchilar yo'q", "No players yet", "Игроков пока нет")}</p>
              </div>
            ) : (
              leaderboard.map((entry, i) => {
                const isMe = entry.id === user.id;
                const level = getCoinLevel(entry.coins);
                const medal = ["🥇","🥈","🥉"][i] ?? `#${i + 1}`;
                return (
                  <div key={entry.id}
                    className={`flex items-center gap-3 px-4 py-3 border-b border-border last:border-0 transition-colors ${isMe ? "bg-primary/8" : ""}`}>
                    <div className="w-8 text-center shrink-0">
                      {i < 3
                        ? <span className="text-lg">{medal}</span>
                        : <span className="text-sm font-bold text-muted-foreground">#{i + 1}</span>}
                    </div>
                    <ProfileAvatar name={entry.name} avatar={entry.avatar} decoration={isMe ? cosmetics.avatar : undefined} className="h-9 w-9 bg-secondary" />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5">
                        <p className={`text-sm font-semibold truncate ${isMe ? "text-primary" : "text-foreground"}`}><DecoratedName name={entry.name} decoration={isMe ? cosmetics.name : undefined} /></p>
                        {isMe && <span className="text-xs bg-primary/15 text-primary px-1.5 py-0.5 rounded-full font-bold shrink-0">{tr("Siz", "You", "Вы")}</span>}
                      </div>
                      <p className="text-xs text-muted-foreground" style={{ color: level.color }}>{level.icon} {rankName(level)}</p>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <span className="font-bold text-amber-500 text-sm" style={{ fontFamily: "DM Mono, monospace" }}>{entry.coins}</span>
                      <span>🪙</span>
                    </div>
                  </div>
                );
              })
            )}

            <div className="px-4 py-3 bg-secondary/30 border-t border-border">
              <p className="text-xs text-muted-foreground text-center">
                {rankingOnline ? tr("Umumiy reyting 30 soniyada yangilanadi. Balans va xarajatlar qurilmangizda qoladi.", "Global scores refresh every 30 seconds. Your finances stay on this device.", "Общий рейтинг обновляется каждые 30 секунд. Финансовые данные остаются на устройстве.") : hasGlobalRanking ? tr("Serverga ulanib bo'lmadi. Internet ulanishini tekshiring.", "Could not reach the ranking server. Check your connection.", "Не удалось подключиться к серверу рейтинга. Проверьте интернет.") : tr("Umumiy reyting hozircha ulanmagan. Reyting qurilmangizdagi natijalarni ko'rsatmoqda.", "Global ranking is not connected yet. Showing scores on this device.", "Общий рейтинг пока не подключён. Показаны результаты на этом устройстве.")}
              </p>
            </div>
          </div>

          <style>{`@keyframes livePulse{0%,100%{opacity:1;transform:scale(1)}50%{opacity:0.5;transform:scale(1.3)}}`}</style>
        </div>
      )}
    </div>
  );
}

// ─── Nav bar ──────────────────────────────────────────────────────────────────

const ASSISTANT_LINES: Record<Language, Record<Tab, string[]>> = {
  uz: {
    home: ["Salom! Bugun pulingizni nimaga asraymiz?", "Kayfiyatingiz qanday? Xarajatlarni birga ko'ramizmi?", "Kichik tejashlar katta orzularni yaqinlashtiradi!", "Bugungi balansingizga bir nazar tashlaymizmi?", "Xarajat yozib borish — zo'r odat!", "Bugun bir oz tejashga tayyormisiz?", "Haftalik natijangiz qanday ekan?", "Har bir so'mning o'z vazifasi bor!"],
    goals: ["Ooo, maqsadlar bo'limiku! Bugun qanday maqsad kiritamiz?", "Orzu tanlang — men hisoblashga yordam beraman!", "Qaysi maqsadga yana bir qadam yaqinlashamiz?", "Yangi velosipedmi yoki kitobmi? Tanlov sizniki!", "Maqsadni kichik qadamlarga bo'lish osonroq.", "Bugungi kichik tejash ertangi katta yutuq!", "Qaysi orzu sizni ko'proq ilhomlantiradi?", "Maqsadingizga qancha qolganini tekshiramizmi?"],
    games: ["O'yin vaqti! Snake, Memory yoki Math Quiz'dan birini tanlang!", "Memory'da juft rasmlarni eslab qoling, Math Quiz'da misollarni yeching!", "Bugun reytingda nechanchi o'ringa chiqamiz?", "Yangi rankga juda oz qoldi!", "Har bir milestone yangi tanga beradi.", "Rekord yangilashga tayyormisiz?", "Shashka va shaxmat tez kunda qo'shiladi!", "Diqqat va tezlik — g'alaba kaliti!"],
    settings: ["Bu yerda meni ham yoqib-o'chirishingiz mumkin!", "Ilovani o'zingizga moslab oling.", "Qaysi ko'rinish sizga ko'proq yoqadi?", "Tinchlik kerakmi? Ovozlarni shu yerda o'chiring.", "Tilni istalgan payt almashtirish mumkin.", "Yarim tun rejimi ko'zlar uchun yoqimli.", "Bildirishnomalarni nazorat qilish sizning qo'lingizda.", "Men siz tanlagan tilda gaplashaman!"],
    market: ["Marketda yangi bezaklarimni ko'rdingizmi? Hammasi bepul — profilni o'zingizga moslang!", "Yoqtirgan bezagingizni bepul olib, Olinganlar bo'limidan qo'llang!"],
  },
  en: {
    home: ["Hi! What are we saving for today?", "How are you? Shall we review today's spending?", "Small savings bring big dreams closer!", "Want to check today's balance?", "Tracking expenses is a brilliant habit!", "Ready to save a little today?", "Let's see your weekly progress!", "Give every sum a purpose!"],
    goals: ["Oh, the goals page! What shall we add today?", "Pick a dream — I'll help with the numbers!", "Which goal gets one step closer today?", "A bike or a new book? You choose!", "Big goals feel easier in small steps.", "A little saved today is a win tomorrow!", "Which dream inspires you most?", "Shall we check what remains?"],
    games: ["Game time! Choose Snake, Memory or Math Quiz!", "Match the pairs in Memory or solve the Math Quiz!", "How high can we climb today?", "You're close to a new rank!", "Every milestone brings more coins.", "Ready for a new record?", "Checkers and Chess are coming soon!", "Focus and speed are the keys!"],
    settings: ["You can turn me on or off here!", "Make the app feel just right for you.", "Which theme do you like best?", "Need quiet? Turn sounds off here.", "You can change language at any time.", "Midnight mode is easy on the eyes.", "Notifications are under your control.", "I speak the language you choose!"],
    market: ["Seen the new Market cosmetics? They're all free — make your profile yours!", "Get a favorite look for free, then equip it from Owned!"],
  },
  ru: {
    home: ["Привет! На что будем копить сегодня?", "Как настроение? Проверим расходы вместе?", "Маленькие накопления приближают большие мечты!", "Посмотрим сегодняшний баланс?", "Записывать расходы — отличная привычка!", "Готов немного отложить сегодня?", "Проверим результат за неделю?", "Пусть у каждого сума будет цель!"],
    goals: ["О, раздел целей! Какую цель добавим сегодня?", "Выбирай мечту — я помогу с расчётами!", "Какую цель приблизим ещё на шаг?", "Велосипед или новая книга? Выбирать тебе!", "Большую цель легче делить на шаги.", "Маленькое накопление сегодня — победа завтра!", "Какая мечта вдохновляет больше всего?", "Проверим, сколько осталось?"],
    games: ["Время игры! Выбирай Snake, Memory или Math Quiz!", "Ищи пары в Memory или решай примеры в Math Quiz!", "Как высоко поднимемся в рейтинге?", "До нового ранга совсем немного!", "Каждый этап приносит монеты.", "Готов к новому рекорду?", "Шашки и шахматы скоро появятся!", "Внимание и скорость — ключ к победе!"],
    settings: ["Здесь меня можно включить или выключить!", "Настрой приложение под себя.", "Какая тема тебе нравится больше?", "Нужна тишина? Отключи звуки здесь.", "Язык можно сменить в любой момент.", "Режим «Полночь» приятен для глаз.", "Уведомления под твоим контролем.", "Я говорю на выбранном тобой языке!"],
    market: ["Заглянули за украшениями? Они бесплатные — настройте профиль!", "Заберите понравившийся образ и примените его во вкладке «Куплено»!"],
  },
};

function WalletAvatar({ mood, skin, className = "" }: { mood: string; skin?: string; className?: string }) {
  const sleepy = mood === "😴" || mood === "🥱";
  const wink = mood === "😉";
  const surprised = ["😲", "😳", "🤩", "✨", "🥳"].includes(mood);
  const curious = ["👀", "🤔", "🧐", "🤫"].includes(mood);
  const heartEyes = mood === "🥰" || mood === "😍";
  const cool = mood === "😎";
  const sad = mood === "😢" || mood === "😭" || mood === "😟";
  const annoyed = mood === "😠" || mood === "😡" || mood === "😤";
  const blushing = mood === "😳" || mood === "🤗";
  const angelic = mood === "😇";
  const bodyStyle = skin === "helper_leaf"
    ? "border-emerald-800 bg-gradient-to-br from-emerald-300 to-emerald-600 shadow-[0_7px_16px_rgba(4,120,87,.3)]"
    : skin === "helper_nebula"
      ? "border-violet-900 bg-gradient-to-br from-violet-300 via-fuchsia-500 to-indigo-700 shadow-[0_7px_18px_rgba(124,58,237,.4)]"
      : skin === "helper_royal"
        ? "border-yellow-700 bg-gradient-to-br from-yellow-300 via-amber-400 to-orange-500 shadow-[0_7px_18px_rgba(217,119,6,.4)]"
        : "border-amber-700 bg-gradient-to-br from-amber-400 to-amber-600 shadow-[0_7px_16px_rgba(120,70,0,.25)]";
  const stripeStyle = skin === "helper_leaf" ? "bg-emerald-900/55 border-emerald-950/30" : skin === "helper_nebula" ? "bg-indigo-950/45 border-violet-100/40" : skin === "helper_royal" ? "bg-amber-800/45 border-yellow-100/50" : "bg-amber-700/60 border-amber-800/30";
  const armStyle = skin === "helper_leaf" ? "bg-emerald-600" : skin === "helper_nebula" ? "bg-violet-600" : skin === "helper_royal" ? "bg-amber-500" : "bg-amber-600";
  const pupil = curious ? "translate-x-[2px] -translate-y-[1px]" : "";
  const eye = (left: boolean) => sleepy || (wink && left)
    ? <span className="absolute top-[48%] w-[85%] border-t-[2px] border-slate-900 rounded-full" />
    : cool
      ? <span className="absolute inset-x-0 top-[20%] h-[65%] rounded-sm bg-slate-900 border-y border-slate-700" />
      : heartEyes
        ? <span className="text-[8px] leading-none text-rose-600">♥</span>
        : <span className={`w-[45%] h-[55%] rounded-full bg-slate-900 ${pupil}`} />;
  return (
    <div className={`helper-avatar-skin helper-skin-${skin ?? "default"} relative box-border rounded-[28%] border-[3px] ${bodyStyle} ${className}`}>
      <span className={`absolute left-[13%] right-[13%] top-[10%] h-[16%] rounded-md border ${stripeStyle}`} />
      <span style={{ animation: !sleepy && !wink ? "helperBlink 5.8s ease-in-out infinite" : undefined }} className="absolute left-[22%] top-[43%] w-[19%] h-[25%] rounded-full bg-white border border-amber-800 flex items-center justify-center overflow-hidden">
        {eye(true)}
      </span>
      <span style={{ animation: !sleepy ? "helperBlink 5.8s ease-in-out infinite" : undefined }} className="absolute right-[22%] top-[43%] w-[19%] h-[25%] rounded-full bg-white border border-amber-800 flex items-center justify-center overflow-hidden">
        {eye(false)}
      </span>
      {(curious || annoyed) && <><span className={`absolute left-[22%] top-[35%] w-[18%] h-[2px] bg-amber-950 rounded-full ${annoyed ? "rotate-12" : "-rotate-12"}`}/><span className={`absolute right-[22%] top-[35%] w-[18%] h-[2px] bg-amber-950 rounded-full ${annoyed ? "-rotate-12" : "rotate-12"}`}/></>}
      {surprised
        ? <span className="absolute left-[44%] top-[73%] w-[12%] h-[12%] rounded-full bg-slate-900" />
        : sad || annoyed
          ? <span className="absolute left-[39%] top-[76%] w-[22%] h-[10%] border-t-[2px] border-slate-900 rounded-t-full" />
          : <span className={`absolute left-[39%] top-[72%] w-[22%] h-[10%] border-b-[2px] border-slate-900 rounded-b-full ${sleepy ? "opacity-60" : ""}`} />}
      {sad && <span className="absolute right-[13%] top-[65%] w-[6%] h-[13%] bg-sky-400 rounded-b-full rounded-tl-full rotate-12" />}
      {blushing && <><span className="absolute left-[20%] top-[69%] w-[13%] h-[7%] rounded-full bg-rose-400/70"/><span className="absolute right-[20%] top-[69%] w-[13%] h-[7%] rounded-full bg-rose-400/70"/></>}
      {angelic && <span className="absolute left-[33%] -top-[15%] w-[34%] h-[11%] rounded-full border-2 border-yellow-300 shadow-[0_0_9px_rgba(253,224,71,.8)]"/>}
      {mood === "😳" && <span className="absolute right-[13%] top-[30%] text-[8px] text-white">✦</span>}
      {mood === "😋" && <span className="absolute left-[47%] top-[77%] w-[10%] h-[12%] rounded-b-full bg-rose-500"/>}
      {mood === "🤫" && <span className="absolute left-[48%] top-[62%] w-[4%] h-[18%] rounded-full bg-white border border-slate-400"/>}
      {mood === "😤" && <span className="absolute left-[14%] top-[55%] text-[8px] text-white/90">〰</span>}
      {mood === "😡" && <span className="absolute left-[42%] top-[65%] w-[16%] h-[2px] bg-rose-600 rounded-full" />}
      <span className={`absolute -left-[5%] top-[55%] w-[9%] h-[25%] rounded-full ${armStyle} rotate-12`} />
      <span className={`absolute -right-[5%] top-[55%] w-[9%] h-[25%] rounded-full ${armStyle} -rotate-12`} />
      {skin === "helper_leaf" && <><span className="absolute -right-[12%] -top-[17%] text-[11px] drop-shadow" style={{animation:"leafWiggle 2.3s ease-in-out infinite"}}>🍃</span><span className="absolute -left-[12%] top-[18%] text-[10px] drop-shadow" style={{animation:"leafWiggle 2.8s ease-in-out infinite reverse"}}>🌿</span><span className="absolute left-[45%] -bottom-[16%] text-[10px]">🌱</span></>}
      {skin === "helper_nebula" && <><span className="absolute -right-[8%] -top-[20%] text-[12px] drop-shadow-[0_0_5px_rgba(255,255,255,.9)]" style={{animation:"nebulaTwinkle 1.7s ease-in-out infinite"}}>✦</span><span className="absolute -left-[10%] top-[8%] text-[10px] text-cyan-100" style={{animation:"nebulaTwinkle 2.2s ease-in-out infinite .3s"}}>✧</span><span className="absolute -inset-[10%] rounded-[32%] border border-violet-200/70 pointer-events-none" style={{animation:"nebulaOrbit 6s linear infinite"}}/></>}
      {skin === "helper_royal" && <><span className="absolute left-[35%] -top-[28%] text-[15px] drop-shadow" style={{animation:"royalCrown 2.2s ease-in-out infinite"}}>👑</span><span className="absolute -left-[9%] top-[72%] text-[9px] text-yellow-100">✦</span><span className="absolute -right-[9%] top-[72%] text-[9px] text-yellow-100">✦</span></>}
    </div>
  );
}

function Assistant({ tab, user, language, helperSkin, introRequested, onIntroDone, onTabChange }: { tab: Tab; user: User; language: Language; helperSkin?: string; introRequested: boolean; onIntroDone: () => void; onTabChange: (tab: Tab) => void }) {
  const [open, setOpen] = useState(false);
  const [intro, setIntro] = useState(introRequested);
  const [stepIndex, setStepIndex] = useState<number | null>(null);
  const [line, setLine] = useState("");
  const [typedLine, setTypedLine] = useState("");
  const [messageMood, setMessageMood] = useState("😊");
  const [isDragging, setIsDragging] = useState(false);
  const [isRaging, setIsRaging] = useState(false);
  const [idleMood, setIdleMood] = useState("😊");
  const [spotlight, setSpotlight] = useState<DOMRect | null>(null);
  const [viewportHeight, setViewportHeight] = useState(() => window.innerHeight);
  const [activeFaq, setActiveFaq] = useState<number | null>(null);
  const draggedRef = useRef(false);
  const pointerRef = useRef<{ id: number; x: number; y: number; left: number; top: number } | null>(null);
  const shakeRef = useRef({ x: 0, y: 0, at: 0, axis: "" as "x" | "y" | "", direction: 0, reversals: 0 });
  const rageTimeoutRef = useRef<number | null>(null);
  const [position, setPosition] = useState(() => {
    try {
      const saved = JSON.parse(localStorage.getItem("hamyon_helper_position") ?? "null");
      if (saved && Number.isFinite(saved.x) && Number.isFinite(saved.y)) return { x: saved.x, y: saved.y };
    } catch {}
    return { x: Math.max(12, window.innerWidth - 82), y: Math.max(96, window.innerHeight - 190) };
  });
  const c = COPY[language];
  const tour: { tab: Tab; target?: string; title: string[]; body: string[]; mood: string }[] = [
    { tab: "home" as Tab, target: "home-balance", title: ["Asosiy sahifa", "Home", "Главная"], body: ["Bu yerda joriy mablag'ingiz, bugungi va haftalik sarflaringiz ko'rinadi. Pastdagi Mablag', Xarajat va Tejash tugmalari orqali amallarni bajaring.", "See your balance and spending here. Use Balance, Expense and Save to manage money.", "Здесь видны баланс и расходы. Кнопки «Баланс», «Расход» и «Накопить» помогут управлять деньгами."], mood: "😊" },
    { tab: "home" as Tab, target: "home-actions", title: ["Mablag' va xarajat", "Balance and expenses", "Баланс и расходы"], body: ["Mablag'ni kiriting, xarajatga miqdor va toifani tanlang. Xarajat balansdan ayriladi va haftalik grafikda aks etadi.", "Set your balance, then add an expense with an amount and category. It updates your balance and chart.", "Укажите баланс, затем добавьте расход с суммой и категорией. Баланс и график обновятся."], mood: "🧐" },
    { tab: "home" as Tab, target: "home-actions", title: ["Tejash rejalari", "Saving", "Накопления"], body: ["Tejash tugmasi pulni tanlangan maqsadga o'tkazadi. Yangi maqsadlarni pastdagi Maqsadlar bo'limidan yarating.", "Save moves money toward a selected goal. Create goals in the Goals tab.", "Кнопка накопления переводит деньги к выбранной цели. Создавайте цели во вкладке «Цели»."], mood: "🌟" },
    { tab: "home" as Tab, target: "statistics", title: ["Statistika va tahlil", "Statistics and insights", "Статистика и анализ"], body: ["Haftalik grafikda kunma-kun sarflarni ko'ring. Toifalar kesimi pul ko'proq qayerga ketganini ko'rsatadi.", "Use the weekly chart to compare days. The category breakdown shows where most money went.", "График сравнивает расходы по дням, а категории показывают, куда ушло больше всего денег."], mood: "🧐" },
    { tab: "home" as Tab, target: "expenses", title: ["Xarajatlar tarixi", "Expense history", "История расходов"], body: ["Bugungi xarajatlar ro'yxatida summa, izoh va toifani ko'ring. Xarajat qo'shganda u balansdan ayriladi.", "Review today's expense amounts, notes and categories. New expenses are deducted from your balance.", "Здесь видны суммы, примечания и категории расходов за день. Новые расходы вычитаются из баланса."], mood: "🤔" },
    { tab: "goals" as Tab, target: "goals-create", title: ["Maqsadlar", "Goals", "Цели"], body: ["Yangi maqsad nomi, kerakli summa va belgisini tanlang. Kartada yig'ilgan summa va foiz ko'rinadi; mavjud maqsadlarni tahrirlash yoki o'chirish, erishilganlarini ko'rish mumkin.", "Create a goal with a name, target and icon. Track its saved amount and progress, edit or remove it, and review completed goals.", "Создайте цель с названием, суммой и значком. Следите за прогрессом, редактируйте и удаляйте цели, просматривайте выполненные."], mood: "🤩" },
    { tab: "market" as Tab, target: "market", title: ["Bezaklar Marketi", "Cosmetics Market", "Маркет украшений"], body: ["Profil ramkasi, nik uslubi, ilova mavzusi yoki yordamchi ko'rinishidan bepul tanlang. Olinganlar bo'limidan ularni qo'llang yoki almashtiring.", "Choose a profile frame, name style, app theme or helper look for free. Equip or switch them in Owned.", "Выберите рамку профиля, стиль имени, тему приложения или образ помощника бесплатно. Применяйте и меняйте их во вкладке «Куплено»."], mood: "✨" },
    { tab: "games" as Tab, target: "games", title: ["O'yinlar va tangalar", "Games and coins", "Игры и монеты"], body: ["Snake'da ilonni maydonda surish orqali boshqaring. Memory'da kartalardagi juft belgilarni toping, Math Quiz'da 10 ta misolni yeching. O'yinlardan tanga to'plang; shashka va shaxmat tez kunda qo'shiladi.", "Swipe the Snake board to steer. Find matching pairs in Memory and solve 10 questions in Math Quiz. Earn coins as you play; Checkers and Chess are coming soon.", "Проведите по полю Snake, чтобы управлять змейкой. В Memory находите пары, а в Math Quiz решайте 10 примеров. За игры можно получить монеты; шашки и шахматы скоро появятся."], mood: "😄" },
    { tab: "games" as Tab, target: "rating", title: ["Umumiy reyting", "Global ranking", "Общий рейтинг"], body: ["Serverga ulanish mavjud bo'lsa barcha foydalanuvchilarning o'yin natijalari ko'rinadi; aks holda qurilmadagi reyting ko'rsatiladi.", "When the ranking server is available, scores from all players appear here; otherwise, the device ranking is shown.", "При подключении сервера здесь видны результаты всех игроков; без соединения показывается рейтинг устройства."], mood: "🏆" },
    { tab: "settings" as Tab, target: "appearance", title: ["Mavzuni tanlash", "Choose a theme", "Выбор темы"], body: ["Standart oq-yashil ko'rinish, qorong'i, yarim tun va yangi pastel olovrang mavzularidan birini tanlang.", "Choose the default white and green, Dark, Midnight or the new soft Orange theme.", "Выберите стандартную бело-зелёную, тёмную, полуночную или новую мягкую оранжевую тему."], mood: "✨" },
    { tab: "settings" as Tab, target: "currency", title: ["Valyuta", "Currency", "Валюта"], body: ["So'm, rubl yoki dollarni tanlang. Balans, xarajatlar va maqsadlar Markaziy bankning so'nggi mavjud kursi bilan yangi valyutaga o'tkaziladi.", "Choose UZS, RUB or USD. Your balance, expenses and goals are converted with the latest available Central Bank rate.", "Выберите сум, рубль или доллар. Баланс, расходы и цели пересчитываются по последнему доступному курсу Центрального банка."], mood: "🧐" },
    { tab: "settings" as Tab, target: "preferences", title: ["Til va qulayliklar", "Language and preferences", "Язык и параметры"], body: ["Ilova tilini, bildirishnomalarni, o'yin musiqasini, tugma tovushlarini va yordamchini shu yerdan boshqarasiz.", "Change the language, notifications, game music, button sounds and helper here.", "Здесь настраиваются язык, уведомления, игровая музыка, звуки кнопок и помощник."], mood: "🙂" },
    { tab: "settings" as Tab, target: "profile", title: ["Profil va saqlash", "Profile and saved data", "Профиль и сохранение"], body: ["Ism yoki profil rasmini yangilang. Mablag', xarajat va maqsadlaringiz ushbu qurilmada saqlanadi.", "Update your name or photo. Your balance, expenses and goals are saved on this device.", "Измените имя или фото. Баланс, расходы и цели сохраняются на этом устройстве."], mood: "💛" },
  ];
  const pick = (values: string[]) => values[language === "uz" ? 0 : language === "en" ? 1 : 2];
  const faq: { q: string[]; a: string[]; mood?: string }[] = [
    { q: ["HamyonUp nima uchun kerak?", "What is HamyonUp for?", "Для чего нужно приложение HamyonUp?"], a: ["Bu ilova mablag'ingizni kuzatish, xarajatlarni yozib borish va tejash maqsadlariga yetishga yordam beradi.", "Track your balance and spending, and work toward savings goals.", "Приложение помогает следить за балансом, расходами и накоплениями."] },
    { q: ["Topgan pulimni balansga qanday qo'shaman?", "How do I add earned money to my balance?", "Как добавить заработанное к балансу?"], a: ["Asosiy sahifadagi «Mablag' qo'shish»ni bosing. Summa mavjud qoldiq ustiga qo'shiladi; kuniga 3 marta kiritish mumkin.", "Tap Add money on Home. The amount is added to your current balance, up to 3 times a day.", "Нажмите «Добавить доход» на главной. Сумма прибавится к остатку; до 3 раз в день."] },
    { q: ["Xarajatni qanday qo'shaman?", "How do I add an expense?", "Как добавить расход?"], a: ["Xarajat tugmasidan miqdor va toifani tanlang, izoh yozish ixtiyoriy. Summa balansdan avtomatik ayriladi.", "Tap Expense, choose an amount and category, and optionally add a note. It is deducted from your balance.", "Нажмите «Расход», укажите сумму и категорию, при желании добавьте заметку. Сумма вычтется из баланса."] },
    { q: ["Maqsad yaratib, unga qanday pul yig'aman?", "How do I create and save toward a goal?", "Как создать цель и копить на неё?"], a: ["Maqsadlar bo'limida yangi maqsad yarating. So'ng Asosiy sahifadagi Tejash tugmasi orqali pul o'tkazing.", "Create a goal in Goals, then move money to it with Save on the Home screen.", "Создайте цель в разделе «Цели», затем переводите деньги кнопкой «Накопить» на главном экране."] },
    { q: ["Valyutani qayerdan almashtiraman?", "Where can I change currency?", "Где сменить валюту?"], a: ["Sozlamalardagi Valyuta qismidan so'm, rubl yoki dollarni tanlang. Mavjud balans, xarajatlar va maqsad summalari Markaziy bankning so'nggi kursi bo'yicha avtomatik konvertatsiya qilinadi.", "Choose UZS, RUB or USD in Settings. Your balance, expenses and goal amounts are converted using the latest available Central Bank rate.", "Выберите сум, рубль или доллар в настройках. Баланс, расходы и цели автоматически пересчитываются по последнему доступному курсу Центрального банка."] },
    { q: ["Ilova ranglari va tilini qanday o'zgartiraman?", "How do I change the theme or language?", "Как изменить тему или язык?"], a: ["Sozlamalarda Standart, Qorong'i, Yarim tun yoki Olovrang mavzuni, shuningdek o'zingizga qulay tilni tanlang.", "In Settings, choose Default, Dark, Midnight or Orange, and select your preferred language.", "В настройках выберите тему и удобный язык приложения."] },
    { q: ["Snake o'yinini qanday boshqaraman?", "How do I control Snake?", "Как управлять Snake?"], a: ["Snake'ni O'yinlar bo'limidan oching. To'liq ekranda kerakli tomonga barmog'ingiz bilan suring; joystik kerak emas.", "Open Snake from Games. Swipe on the full-screen board in the direction you want; there is no joystick.", "Откройте Snake в разделе игр. Ведите пальцем по полноэкранному полю в нужную сторону; джойстик не нужен."] },
    { q: ["Tangalar va reyting qanday ishlaydi?", "How do coins and ranking work?", "Как работают монеты и рейтинг?"], a: ["Snake bosqichlarini bajarsangiz tanga olasiz. Reyting mavjud server sozlamasiga qarab umumiy yoki qurilmadagi natijalarni ko'rsatadi.", "Reach Snake milestones to earn coins. Ranking can be global or device-only depending on server setup.", "За этапы Snake начисляются монеты. Рейтинг зависит от подключения общего сервера."] },
    { q: ["Ma'lumotlarim qayerda saqlanadi?", "Where is my data stored?", "Где хранятся мои данные?"], a: ["Balans, xarajatlar va maqsadlar ushbu qurilmada saqlanadi. Profil rasmini va ismingizni Sozlamalarda tahrirlashingiz mumkin.", "Your balance, expenses and goals are stored on this device. Edit your name or photo in Settings.", "Баланс, расходы и цели хранятся на устройстве. Имя и фото можно изменить в настройках."] },
    { q: ["Bugungi va haftalik xarajatlarimni qayerdan ko'raman?", "Where can I see today's and weekly spending?", "Где посмотреть расходы за сегодня и неделю?"], a: ["Asosiy sahifaning yuqori kartalarida bugungi va haftalik jami ko'rsatiladi. Pastroqda haftalik grafik va xarajat toifalari bor.", "The Home screen shows today's and weekly totals, followed by a weekly chart and category breakdown.", "На главной странице показаны суммы за сегодня и неделю, ниже — график и расходы по категориям."], mood: "🧐" },
    { q: ["Xarajat balansimdan ko'p bo'lsa nima bo'ladi?", "What if an expense is larger than my balance?", "Что будет, если расход больше баланса?"], a: ["Xarajat saqlanmaydi. Hisobingizda yetarlicha mablag' bo'lmasa, ilova ogohlantiradi va balansni o'zgartirmaydi.", "The expense is rejected. If your balance is too low, the app warns you and leaves both the balance and expense list unchanged.", "Расход не сохранится. Если средств недостаточно, приложение предупредит вас и не изменит баланс."], mood: "🤔" },
    { q: ["Mablag'ni kuniga necha marta qo'sha olaman?", "How many times can I add money each day?", "Сколько раз в день можно добавлять деньги?"], a: ["Topilgan mablag'ni bir kunda 3 marta qo'shish mumkin. Keyingi kuni limit yangilanadi, kechagi qoldiq esa balansda qoladi.", "You can add earned money up to 3 times per day. The limit resets the next day, and your remaining balance carries over.", "Доход можно добавлять до 3 раз в день. На следующий день лимит обновится, а остаток сохранится."], mood: "💡" },
    { q: ["Maqsadimni tahrirlash yoki o'chirish mumkinmi?", "Can I edit or remove a goal?", "Можно изменить или удалить цель?"], a: ["Ha. Maqsad kartasidagi tahrirlash yoki o'chirish belgisini bosing. Yig'ilgan summa va maqsad qiymati birga ko'rsatiladi.", "Yes. Use the edit or delete control on a goal card. Each card also shows saved and target amounts.", "Да. Используйте кнопки изменения или удаления на карточке цели. Там же видны накопления и нужная сумма."], mood: "😊" },
    { q: ["Maqsadga yetganimni qanday bilaman?", "How do I know when I reach a goal?", "Как узнать, что цель достигнута?"], a: ["Yig'ilgan summa maqsadga tenglashganda karta bajarilganlar bo'limiga o'tadi; bildirishnomalar yoqilgan bo'lsa tabrik ko'rsatiladi.", "When saved reaches the target, the goal appears in completed goals. A celebration appears if notifications are enabled.", "Когда накопления достигают цели, она появляется среди выполненных. Если уведомления включены, появится поздравление."], mood: "🥳" },
    { q: ["Valyutani almashtirsam, summalar yo'qoladimi?", "Will my amounts be lost if I change currency?", "Суммы пропадут при смене валюты?"], a: ["Yo'q. Summalar yagona ichki hisob birligida saqlanadi va tanlangan valyutada ko'rsatiladi. Takror-takror almashtirish saqlangan qiymatni o'zgartirmaydi.", "No. Amounts stay in one base unit and are converted for display. Switching back and forth won't alter the stored value.", "Нет. Суммы хранятся в единой базовой единице и пересчитываются только для показа. Повторное переключение не меняет сохранённое значение."], mood: "😇" },
    { q: ["Internet bo'lmasa ham valyuta almashtiradimi?", "Can I change currency offline?", "Можно менять валюту без интернета?"], a: ["Ha. Internet bo'lsa Markaziy bankning yangi kursi olinadi; ulanmagan paytda oxirgi saqlangan kurs qo'llanadi.", "Yes. The app refreshes Central Bank rates when online and uses its last saved rate while offline.", "Да. При подключении приложение обновляет курс Центрального банка, а без сети использует последний сохранённый курс."], mood: "🤓" },
    { q: ["Marketdan bezakni qanday olaman?", "How do I get a Market item?", "Как получить украшение в Маркете?"], a: ["Do'kon bo'limidagi bepul bezaklardan tanlang va «Bepul olish»ni bosing. Buyum Olinganlar bo'limida saqlanadi.", "Choose any free item in the Shop and tap Get free. It will be saved in Owned.", "Выберите бесплатное украшение в магазине и нажмите «Забрать бесплатно». Оно сохранится во вкладке «Куплено»."], mood: "🛍️" },
    { q: ["Olingan bezagimni qanday yoqaman?", "How do I equip an item I got?", "Как применить полученное украшение?"], a: ["Marketdagi Olinganlar bo'limini ochib, buyumning Qo'llash tugmasini bosing. Har bir turdan bittadan bezak tanlanadi; faol bezakni Yechish bilan o'chiring.", "Open Owned in Market and tap Equip. One item per type can be active; tap Unequip to remove it.", "Откройте «Куплено» в Маркете и нажмите «Применить». Активен один предмет каждого типа; снимите его кнопкой «Снять»."], mood: "✨" },
    { q: ["Reytingim va tangalarim qanday hisoblanadi?", "How are my rank and coins counted?", "Как считаются рейтинг и монеты?"], a: ["Snake'da bosqich chegaralariga yetganda tanga beriladi. Serverga ulanish bo'lsa reyting umumiy natijalarni ko'rsatadi, aks holda qurilmadagi natijalar ko'rinadi.", "Snake awards coins at score milestones. Ranking uses shared scores when its server is available and local scores otherwise.", "В Snake монеты начисляются за этапы. При подключённом сервере рейтинг общий, иначе показываются результаты устройства."], mood: "🤩" },
    { q: ["Yordamchi ovoz chiqarib gapiradimi?", "Does the Helper speak aloud?", "Помощник говорит вслух?"], a: ["Yordamchi matnni ekranda ko'rsatadi va kichik tovush effektlari chiqaradi; ovozli nutq ishlatilmaydi. Tovushlarni Sozlamalardan o'chirish mumkin.", "The Helper shows text and plays short sound effects; it doesn't use spoken voice. Turn sound effects off in Settings.", "Помощник показывает текст и проигрывает короткие звуковые эффекты, но не озвучивает речь. Звуки можно отключить в настройках."], mood: "😋" },
    { q: ["Ilova ma'lumotlarimni qayerda saqlaydi?", "Where does the app keep my data?", "Где приложение хранит мои данные?"], a: ["Balans, xarajatlar, maqsadlar va profil qurilmangizda saqlanadi. Umumiy reytingga faqat ismingiz va o'yin tangalaringiz yuborilishi mumkin.", "Your balance, expenses, goals and profile stay on this device. Only your name and game coins may be sent to the shared ranking.", "Баланс, расходы, цели и профиль хранятся на устройстве. В общий рейтинг могут отправляться только имя и игровые монеты."], mood: "🛡️" },
    { q: ["Rasmimni yoki ismimni qanday almashtiraman?", "How do I change my photo or name?", "Как изменить фото или имя?"], a: ["Sozlamalardagi profil qismiga o'tib, Tahrirlashni bosing. Yangi rasm tanlash ixtiyoriy.", "Open the profile section in Settings and tap Edit. Adding a new photo is optional.", "Откройте профиль в настройках и нажмите «Изменить». Новое фото добавлять необязательно."], mood: "🤗" },
    { q: ["O'yin musiqasi yoki tugma tovushlarini qayerda boshqaraman?", "Where do I control music and button sounds?", "Где настроить музыку и звуки кнопок?"], a: ["Sozlamalarda O'yin musiqasi va Tugma ovozlari sozlamalarini alohida yoqib-o'chiring.", "Use the separate Game music and Button sounds switches in Settings.", "В настройках отдельно включите или выключите музыку игры и звуки кнопок."], mood: "🎵" },
    { q: ["Memory o'yinida nima qilish kerak?", "How do I play Memory?", "Как играть в Memory?"], a: ["6, 8 yoki 12 juftli qiyinlikni tanlang va bir xil belgili kartalarni toping. O'yinni yakunlasangiz 2–7 tanga olasiz; kamroq yurish mukofotni oshiradi.", "Choose 6, 8 or 12 pairs, then find matching cards. Finishing earns 2–7 coins, with fewer moves improving the reward.", "Выберите уровень на 6, 8 или 12 пар и находите одинаковые карточки. За завершение даётся 2–7 монет; меньше ходов — выше награда."], mood: "🧠" },
    { q: ["Math Quiz va tangalar qanday ishlaydi?", "How does Math Quiz and its reward work?", "Как работает Math Quiz и награды?"], a: ["10 ta savolni yengil, o'rta yoki qiyin darajada yeching. To'g'ri javob qiyinlikka qarab 1, 2 yoki 3 tanga beradi — bir o'yinda 10, 20 yoki 30 tagacha.", "Solve 10 questions on Easy, Medium or Hard. Each correct answer earns 1, 2 or 3 coins depending on level, up to 10, 20 or 30 per round.", "Решите 10 задач на лёгком, среднем или сложном уровне. За ответ начисляется 1, 2 или 3 монеты — до 10, 20 или 30 за игру."], mood: "🧮" },
    { q: ["Shashka va shaxmatni qachon o'ynash mumkin?", "When can I play Checkers and Chess?", "Когда можно будет сыграть в шашки и шахматы?"], a: ["Ular O'yinlar ro'yxatida ko'rinadi, lekin hozircha tayyorlanmoqda. Ishga tushganda shu bo'limda o'ynash mumkin bo'ladi.", "They appear in the Games list while in development. When ready, you can launch them from the same section.", "Они уже показаны в списке игр, но пока разрабатываются. После запуска сыграть можно будет в этом же разделе."], mood: "🤔" },
    { q: ["Yordamchi bildirishnomalarini qanday sozlayman?", "How do I manage Helper notifications?", "Как настроить уведомления помощника?"], a: ["Sozlamalarda Bildirishnomalar tugmasini yoqing yoki o'chiring. Yoqilganda Android ruxsat so'raydi va yordamchi kuniga uch mahal eslatma yuboradi.", "Turn Notifications on or off in Settings. Android asks permission when enabled, then the Helper sends three daily reminders.", "Включите или отключите уведомления в настройках. Android запросит разрешение, после чего помощник будет отправлять три напоминания в день."], mood: "🔔" },
  ];
  const showHelperMessage = (text: string, mood = idleMood) => {
    setMessageMood(mood);
    const persona = helperSkin === "helper_leaf"
      ? tr("Bargdek sokin maslahat: ", "A calm little leaf tip: ", "Спокойный совет от листочка: ")
      : helperSkin === "helper_nebula"
        ? tr("Yulduzlar orasidan signal: ", "A signal from the stars: ", "Сигнал из звёздной дали: ")
        : helperSkin === "helper_royal"
          ? tr("Qirollik maslahati: ", "A royal recommendation: ", "Совет от королевского помощника: ")
          : "";
    setLine(`${persona}${text}`);
    helperChirp(mood, helperSkin);
  };
  const activeTour = stepIndex === null ? null : tour[stepIndex];
  useEffect(() => {
    if (intro || stepIndex !== null) return;
    const messages = ASSISTANT_LINES[language][tab];
    const next = messages[Math.floor(Math.random() * messages.length)];
    const message = tab === "home" ? `${user.name}, ${next.charAt(0).toLowerCase()}${next.slice(1)}` : next;
    setLine(message);
    showHelperMessage(message);
  }, [tab, language, user.name]);
  useEffect(() => {
    setTypedLine(""); let n = 0;
    const timer = window.setInterval(() => { n++; setTypedLine(line.slice(0, n)); if (n >= line.length) window.clearInterval(timer); }, 24);
    return () => window.clearInterval(timer);
  }, [line]);
  useEffect(() => {
    const moods = ["😴", "👀", "😊", "🤔", "✨", "😉", "🥰", "😢", "😠", "😎", "🤩", "😲", "😳", "🥳", "😇", "😋", "🤗", "🥱", "😤", "🤫", "😭", "🧐"];
    const id = window.setInterval(() => setIdleMood(moods[Math.floor(Math.random() * moods.length)]), 5200);
    return () => window.clearInterval(id);
  }, []);
  useEffect(() => {
    const currentTour = stepIndex === null ? null : tour[stepIndex];
    if (!currentTour?.target) { setSpotlight(null); return; }
    const update = () => {
      if (currentTour.target === "rating") window.dispatchEvent(new Event("hamyon:open-ranking"));
      const target = document.querySelector(`[data-tour="${currentTour.target}"]`);
      target?.scrollIntoView({ behavior: "smooth", block: "center" });
      setSpotlight(target?.getBoundingClientRect() ?? null);
    };
    const raf = window.requestAnimationFrame(update);
    const retry = window.setTimeout(update, currentTour.target === "rating" ? 120 : 50);
    window.addEventListener("resize", update); window.addEventListener("scroll", update, true);
    return () => { window.cancelAnimationFrame(raf); window.clearTimeout(retry); window.removeEventListener("resize", update); window.removeEventListener("scroll", update, true); };
  }, [stepIndex, tab]);
  useEffect(() => { setIntro(introRequested); }, [introRequested]);
  useEffect(() => {
    if (intro) showHelperMessage(pick(["Ilovadan qanday foydalanishni tushuntirib beraymi?", "Would you like me to explain how to use the app?", "Хотите, я объясню, как пользоваться приложением?"]));
  }, [intro, language]);
  useEffect(() => {
    const clamp = () => { setViewportHeight(window.innerHeight); setPosition((p) => ({ x: Math.min(p.x, window.innerWidth - 70), y: Math.min(p.y, window.innerHeight - 70) })); };
    window.addEventListener("resize", clamp);
    return () => window.removeEventListener("resize", clamp);
  }, []);
  
  const startTour = () => { setIntro(false); setOpen(true); setStepIndex(0); onTabChange(tour[0].tab); localStorage.setItem("hamyon_helper_intro_done", "1"); onIntroDone(); showHelperMessage(pick(tour[0].body), tour[0].mood); };
  const finishIntro = () => { setIntro(false); localStorage.setItem("hamyon_helper_intro_done", "1"); onIntroDone(); };
  const closeHelper = () => { if (intro) finishIntro(); setOpen(false); setStepIndex(null); };
  const moveTour = (direction: -1 | 1) => {
    if (stepIndex === null) return;
    const next = stepIndex + direction;
    if (next < 0) return;
    if (next >= tour.length) { setStepIndex(null); setOpen(false); showHelperMessage(pick(["Zo'r! Endi ilovadan mustaqil foydalanishingiz mumkin.", "Great! You are ready to explore the app.", "Отлично! Теперь можно пользоваться приложением самостоятельно."])); return; }
    setStepIndex(next); onTabChange(tour[next].tab); showHelperMessage(pick(tour[next].body), tour[next].mood);
  };
  const triggerRage = () => {
    if (isRaging) return;
    setIsRaging(true);
    setIsDragging(false);
    pointerRef.current = null;
    draggedRef.current = true;
    showHelperMessage(pick(["Voy, bas qil! Juda tez qimirlatding-ku!", "Hey, easy there! That was a lot of shaking!", "Ой, хватит! Ты слишком быстро меня трясёшь!"]), "😡");
    if (rageTimeoutRef.current !== null) window.clearTimeout(rageTimeoutRef.current);
    rageTimeoutRef.current = window.setTimeout(() => { setIsRaging(false); setIdleMood("😤"); }, 2300);
  };
  useEffect(() => () => { if (rageTimeoutRef.current !== null) window.clearTimeout(rageTimeoutRef.current); }, []);
  const onPointerDown = (e: React.PointerEvent<HTMLButtonElement>) => {
    pointerRef.current = { id: e.pointerId, x: e.clientX, y: e.clientY, left: position.x, top: position.y };
    shakeRef.current = { x: e.clientX, y: e.clientY, at: performance.now(), axis: "", direction: 0, reversals: 0 };
    draggedRef.current = false;
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent<HTMLButtonElement>) => {
    if (isRaging) return;
    const pointer = pointerRef.current;
    if (!pointer || pointer.id !== e.pointerId) return;
    const now = performance.now();
    const sample = shakeRef.current;
    const moveX = e.clientX - sample.x, moveY = e.clientY - sample.y;
    const axis: "x" | "y" = Math.abs(moveX) >= Math.abs(moveY) ? "x" : "y";
    const delta = axis === "x" ? moveX : moveY;
    const direction = Math.sign(delta);
    const fastMove = now - sample.at < 190 && Math.abs(moveX) + Math.abs(moveY) > 18;
    let reversals = now - sample.at > 280 ? 0 : sample.reversals;
    if (fastMove && sample.axis === axis && sample.direction !== 0 && direction !== sample.direction) reversals += 1;
    shakeRef.current = { x: e.clientX, y: e.clientY, at: now, axis, direction, reversals };
    if (reversals >= 5) { triggerRage(); return; }
    const dx = e.clientX - pointer.x, dy = e.clientY - pointer.y;
    if (Math.abs(dx) + Math.abs(dy) > 5) { draggedRef.current = true; setIsDragging(true); }
    if (!draggedRef.current) return;
    const next = { x: Math.max(8, Math.min(window.innerWidth - 74, pointer.left + dx)), y: Math.max(8, Math.min(window.innerHeight - 74, pointer.top + dy)) };
    setPosition(next);
    localStorage.setItem("hamyon_helper_position", JSON.stringify(next));
  };
  const onPointerUp = () => { pointerRef.current = null; setIsDragging(false); };
  const openHelper = () => {
    if (draggedRef.current) { draggedRef.current = false; return; }
    setOpen(true); setStepIndex(null); showHelperMessage(line);
  };
  const portrait = activeTour?.mood ?? (open ? messageMood : idleMood);
  const bubbleRight = position.x > window.innerWidth / 2;
  const bubbleAbove = position.y > window.innerHeight * 0.53;
  const bubbleLeft = Math.max(8, Math.min(window.innerWidth - 228, bubbleRight ? position.x - 164 : position.x));
  const bubbleTop = bubbleAbove ? Math.max(8, position.y - 64) : Math.min(window.innerHeight - 56, position.y + 59);
  const tourCardAtTop = Boolean(activeTour && spotlight && spotlight.top > viewportHeight * 0.52);
  return (
    <>
      {isRaging && <div className="fixed inset-0 z-[170] flex flex-col items-center justify-center overflow-hidden bg-rose-950/55 backdrop-blur-[2px] pointer-events-none" aria-live="assertive">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,rgba(251,113,133,.35),transparent_65%)]" />
        <div className="relative flex flex-col items-center" style={{ animation: "helperRageGrow .48s cubic-bezier(.16,1.2,.3,1) both" }}>
          <div className="relative flex items-center justify-center rounded-[2.5rem] border border-white/35 bg-white/10 p-5 shadow-[0_0_90px_rgba(251,113,133,.55)]" style={{ width: "min(84vw, 410px)", height: "min(72dvh, 430px)" }}>
            <WalletAvatar mood="😡" skin={helperSkin} className="h-[88%] w-[92%]" />
            <span className="absolute inset-0 rounded-[2.5rem] border-2 border-rose-300/70" style={{ animation: "rageRing .8s ease-in-out infinite alternate" }}/>
          </div>
          <div className="mt-5 rounded-2xl border border-rose-100/40 bg-rose-950/75 px-5 py-3 text-center text-white shadow-xl">
            <p className="text-xl font-black">{tr("Voy, bas qil!", "Hey, stop it!", "Ой, хватит!")}</p>
            <p className="mt-1 max-w-xs text-xs text-rose-100">{helperSkin === "helper_leaf" ? tr("Barglarim ham boshim aylanib ketdi!", "Even my leaves are spinning!", "Даже листья закружились!") : helperSkin === "helper_nebula" ? tr("Orbitamni buzib yubording!", "You've knocked me out of orbit!", "Ты сбил меня с орбиты!") : helperSkin === "helper_royal" ? tr("Qirollik yordamchisiga biroz sokinlik kerak!", "Even a royal helper needs a little calm!", "Даже королевскому помощнику нужна передышка!") : tr("Meni juda tez qimirlatib yubording!", "That was a lot of shaking!", "Ты меня слишком сильно раскачал!")}</p>
          </div>
        </div>
      </div>}
      {!activeTour && !isRaging && <div className="fixed z-30 flex flex-col items-end pointer-events-none" style={{ left: position.x, top: position.y }}>
        {!isDragging && !open && <div key={`${tab}-${line}`} className="fixed max-w-[220px] bg-card text-foreground border border-border rounded-2xl px-3.5 py-2.5 shadow-xl text-xs font-semibold leading-relaxed pointer-events-auto" style={{ left: bubbleLeft, top: bubbleTop, animation: "helperBubble .4s cubic-bezier(.2,.8,.2,1) both", borderBottomRightRadius: bubbleRight ? 16 : 5, borderBottomLeftRadius: bubbleRight ? 5 : 16 }}>{typedLine}<span className="animate-pulse">{typedLine.length < line.length ? "▍" : ""}</span></div>}
        <button onClick={openHelper} onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp} aria-label={c.helper} title={tr("Ushlab sudrab joyini o'zgartiring", "Drag to move", "Перетащите, чтобы переместить")} className="pointer-events-auto relative w-[62px] h-[52px] rounded-[17px] bg-transparent border-0 shadow-none select-none touch-none active:scale-95 transition-transform" style={{ transform: isDragging ? "rotate(12deg) translateY(5px) scale(.92)" : undefined, animation: isDragging ? "helperFall .42s ease-in-out infinite alternate" : "helperIdle 3s ease-in-out infinite" }}>
          <WalletAvatar mood={portrait} skin={helperSkin} className="block w-full h-full" />
        </button>
      </div>}
      {activeTour && spotlight && <div className="fixed z-[150] pointer-events-none rounded-3xl" style={{ left: spotlight.left - 8, top: spotlight.top - 8, width: spotlight.width + 16, height: spotlight.height + 16, boxShadow: "0 0 0 9999px rgba(8,15,10,.76)", border: "2px solid rgba(255,255,255,.92)", transition: "all .45s cubic-bezier(.2,.8,.2,1)" }} />}
      {(intro || open) && <div className={`fixed inset-0 z-[190] ${activeTour ? "bg-transparent" : "bg-black/55 backdrop-blur-sm"} flex ${activeTour && tourCardAtTop ? "items-start" : "items-end"} justify-center p-3 sm:p-4`} style={activeTour && tourCardAtTop ? { paddingTop: "max(.75rem, env(safe-area-inset-top))" } : undefined} onClick={intro ? undefined : closeHelper}>
        <div className={`relative w-full max-w-lg bg-card border border-border rounded-[2rem] p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] shadow-2xl flex flex-col ${activeTour ? "max-h-[36dvh]" : "max-h-[84dvh]"}`} onClick={(e) => e.stopPropagation()}>
          <CloseButton onClick={closeHelper} className="absolute right-3 top-3 z-10" />
          <div className="flex items-start gap-3 mb-3 pr-10 shrink-0"><WalletAvatar mood={portrait} skin={helperSkin} className="w-14 h-12 shrink-0" /><div className="flex-1"><div className="inline-flex items-center gap-1 text-primary text-xs font-bold mb-1"><Sparkles size={13} />{activeTour ? `${stepIndex! + 1} / ${tour.length}` : tr("Hamyon yordamchisi", "Wallet guide", "Помощник кошелька")}</div><h3 className="text-lg font-extrabold text-foreground leading-tight">{intro ? tr("Ilovani tanishtirib beraymi?", "Would you like a quick tour?", "Показать короткое знакомство?") : activeTour ? pick(activeTour.title) : c.helper}</h3></div></div>
          {(intro || activeTour) && <p className={`text-sm text-muted-foreground leading-relaxed ${intro ? "mb-5" : "mb-3"} shrink-0`}>{intro ? tr("Men ilova bo'limlarini bosqichma-bosqich ko'rsatib, ishlatishni tushuntiraman.", "I can walk you through each section and show you how to use it.", "Я пошагово покажу разделы и объясню, как ими пользоваться.") : typedLine}</p>}
          {intro ? <div className="space-y-2 shrink-0"><Btn onClick={startTour} className="w-full py-3.5 rounded-2xl bg-primary text-primary-foreground font-extrabold">{tr("Ha, tushuntirib ber", "Yes, show me", "Да, покажи")}</Btn><Btn onClick={finishIntro} className="w-full py-3 rounded-2xl bg-secondary text-foreground font-bold">{tr("Yo'q, men avval ishlatganman", "No, I have used it before", "Нет, я уже пользовался")}</Btn></div> : activeTour ? <div className="flex gap-2 shrink-0"><Btn onClick={() => moveTour(-1)} disabled={stepIndex === 0} className="px-4 py-3 rounded-2xl bg-secondary text-foreground font-bold disabled:opacity-40">{tr("Orqaga", "Back", "Назад")}</Btn><Btn onClick={() => moveTour(1)} className="flex-1 py-3 rounded-2xl bg-primary text-primary-foreground font-extrabold">{stepIndex === tour.length - 1 ? tr("Tugatish", "Finish", "Завершить") : tr("Keyingi", "Next", "Далее")}</Btn><Btn onClick={() => moveTour(1)} className="px-3 py-3 rounded-2xl text-muted-foreground text-xs">{tr("O'tkazish", "Skip", "Пропустить")}</Btn></div> : <><div className="min-h-0 flex-1 overflow-y-auto space-y-2 pr-1">{faq.map((item, index) => { const expanded = activeFaq === index; return <div key={index} className={`rounded-2xl border overflow-hidden transition-colors duration-200 ${expanded ? "border-primary/35 bg-primary/[0.035]" : "border-border bg-background/60 hover:border-primary/20"}`}><Btn sound="click" onClick={() => { const nextFaq = expanded ? null : index; setActiveFaq(nextFaq); if (nextFaq !== null) showHelperMessage(pick(item.a), item.mood ?? ["🤔", "😊", "🧐", "🥳"][index % 4]); }} className="w-full flex items-center justify-between gap-3 p-3.5 text-left"><span className="flex items-start gap-3"><span className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-lg text-[10px] font-extrabold transition-colors ${expanded ? "bg-primary text-primary-foreground" : "bg-secondary text-primary"}`}>{String(index + 1).padStart(2, "0")}</span><span className="text-sm font-bold text-foreground">{pick(item.q)}</span></span><ChevronDown size={17} className={`shrink-0 text-primary transition-transform duration-300 ${expanded ? "rotate-180" : ""}`} /></Btn><div className={`grid transition-[grid-template-rows,opacity] duration-300 ease-out ${expanded ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"}`}><div className="overflow-hidden"><p className="px-4 pb-4 pl-[3.6rem] text-xs leading-relaxed text-muted-foreground">{pick(item.a)}</p></div></div></div>; })}</div><Btn onClick={startTour} className="w-full mt-3 py-3.5 rounded-2xl bg-primary text-primary-foreground font-extrabold shrink-0">{tr("Vizual ko'rish", "Visual walkthrough", "Визуальный обзор")}</Btn></>}
          {activeTour && <p className="mt-3 text-center text-[11px] text-muted-foreground">{tr("Istalgan bosqichni o'tkazib yuborishingiz mumkin.", "You can skip ahead at any step.", "Можно пропустить любой этап.")}</p>}
        </div>
      </div>}
      <style>{`@keyframes helperBubble{from{opacity:0;transform:translateY(8px) scale(.96)}to{opacity:1;transform:none}}@keyframes helperFall{from{transform:rotate(8deg) translateY(4px) scale(.94)}to{transform:rotate(-8deg) translateY(8px) scale(.9)}}@keyframes helperIdle{0%,100%{translate:0 0}50%{translate:0 -3px}}@keyframes helperBlink{0%,44%,48%,100%{transform:scaleY(1)}46%{transform:scaleY(.12)}}@keyframes buttonPop{0%{scale:1}45%{scale:1.08}100%{scale:1}}@keyframes helperRageGrow{0%{opacity:0;transform:scale(.25) rotate(-8deg)}72%{transform:scale(1.04) rotate(2deg)}100%{opacity:1;transform:scale(1) rotate(0)}}@keyframes rageRing{from{transform:scale(.96);opacity:.45}to{transform:scale(1.035);opacity:1}}`}</style>
    </>
  );
}
function NavBar({ tab, onTab, language }: { tab: Tab; onTab: (t: Tab) => void; language: Language }) {
  const c = COPY[language];
  const items: { id: Tab; label: string; Icon: React.ComponentType<{ size?: number }> }[] = [
    { id: "home",     label: c.home,     Icon: Home },
    { id: "goals",    label: c.goals,    Icon: Target },
    { id: "market",   label: c.market,   Icon: Store },
    { id: "games",    label: c.games,    Icon: Gamepad2 },
    { id: "settings", label: c.settings, Icon: Settings },
  ];
  return (
    <div className="fixed bottom-0 inset-x-0 flex justify-center z-40 pointer-events-none">
      <div className="w-full max-w-sm pointer-events-auto">
        <div className="mx-4 bg-card border border-border rounded-2xl shadow-xl px-2 py-2 flex items-center" style={{ marginBottom: "max(1rem, env(safe-area-inset-bottom))" }}>
          {items.map(({ id, label, Icon }) => (
            <Btn key={id} sound="nav" onClick={() => onTab(id)}
              className={`flex-1 flex flex-col items-center gap-0.5 py-2 rounded-xl transition-colors ${tab === id ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}>
              <Icon size={18} />
          <span className="font-semibold truncate max-w-full" style={{ fontSize: "9px" }}>{label}</span>
            </Btn>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── Welcome Screen ───────────────────────────────────────────────────────────

function WelcomeScreen({ user, cosmetics, onDone }: { user: User; cosmetics: Partial<Record<CosmeticSlot, string>>; onDone: () => void }) {
  const [phase, setPhase] = useState<"in" | "hold" | "out">("in");
  useEffect(() => {
    const t1 = setTimeout(() => setPhase("hold"), 50);
    const t2 = setTimeout(() => setPhase("out"), 2200);
    const t3 = setTimeout(onDone, 2700);
    return () => { clearTimeout(t1); clearTimeout(t2); clearTimeout(t3); };
  }, [onDone]);
  const visible = phase === "hold";
  return (
    <div className="fixed inset-0 flex flex-col items-center justify-center bg-primary z-50"
      style={{ opacity: phase === "out" ? 0 : 1, transition: "opacity 0.5s ease" }}>
      <div style={{ opacity: visible ? 1 : 0, transform: visible ? "scale(1) translateY(0)" : "scale(0.6) translateY(20px)", transition: "opacity 0.5s ease, transform 0.5s cubic-bezier(0.34,1.56,0.64,1)" }} className="mb-6">
        <ProfileAvatar name={user.name} avatar={user.avatar} decoration={cosmetics.avatar} className="h-24 w-24 rounded-3xl bg-white/20" />
      </div>
      <div style={{ opacity: visible ? 1 : 0, transform: visible ? "translateY(0)" : "translateY(16px)", transition: "opacity 0.5s ease 0.1s, transform 0.5s ease 0.1s" }}
        className="text-center">
        <p className="text-white/70 text-lg mb-1">{tr("Xush kelibsiz,", "Welcome,", "Добро пожаловать,")}</p>
        <h1 className="text-white text-3xl font-bold"><DecoratedName name={user.name} decoration={cosmetics.name} />!</h1>
      </div>
      <div style={{ opacity: visible ? 0.4 : 0, transition: "opacity 0.5s ease 0.2s" }} className="mt-10">
        <img src="/wallet-logo.png" alt="HamyonUp" className="h-10 w-10 rounded-xl" />
      </div>
    </div>
  );
}

// ─── App ──────────────────────────────────────────────────────────────────────

export default function App() {
  const saved = loadData();

  const [splashDone, setSplashDone]             = useState(false);
  const [user, setUser]                         = useState<User | null>(saved?.user ?? null);
  const [showWelcome, setShowWelcome]           = useState(false);
  const [showVirtualDisclaimer, setShowVirtual] = useState(false);
  const [showHelperIntro, setShowHelperIntro] = useState(false);
  const [tab, setTab]                           = useState<Tab>("home");
  const [theme, setTheme]                       = useState<Theme>(saved?.theme ?? "light");
  const [currency, setCurrency] = useState<Currency>(saved?.currency ?? "UZS");
  const [currencyRates, setCurrencyRates] = useState<CurrencyRates>(() => cachedCurrencyRates());
  const priorStorageCurrency: Currency = saved?.moneyUnit === "UZS" ? "UZS" : saved?.currency ?? "UZS";
  const storedAmountToBase = (amount: number) => saved?.moneyUnit === "UZS" ? amount : toBaseMoney(amount, priorStorageCurrency, currencyRates);
  const [notifications, setNotif]               = useState(saved?.notifications ?? true);
  const [balance, setBalance]                   = useState(() => storedAmountToBase(saved?.balance ?? 0));
  const [expenses, setExpenses]                 = useState<Expense[]>(() => (saved?.expenses ?? []).map((item) => ({ ...item, amount: storedAmountToBase(item.amount) })));
  const [moneyEvents, setMoneyEvents] = useState<MoneyEvent[]>(() => (saved?.moneyEvents ?? []).map((item) => ({ ...item, amount: storedAmountToBase(item.amount) })));
  const [goals, setGoals]                       = useState<Goal[]>(() => (saved?.goals ?? []).map((item) => ({ ...item, target: storedAmountToBase(item.target), saved: storedAmountToBase(item.saved) })));
  const [ownedCosmetics, setOwnedCosmetics] = useState<string[]>(saved?.ownedCosmetics ?? []);
  const [equippedCosmetics, setEquippedCosmetics] = useState<Partial<Record<CosmeticSlot, string>>>(saved?.equippedCosmetics ?? {});
  const ownedCosmeticsRef = useRef(ownedCosmetics);
  ownedCosmeticsRef.current = ownedCosmetics;
  const [incomeEntryDate, setIncomeEntryDate] = useState(saved?.incomeEntryDate ?? localDayStr());
  const [incomeEntriesToday, setIncomeEntriesToday] = useState(() => saved?.incomeEntryDate === localDayStr() ? saved.incomeEntriesToday : 0);
  const [currentLocalDay, setCurrentLocalDay] = useState(localDayStr);
  const balanceRef = useRef(balance);
  balanceRef.current = balance;
  const incomeEntriesRef = useRef({ date: incomeEntryDate, count: incomeEntriesToday });
  incomeEntriesRef.current = { date: incomeEntryDate, count: incomeEntriesToday };
  const [totalEarned, setTotalEarned] = useState(() => storedAmountToBase(saved?.totalEarned ?? 0));
  const [totalSaved, setTotalSaved] = useState(() => saved?.totalSaved !== undefined
    ? storedAmountToBase(saved.totalSaved)
    : (saved?.goals ?? []).reduce((sum, goal) => sum + storedAmountToBase(goal.saved), 0));
  const [gameCoins, setGameCoins]               = useState(saved?.gameCoins ?? 0);
  const gameCoinsRef = useRef(gameCoins);
  gameCoinsRef.current = gameCoins;
  const [gameMusic, setGameMusic]               = useState(saved?.gameMusic ?? true);
  const [language, setLanguage]                  = useState<Language>(saved?.language ?? "uz");
  const [assistantEnabled, setAssistantEnabled]  = useState(saved?.assistantEnabled ?? true);
  const [sfxEnabled, setSfxEnabled]              = useState(saved?.sfxEnabled ?? true);
  ACTIVE_LANGUAGE = language;
  ACTIVE_CURRENCY = currency;

  useEffect(() => {
    let alive = true;
    void fetchCurrencyRates().then((rates) => { if (alive && rates) setCurrencyRates(rates); });
    return () => { alive = false; };
  }, []);

  const reminderPermissionPromptedRef = useRef(false);
  useEffect(() => {
    if (!user) return;
    if (!notifications) { void cancelAssistantReminders(); return; }
    let active = true;
    const shouldAskPermission = !reminderPermissionPromptedRef.current;
    void scheduleAssistantReminders(language, shouldAskPermission).then((scheduled) => {
      reminderPermissionPromptedRef.current = true;
      if (active && shouldAskPermission && !scheduled) setNotif(false);
    });
    return () => { active = false; };
  }, [user?.id, notifications, language]);

  const updateNotifications = useCallback(async (enabled: boolean) => {
    if (!enabled) {
      setNotif(false);
      void cancelAssistantReminders();
      return;
    }
    reminderPermissionPromptedRef.current = true;
    const scheduled = await scheduleAssistantReminders(language, true);
    if (!scheduled) {
      setNotif(false);
      toast.error(tr("Bildirishnoma ruxsati berilmadi. Uni qurilma sozlamalaridan yoqishingiz mumkin.", "Notification permission was not granted. You can enable it in device settings.", "Разрешение на уведомления не выдано. Его можно включить в настройках устройства."));
      return;
    }
    setNotif(true);
  }, [language]);

  useEffect(() => {
    const timer = window.setInterval(() => setCurrentLocalDay((day) => {
      const today = localDayStr();
      return day === today ? day : today;
    }), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  const changeCurrency = useCallback((nextCurrency: Currency) => setCurrency(nextCurrency), []);

  // Prevent pinch-zoom
  useEffect(() => {
    const noZoom = (e: TouchEvent) => { if (e.touches.length > 1) e.preventDefault(); };
    const noGesture = (e: Event) => e.preventDefault();
    document.addEventListener("touchmove", noZoom, { passive: false });
    document.addEventListener("gesturestart", noGesture);
    document.addEventListener("gesturechange", noGesture);
    let meta = document.querySelector("meta[name=viewport]") as HTMLMetaElement | null;
    if (!meta) { meta = document.createElement("meta"); meta.name = "viewport"; document.head.appendChild(meta); }
    meta.content = "width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover";
    return () => {
      document.removeEventListener("touchmove", noZoom);
      document.removeEventListener("gesturestart", noGesture);
      document.removeEventListener("gesturechange", noGesture);
    };
  }, []);

  // Android "Orqaga" tugmasi: boshqa tabda bo'lsa Asosiy tabga qaytadi, aks holda ilovadan chiqadi
  const tabRef = useRef<Tab>(tab);
  tabRef.current = tab;
  useEffect(() => {
    const onBack = (e: Event) => {
      if (tabRef.current !== "home") { e.preventDefault(); setTab("home"); }
    };
    window.addEventListener("hamyon:back", onBack);
    return () => window.removeEventListener("hamyon:back", onBack);
  }, []);

  // Persist app data
  useEffect(() => {
    saveData({ user, balance, expenses, moneyEvents, goals, ownedCosmetics, equippedCosmetics, incomeEntryDate: currentLocalDay, incomeEntriesToday: incomeEntryDate === currentLocalDay ? incomeEntriesToday : 0, totalEarned, totalSaved, theme, notifications, currency, gameCoins, gameMusic, language, assistantEnabled, sfxEnabled, moneyUnit: "UZS" });
  }, [user, balance, expenses, moneyEvents, goals, ownedCosmetics, equippedCosmetics, incomeEntryDate, incomeEntriesToday, currentLocalDay, totalEarned, totalSaved, theme, notifications, currency, gameCoins, gameMusic, language, assistantEnabled, sfxEnabled]);

  // Sync leaderboard whenever coins or user info changes
  useEffect(() => {
    if (user) {
      upsertLeaderboard({ id: user.id, name: user.name, coins: gameCoins, avatar: user.avatar, updatedAt: Date.now() });
    }
  }, [user, gameCoins]);

  // Apply theme classes
  useEffect(() => {
    const root = document.documentElement;
    root.classList.toggle("dark", theme === "dark" || theme === "midnight" || equippedCosmetics.theme === "theme_cosmos");
    root.classList.toggle("midnight", theme === "midnight");
    root.classList.toggle("orange", theme === "orange");
    root.classList.toggle("cosmetic-sakura", equippedCosmetics.theme === "theme_sakura");
    root.classList.toggle("cosmetic-ocean", equippedCosmetics.theme === "theme_ocean");
    root.classList.toggle("cosmetic-cosmos", equippedCosmetics.theme === "theme_cosmos");
    (Object.values(equippedCosmetics).filter(Boolean) as string[]).forEach((id) => {
      root.classList.toggle(`wearing-${id.replaceAll("_", "-")}`, true);
    });
    const equippedIds = new Set(Object.values(equippedCosmetics).filter(Boolean) as string[]);
    ["avatar_aurora", "avatar_bloom", "avatar_comet", "name_mint", "name_rose", "name_solar", "helper_leaf", "helper_nebula", "helper_royal"].forEach((id) => {
      root.classList.toggle(`wearing-${id.replaceAll("_", "-")}`, equippedIds.has(id));
    });
    root.lang = language;
  }, [theme, language, equippedCosmetics.theme, equippedCosmetics.avatar, equippedCosmetics.name, equippedCosmetics.helper]);

  useEffect(() => {
    _sfxEnabled = sfxEnabled;
  }, [sfxEnabled]);

  const handleRegister = useCallback((u: User) => {
    setUser(u);
    // Add to leaderboard immediately
    upsertLeaderboard({ id: u.id, name: u.name, coins: 0, avatar: u.avatar, updatedAt: Date.now() });
    const isFirstTime = !localStorage.getItem(VIRTUAL_DISCLAIMER_KEY);
    if (isFirstTime) {
      localStorage.setItem(VIRTUAL_DISCLAIMER_KEY, "1");
      setShowVirtual(true);
    } else {
      setShowWelcome(true);
    }
  }, []);

  const handleDisclaimerClose = useCallback(() => {
    setShowVirtual(false);
    setShowWelcome(true);
  }, []);

  const addExpense = useCallback((e: Omit<Expense, "id">) => {
    if (!Number.isFinite(e.amount) || e.amount <= 0 || e.amount > balanceRef.current) {
      toast.error(tr("Hisobingizda yetarlicha mablag' mavjud emas.", "You don't have enough funds in your balance.", "На балансе недостаточно средств."));
      return false;
    }
    balanceRef.current -= e.amount;
    setExpenses((prev) => [{ ...e, id: Date.now().toString() }, ...prev]);
    setBalance(balanceRef.current);
    return true;
  }, []);

  const addIncome = useCallback((amount: number) => {
    const today = localDayStr();
    const entriesToday = incomeEntriesRef.current.date === today ? incomeEntriesRef.current.count : 0;
    if (!Number.isFinite(amount) || amount <= 0) return false;
    if (entriesToday >= 3) {
      toast.error(tr("Bugungi mablag' kiritish limiti tugadi. Ertaga davom eting.", "Today's balance entry limit is reached. Continue tomorrow.", "Лимит добавления дохода на сегодня исчерпан. Продолжите завтра."));
      return false;
    }
    if (amount > 1_000_000_000_000_000_000 - balanceRef.current || amount > 1_000_000_000_000_000_000 - totalEarned) {
      toast.error(tr("Kiritilgan summa ruxsat etilgan balans chegarasidan oshib ketadi.", "This amount exceeds the supported balance limit.", "Сумма превышает допустимый предел баланса."));
      return false;
    }
    balanceRef.current += amount;
    incomeEntriesRef.current = { date: today, count: entriesToday + 1 };
    setBalance(balanceRef.current);
    setMoneyEvents((events) => [{ id: `earned_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`, date: today, amount, kind: "earned" }, ...events].slice(0, 5000));
    setTotalEarned((total) => total + amount);
    setIncomeEntryDate(today);
    setIncomeEntriesToday(entriesToday + 1);
    return true;
  }, [totalEarned]);

  const checkGoalComplete = useCallback((g: Goal) => {
    if (g.saved >= g.target && !g.achievedAt) {
      sfx.goalDone();
      if (notifications) {
        toast.success(tr(`🎉 Tabriklaymiz! "${g.title}" maqsadiga erishildi!`, `🎉 Congratulations! Goal “${g.title}” achieved!`, `🎉 Поздравляем! Цель «${g.title}» достигнута!`), {
          description: tr(`${formatMoney(fromBaseMoney(g.target, currency, currencyRates))} yig'ildi. Zo'r natija!`, `${formatMoney(fromBaseMoney(g.target, currency, currencyRates))} saved. Great result!`, `Накоплено ${formatMoney(fromBaseMoney(g.target, currency, currencyRates))}. Отличный результат!`),
          duration: 5000,
        });
      }
    }
  }, [notifications, currency, currencyRates]);

  const addGoal = useCallback((g: Omit<Goal, "id">) => {
    const isAchieved = g.saved >= g.target;
    const newGoal: Goal = {
      ...g, id: Date.now().toString(),
      achievedAt: isAchieved ? new Date().toISOString() : undefined,
    };
    setGoals((prev) => [...prev, newGoal]);
    if (isAchieved) checkGoalComplete(newGoal);
  }, [checkGoalComplete]);

  const editGoal = useCallback((id: string, g: Omit<Goal, "id">) => {
    const isAchieved = g.saved >= g.target;
    const updated: Goal = {
      ...g, id,
      achievedAt: isAchieved ? new Date().toISOString() : undefined,
    };
    setGoals((prev) => prev.map((x) => (x.id === id ? updated : x)));
    checkGoalComplete(updated);
  }, [checkGoalComplete]);

  const deleteGoal = useCallback((id: string) => {
    setGoals((prev) => prev.filter((x) => x.id !== id));
  }, []);

  const saveToGoal = useCallback((goalId: string, amount: number) => {
    if (!Number.isFinite(amount) || amount <= 0 || amount > balanceRef.current) {
      toast.error(tr("Hisobingizda yetarlicha mablag' mavjud emas.", "You don't have enough funds in your balance.", "На балансе недостаточно средств."));
      return false;
    }
    if (!goals.some((goal) => goal.id === goalId && !goal.achievedAt && goal.saved < goal.target)) return false;
    if (amount > 1_000_000_000_000_000_000 - totalSaved) return false;
    balanceRef.current -= amount;
    setBalance(balanceRef.current);
    setTotalSaved((total) => total + amount);
    const selectedGoal = goals.find((goal) => goal.id === goalId)!;
    const newSaved = selectedGoal.saved + amount;
    const isAchieved = newSaved >= selectedGoal.target;
    const updatedGoal: Goal = {
      ...selectedGoal, saved: newSaved,
      achievedAt: isAchieved && !selectedGoal.achievedAt ? new Date().toISOString() : selectedGoal.achievedAt,
    };
    setGoals((prev) => prev.map((goal) => goal.id === goalId ? updatedGoal : goal));
    setMoneyEvents((events) => [{ id: `saved_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`, date: localDayStr(), amount, kind: "saved", goalName: selectedGoal.title }, ...events].slice(0, 5000));
    checkGoalComplete(updatedGoal);
    return true;
  }, [goals, totalSaved, checkGoalComplete]);

  const handleCoinsEarned = useCallback((n: number) => {
    setGameCoins((c) => {
      const newCoins = c + n;
      gameCoinsRef.current = newCoins;
      if (user) upsertLeaderboard({ id: user.id, name: user.name, coins: newCoins, avatar: user.avatar, updatedAt: Date.now() });
      return newCoins;
    });
  }, [user]);

  const buyCosmetic = useCallback((id: string) => {
    const item = COSMETICS.find((candidate) => candidate.id === id);
    if (!item || ownedCosmeticsRef.current.includes(id)) return false;
    if (gameCoinsRef.current < item.price) {
      toast.error(tr("Bu bezak uchun tangangiz yetarli emas.", "You need more coins to buy this item.", "Недостаточно монет для покупки."));
      return false;
    }
    gameCoinsRef.current -= item.price;
    ownedCosmeticsRef.current = [...ownedCosmeticsRef.current, id];
    setGameCoins(gameCoinsRef.current);
    setOwnedCosmetics(ownedCosmeticsRef.current);
    toast.success(tr(`${item.title[0]} xarid qilindi.`, `${item.title[1]} purchased.`, `${item.title[2]} куплено.`));
    return true;
  }, []);

  const toggleCosmetic = useCallback((id: string) => {
    const item = COSMETICS.find((candidate) => candidate.id === id);
    if (!item || !ownedCosmetics.includes(id)) return;
    setEquippedCosmetics((current) => {
      const next = { ...current };
      if (next[item.slot] === id) delete next[item.slot];
      else next[item.slot] = id;
      return next;
    });
  }, [ownedCosmetics]);

  if (!splashDone) return <SplashScreen onDone={() => setSplashDone(true)} />;
  if (!user) return (
    <RegisterScreen onRegister={handleRegister} theme={theme} language={language} notifications={notifications}
      gameMusic={gameMusic} assistantEnabled={assistantEnabled} sfxEnabled={sfxEnabled} onTheme={setTheme} onLanguage={setLanguage}
      onNotifications={updateNotifications} onGameMusic={setGameMusic} onAssistant={setAssistantEnabled} onSfx={setSfxEnabled} />
  );

  const toasterTheme: "light" | "dark" = theme === "dark" || theme === "midnight" || equippedCosmetics.theme === "theme_cosmos" ? "dark" : "light";
  const visibleBalance = fromBaseMoney(balance, currency, currencyRates);
  const visibleExpenses = expenses.map((item) => ({ ...item, amount: fromBaseMoney(item.amount, currency, currencyRates) }));
  const visibleMoneyEvents = moneyEvents.map((item) => ({ ...item, amount: fromBaseMoney(item.amount, currency, currencyRates) }));
  const visibleGoals = goals.map((item) => ({ ...item,
    target: fromBaseMoney(item.target, currency, currencyRates),
    saved: fromBaseMoney(item.saved, currency, currencyRates),
  }));
  const addVisibleIncome = (amount: number) => addIncome(toBaseMoney(amount, currency, currencyRates));
  const addVisibleExpense = (item: Omit<Expense, "id">) => addExpense({ ...item, amount: toBaseMoney(item.amount, currency, currencyRates) });
  const saveVisibleToGoal = (goalId: string, amount: number) => saveToGoal(goalId, toBaseMoney(amount, currency, currencyRates));
  const entriesLeft = Math.max(0, 3 - (incomeEntryDate === currentLocalDay ? incomeEntriesToday : 0));
  const visibleTotalEarned = fromBaseMoney(totalEarned, currency, currencyRates);
  const visibleTotalSaved = fromBaseMoney(totalSaved, currency, currencyRates);
  const addVisibleGoal = (item: Omit<Goal, "id">) => addGoal({ ...item,
    target: toBaseMoney(item.target, currency, currencyRates), saved: toBaseMoney(item.saved, currency, currencyRates),
  });
  const editVisibleGoal = (id: string, item: Omit<Goal, "id">) => editGoal(id, { ...item,
    target: toBaseMoney(item.target, currency, currencyRates), saved: toBaseMoney(item.saved, currency, currencyRates),
  });

  return (
    <div className="min-h-screen bg-background flex justify-center" style={{ fontFamily: "Nunito, sans-serif" }}>
      <Toaster position="top-center" richColors theme={toasterTheme}
        toastOptions={{
          style: {
            background: "var(--card)",
            color: "var(--foreground)",
            border: "1px solid var(--border)",
            fontFamily: "Nunito, sans-serif",
          },
        }}
      />
      {showVirtualDisclaimer && <VirtualMoneyModal onClose={handleDisclaimerClose} />}
      {showWelcome && <WelcomeScreen user={user} cosmetics={equippedCosmetics} onDone={() => { setShowWelcome(false); if (!localStorage.getItem("hamyon_helper_intro_done")) setShowHelperIntro(true); }} />}
      <div className="w-full max-w-sm flex flex-col min-h-screen relative">
        {tab === "home" && (
          <HomeTab user={user} balance={visibleBalance} expenses={visibleExpenses} goals={visibleGoals} moneyEvents={visibleMoneyEvents} totalEarned={visibleTotalEarned} totalSaved={visibleTotalSaved} entriesLeft={entriesLeft} cosmetics={equippedCosmetics}
            onSetBalance={addVisibleIncome} onAddExpense={addVisibleExpense} onSaveToGoal={saveVisibleToGoal} />
        )}
        {tab === "goals" && (
          <GoalsTab goals={visibleGoals} onAdd={addVisibleGoal} onEdit={editVisibleGoal} onDelete={deleteGoal} />
        )}
        {tab === "market" && <MarketTab language={language} coins={gameCoins} owned={ownedCosmetics} equipped={equippedCosmetics} onBuy={buyCosmetic} onEquip={toggleCosmetic} />}
        {tab === "games" && (
          <GamesTab gameCoins={gameCoins} user={user} cosmetics={equippedCosmetics}
            onCoinsEarned={handleCoinsEarned}
            musicEnabled={gameMusic} />
        )}
        {tab === "settings" && (
          <SettingsTab
            user={user} theme={theme} language={language} currency={currency} notifications={notifications} gameMusic={gameMusic}
            assistantEnabled={assistantEnabled} sfxEnabled={sfxEnabled} cosmetics={equippedCosmetics}
            onEditUser={(u) => {
              setUser(u);
              if (u) upsertLeaderboard({ id: u.id, name: u.name, coins: gameCoins, avatar: u.avatar, updatedAt: Date.now() });
            }}
            onThemeChange={setTheme}
            onLanguageChange={setLanguage}
            onCurrencyChange={changeCurrency}
            onNotifChange={updateNotifications}
            onGameMusicChange={setGameMusic}
            onAssistantChange={setAssistantEnabled}
            onSfxChange={setSfxEnabled}
            onLogout={() => {
              musicSynth.pause();
              localStorage.removeItem(STORAGE_KEY);
              setUser(null); setBalance(0); setExpenses([]); setMoneyEvents([]); setGoals([]); setTotalEarned(0); setTotalSaved(0); setIncomeEntriesToday(0); setIncomeEntryDate(localDayStr()); balanceRef.current = 0; incomeEntriesRef.current = { date: localDayStr(), count: 0 };
              setOwnedCosmetics([]); ownedCosmeticsRef.current = []; setEquippedCosmetics({});
              setShowWelcome(false); setGameCoins(0); gameCoinsRef.current = 0;
            }}
          />
        )}
        {assistantEnabled && <Assistant tab={tab} user={user} language={language} helperSkin={equippedCosmetics.helper} introRequested={showHelperIntro} onIntroDone={() => setShowHelperIntro(false)} onTabChange={setTab} />}
        <NavBar tab={tab} onTab={setTab} language={language} />
      </div>
    </div>
  );
}
