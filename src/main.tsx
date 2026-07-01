import type DiceBoxType from '@3d-dice/dice-box-threejs'
import './index.css'

type Accent = 'violet' | 'cyan' | 'gold' | 'teal' | 'red'
type DetailValue = string | number | boolean | null | DetailValue[] | { [key: string]: DetailValue }

type ArchiveRecord = {
  id: string
  kind: string
  alias: string
  title: string
  subtitle: string
  details: string
  meta: string[]
  sourceUrl: string
  accent: Accent
  full?: Record<string, DetailValue> | null
  fullText?: string
}

type SeedPayload = {
  source: string
  generatedAt: string
  counts: Record<string, number>
  records: ArchiveRecord[]
}

type Character = {
  id: string
  name: string
  level: number
  ancestry: string
  className: string
  hp: number
  ac: number
  abilities: Record<'str' | 'dex' | 'con' | 'int' | 'wis' | 'cha', number>
  notes: string
}

type RollResult = {
  id: string
  notation: string
  rolls: number[]
  modifier: number
  total: number
  createdAt: string
}

type AppState = {
  seed: SeedPayload | null
  records: ArchiveRecord[]
  characters: Character[]
  selectedId: string
  selectedCharacterId: string
  query: string
  filter: string
  view: 'archive' | 'characters' | 'dice'
  favourites: string[]
  recent: string[]
  rolls: RollResult[]
  notes: string
  diceNotation: string
  rolling: boolean
  rollingDisplay: number
  rollingNotation: string
  rollVariant: number
  generatedProblem: string
  focusSearch: boolean
  toast: string
}

const app = document.querySelector<HTMLDivElement>('#app')
const SEED_PATH = import.meta.env.VITE_SEED_PATH || '/data/pathfinder-seed.json'

if (!app) {
  throw new Error('App root not found')
}

const STORAGE = {
  records: 'aisol-pathfinder-records-v1',
  characters: 'aisol-pathfinder-characters-v1',
  favourites: 'aisol-pathfinder-favourites-v1',
  recent: 'aisol-pathfinder-recent-v1',
  rolls: 'aisol-pathfinder-rolls-v1',
  notes: 'aisol-pathfinder-notes-v1',
}

const FILTERS: Record<string, string[]> = {
  all: [],
  rules: ['Класс', 'Народ', 'Навык', 'Черта', 'Трейт', 'Домен', 'Поддомен', 'Инквизиция', 'Архетип'],
  classes: ['Класс'],
  spells: ['Заклинание'],
  items: ['Волшебный предмет', 'Оружие', 'Броня', 'Снаряжение'],
  creatures: ['Существо'],
  generators: ['Существо', 'Заклинание', 'Волшебный предмет', 'Оружие', 'Броня', 'Снаряжение'],
}

const FILTER_LABELS: Record<string, string> = {
  all: 'Все',
  rules: 'Правила',
  classes: 'Классы',
  spells: 'Заклинания',
  items: 'Предметы',
  creatures: 'Существа',
  generators: 'Генераторы',
}

const KIND_ACCENTS: Record<string, Accent> = {
  Класс: 'gold',
  Народ: 'cyan',
  Навык: 'teal',
  Черта: 'violet',
  Заклинание: 'violet',
  'Волшебный предмет': 'gold',
  Оружие: 'gold',
  Броня: 'gold',
  Снаряжение: 'teal',
  Существо: 'cyan',
  Трейт: 'teal',
  Домен: 'violet',
  Поддомен: 'violet',
  Инквизиция: 'violet',
  Архетип: 'cyan',
  Персонаж: 'teal',
  Заметка: 'red',
}

const DEFAULT_CHARACTER: Character = {
  id: 'char-arventus',
  name: 'Арвентус',
  level: 12,
  ancestry: 'Человек',
  className: 'Мастер',
  hp: 88,
  ac: 24,
  abilities: {
    str: 12,
    dex: 16,
    con: 14,
    int: 18,
    wis: 15,
    cha: 13,
  },
  notes: 'Куратор архива и проводник по правилам кампании.',
}

const PROBLEM_SUBJECTS = [
  'странствующий торговец',
  'потерявшийся фамильяр',
  'молчаливый страж',
  'молодой алхимик',
  'запечатанный сундук',
  'дрожащий портал',
]

const PROBLEM_EVENTS = [
  'просит защитить караван до рассвета',
  'ведет к дому, где исчезли все свечи',
  'помнит только половину пароля от древней двери',
  'случайно выпустил крошечное, но очень злое существо',
  'каждый час меняет владельца по неизвестному правилу',
  'показывает одну и ту же комнату в разных эпохах',
]

const state: AppState = {
  seed: null,
  records: [],
  characters: [],
  selectedId: '',
  selectedCharacterId: '',
  query: '',
  filter: 'all',
  view: 'archive',
  favourites: [],
  recent: [],
  rolls: [],
  notes: '',
  diceNotation: '1d20',
  rolling: false,
  rollingDisplay: 19,
  rollingNotation: '1d20',
  rollVariant: 1,
  generatedProblem: '',
  focusSearch: false,
  toast: '',
}

let rollTimeout: number | null = null
type DiceBoxInstance = InstanceType<typeof DiceBoxType>

let diceBox: DiceBoxInstance | null = null
let diceBoxElement: HTMLElement | null = null
let diceBoxReady: Promise<DiceBoxInstance | null> | null = null
let diceRollToken = 0

function readStorage<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as T) : fallback
  } catch {
    return fallback
  }
}

function writeStorage(key: string, value: unknown) {
  localStorage.setItem(key, JSON.stringify(value))
}

function escapeHtml(value: unknown) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
}

function escapeAttr(value: unknown) {
  return escapeHtml(value).replace(/\n/g, '&#10;')
}

function plainText(value: unknown) {
  return String(value ?? '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<\/(p|div|li|tr|h[1-6])>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#039;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/[ \t\r\f\v]+/g, ' ')
    .replace(/\n\s+/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function compactText(value: unknown, max = 1400) {
  const text = plainText(value)
  return text.length > max ? `${text.slice(0, max - 1).trim()}...` : text
}

function uid(prefix: string) {
  if ('randomUUID' in crypto) {
    return `${prefix}-${crypto.randomUUID()}`
  }

  return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 10000)}`
}

function getCounts(records = state.records) {
  return records.reduce<Record<string, number>>((acc, item) => {
    acc[item.kind] = (acc[item.kind] || 0) + 1
    return acc
  }, {})
}

function byId(id: string) {
  return state.records.find((item) => item.id === id) || state.records[0]
}

function selectedRecord() {
  return byId(state.selectedId)
}

function currentCharacter() {
  return state.characters.find((item) => item.id === state.selectedCharacterId) || state.characters[0]
}

function normalizeQuery(value: string) {
  return value.trim().toLocaleLowerCase('ru')
}

function recordMatchesFilter(item: ArchiveRecord) {
  const allowed = FILTERS[state.filter] || []
  return allowed.length === 0 || allowed.includes(item.kind)
}

function recordMatchesSearch(item: ArchiveRecord) {
  const query = normalizeQuery(state.query)
  if (!query) return true

  const haystack = [item.title, item.kind, item.subtitle, item.details, item.fullText, ...item.meta]
    .join(' ')
    .toLocaleLowerCase('ru')

  return haystack.includes(query)
}

function filteredRecords(limit = 90) {
  return state.records.filter(recordMatchesFilter).filter(recordMatchesSearch).slice(0, limit)
}

function findRecordByTitle(part: string, kind?: string) {
  const query = part.toLocaleLowerCase('ru')
  return state.records.find((item) => {
    const sameKind = kind ? item.kind === kind : true
    return sameKind && item.title.toLocaleLowerCase('ru').includes(query)
  })
}

function remember(id: string) {
  state.recent = [id, ...state.recent.filter((item) => item !== id)].slice(0, 8)
  writeStorage(STORAGE.recent, state.recent)
}

function setSelected(id: string) {
  state.selectedId = id
  remember(id)
}

function saveRecords() {
  const seedById = new Map((state.seed?.records || []).map((item) => [item.id, item]))
  const edited = state.records
    .filter((item) => {
      const seed = seedById.get(item.id)
      return (
        !seed ||
        item.kind !== seed.kind ||
        item.title !== seed.title ||
        item.subtitle !== seed.subtitle ||
        item.details !== seed.details ||
        item.sourceUrl !== seed.sourceUrl ||
        item.accent !== seed.accent ||
        item.meta.join('\u0001') !== seed.meta.join('\u0001')
      )
    })
    .map((item) => ({
      id: item.id,
      kind: item.kind,
      alias: item.alias,
      title: item.title,
      subtitle: item.subtitle,
      details: item.details,
      meta: item.meta,
      sourceUrl: item.sourceUrl,
      accent: item.accent,
      full: item.full || null,
      fullText: item.fullText || '',
    }))

  writeStorage(STORAGE.records, edited)
}

function mergeRecordEdits(seedRecords: ArchiveRecord[], edits: ArchiveRecord[] | null) {
  if (!edits?.length) return seedRecords

  const merged = new Map(seedRecords.map((item) => [item.id, item]))
  edits.forEach((edit) => {
    const seed = merged.get(edit.id)
    merged.set(edit.id, seed ? { ...seed, ...edit, full: edit.full || seed.full, fullText: edit.fullText || seed.fullText } : edit)
  })

  return Array.from(merged.values())
}

function saveCharacters() {
  writeStorage(STORAGE.characters, state.characters)
}

function setToast(message: string) {
  state.toast = message
  window.setTimeout(() => {
    if (state.toast === message) {
      state.toast = ''
      render()
    }
  }, 1800)
}

function accentFor(kind: string): Accent {
  return KIND_ACCENTS[kind] || 'violet'
}

function pluralItems(value: number, one: string, two: string, five: string) {
  const mod10 = value % 10
  const mod100 = value % 100
  if (mod10 === 1 && mod100 !== 11) return one
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return two
  return five
}

function randomInt(max: number) {
  const buffer = new Uint32Array(1)
  crypto.getRandomValues(buffer)
  return (buffer[0] % max) + 1
}

function rollNotation(notation: string): RollResult | null {
  const normalized = notation.replace(/\s+/g, '').toLowerCase()
  const match = normalized.match(/^(\d*)d(\d+)([+-]\d+)?$/)

  if (!match) return null

  const count = Math.min(Number(match[1] || 1), 100)
  const sides = Number(match[2])
  const modifier = Number(match[3] || 0)

  if (!Number.isFinite(count) || !Number.isFinite(sides) || !Number.isFinite(modifier) || count < 1 || sides < 2 || sides > 1000) {
    return null
  }

  const rolls = Array.from({ length: count }, () => randomInt(sides))
  const total = rolls.reduce((sum, item) => sum + item, 0) + modifier

  return {
    id: uid('roll'),
    notation: normalized,
    rolls,
    modifier,
    total,
    createdAt: new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }),
  }
}

function physicsNotation(notation: string, result: RollResult) {
  const match = notation.match(/^(\d*)d(\d+)([+-]\d+)?$/)
  if (!match) return null

  const count = Math.min(Number(match[1] || 1), 100)
  const sides = Number(match[2])
  const modifier = Number(match[3] || 0)
  const supported = new Set([2, 4, 6, 8, 10, 12, 20, 100])

  if (!supported.has(sides) || count > 24) return null

  const mod = modifier ? `${modifier > 0 ? '+' : ''}${modifier}` : ''
  return `${count}d${sides}${mod}@${result.rolls.join(',')}`
}

async function ensureDiceBox() {
  const element = document.querySelector<HTMLElement>('#physicsDiceBox')
  if (!element) return null
  if (diceBox && diceBoxElement === element) return diceBox
  if (diceBoxReady && diceBoxElement === element) return diceBoxReady

  element.innerHTML = ''
  diceBoxElement = element

  diceBoxReady = import('@3d-dice/dice-box-threejs')
    .then(({ default: DiceBox }) => {
      diceBox = new DiceBox('#physicsDiceBox', {
        assetPath: '/assets/dice-box-threejs/',
        sounds: true,
        volume: 44,
        shadows: true,
        theme_surface: 'green-felt',
        theme_colorset: 'white',
        theme_material: 'glass',
        gravity_multiplier: 430,
        light_intensity: 0.92,
        baseScale: 82,
        strength: 1.65,
      })

      return diceBox.init ? diceBox.init() : diceBox.initialize()
    })
    .then(() => {
      element.classList.add('ready')
      element.closest('.dice-tray')?.classList.add('physics-ready')
      return diceBox
    })
    .catch((error) => {
      element.classList.add('failed')
      element.closest('.dice-tray')?.classList.add('physics-failed')
      console.warn('Dice engine failed', error)
      return null
    })

  return diceBoxReady
}

function renderRollHistoryRow(roll: RollResult) {
  return `
    <div>
      <strong>${roll.total}</strong>
      <span>${escapeHtml(roll.notation)} · ${escapeHtml(roll.createdAt)}</span>
    </div>
  `
}

function patchDiceDomAfterRoll(result: RollResult) {
  if (state.view !== 'dice') return false

  const tray = document.querySelector('.dice-tray')
  const readout = document.querySelector('.roll-readout')
  const history = document.querySelector('.roll-history')
  const historyCount = document.querySelector('.history-panel .section-heading b')
  const sectionNotation = document.querySelector('.dice-stage .section-heading b')
  const miniDie = document.querySelector('.die-visual')
  const miniTotal = document.querySelector('.die-visual strong')

  if (!tray || !readout || !history || !historyCount) return false

  tray.classList.remove('rolling', 'throw-1', 'throw-2', 'throw-3', 'throw-4')
  readout.innerHTML = `
    <span>${escapeHtml(result.notation)}</span>
    <strong>${result.total}</strong>
    <small>Броски: ${result.rolls.join(', ')}${result.modifier ? `; модификатор ${result.modifier}` : ''}</small>
  `
  history.insertAdjacentHTML('afterbegin', renderRollHistoryRow(result))
  historyCount.textContent = String(state.rolls.length)
  if (sectionNotation) sectionNotation.textContent = result.notation
  if (miniTotal) miniTotal.textContent = String(result.total)
  miniDie?.classList.remove('rolling')

  return true
}

function completeRoll(result: RollResult, token: number, preserveDice = false) {
  if (token !== diceRollToken) return
  rollTimeout = null
  state.rolling = false
  state.rollingDisplay = result.total
  state.rolls = [result, ...state.rolls].slice(0, 14)
  writeStorage(STORAGE.rolls, state.rolls)
  if (!preserveDice || !patchDiceDomAfterRoll(result)) render()
}

async function addRoll(notation: string) {
  const normalized = notation.replace(/\s+/g, '').toLowerCase()
  const match = normalized.match(/^(\d*)d(\d+)([+-]\d+)?$/)

  if (!match) {
    setToast('Формула кубика не распознана')
    return
  }

  const count = Math.min(Number(match[1] || 1), 100)
  const sides = Number(match[2])
  const modifier = Number(match[3] || 0)

  if (!Number.isFinite(count) || !Number.isFinite(sides) || !Number.isFinite(modifier) || count < 1 || sides < 2 || sides > 1000) {
    setToast('Формула кубика не распознана')
    return
  }

  if (rollTimeout) window.clearTimeout(rollTimeout)

  const result = rollNotation(normalized)
  if (!result) {
    setToast('Формула кубика не распознана')
    return
  }

  state.diceNotation = normalized
  state.rolling = true
  state.rollingNotation = normalized
  state.rollingDisplay = result.total
  state.rollVariant = randomInt(4)
  const token = ++diceRollToken
  render()

  const engineNotation = physicsNotation(normalized, result)
  const engine = engineNotation ? await ensureDiceBox() : null
  if (engine && token === diceRollToken) {
    try {
      await engine.roll(engineNotation)
      completeRoll(result, token, true)
      return
    } catch (error) {
      console.warn('Physics dice roll failed, using fallback', error)
    }
  }

  rollTimeout = window.setTimeout(() => {
    completeRoll(result, token)
  }, 1720)
}

function generateProblem() {
  const subject = PROBLEM_SUBJECTS[randomInt(PROBLEM_SUBJECTS.length) - 1]
  const event = PROBLEM_EVENTS[randomInt(PROBLEM_EVENTS.length) - 1]
  state.generatedProblem = `${subject[0].toLocaleUpperCase('ru')}${subject.slice(1)} ${event}.`
}

function pickRandom(kind: string) {
  const pool = state.records.filter((item) => item.kind === kind)
  if (pool.length === 0) return
  state.view = 'archive'
  state.filter = kind === 'Существо' ? 'creatures' : kind === 'Заклинание' ? 'spells' : 'all'
  setSelected(pool[randomInt(pool.length) - 1].id)
  render()
}

function shortMeta(item: ArchiveRecord) {
  return item.meta.filter(Boolean).slice(0, 2).join(' · ')
}

function diceSidesLabel(notation: string) {
  const match = notation.match(/d(\d+)/i)
  return match ? `d${match[1]}` : notation
}

function renderLogo() {
  return `
    <button class="logo-block" type="button" data-view="archive" data-filter="all" aria-label="Aisol Pathfinder">
      <span class="logo-mark" aria-hidden="true"><span></span></span>
      <span class="logo-copy">
        <strong>Aisol</strong>
        <span>Pathfinder</span>
      </span>
    </button>
  `
}

function renderTopbar() {
  return `
    <header class="topbar">
      ${renderLogo()}
      <label class="command-search" for="globalSearch">
        <span aria-hidden="true">⌕</span>
        <input id="globalSearch" type="search" value="${escapeAttr(state.query)}" placeholder="Найти заклинание, класс, черту, предмет, существо..." autocomplete="off" />
      </label>
      <div class="top-actions">
        <button class="icon-button" type="button" data-action="theme" title="Ночной режим">☾</button>
        <button class="icon-button" type="button" data-action="new-record" title="Новая запись">＋</button>
        <button class="profile-chip" type="button" data-view="characters">
          <span class="avatar" aria-hidden="true"></span>
          <span>
            <strong>${escapeHtml(currentCharacter()?.name || 'Персонаж')}</strong>
            <small>${escapeHtml(currentCharacter()?.className || 'Мастер')}</small>
          </span>
          <b>${escapeHtml(currentCharacter()?.level || 1)}</b>
        </button>
      </div>
    </header>
  `
}

function renderSidebar() {
  const items = [
    ['archive', 'all', 'Архив', '▣'],
    ['characters', '', 'Персонажи', '♙'],
    ['archive', 'spells', 'Заклинания', '✦'],
    ['archive', 'items', 'Снаряжение', '⚔'],
    ['archive', 'creatures', 'Бестиарий', '♜'],
    ['dice', '', 'Генераторы', '◇'],
    ['archive', 'favourites', 'Избранное', '☆'],
    ['characters', '', 'Аккаунт', '○'],
  ] as const

  const lastRoll = state.rolls[0]
  const result = state.rolling ? state.rollingDisplay : lastRoll?.total ?? 19

  return `
    <aside class="left-rail">
      <nav class="side-nav" aria-label="Главное меню">
        ${items
          .map(([view, filter, label, icon]) => {
            const isFavouriteFilter = filter === 'favourites'
            const active =
              state.view === view &&
              (isFavouriteFilter ? state.filter === 'favourites' : !filter || state.filter === filter)
            return `
              <button class="side-link ${active ? 'active' : ''}" type="button" data-view="${view}" ${filter ? `data-filter="${filter}"` : ''}>
                <span aria-hidden="true">${icon}</span>
                <b>${label}</b>
              </button>
            `
          })
          .join('')}
      </nav>

      <section class="dice-mini panel-cut">
        <div class="panel-title">
          <span>Бросок кубиков</span>
          <button type="button" data-roll="${state.diceNotation}" title="Повторить">↻</button>
        </div>
        <button class="die-visual ${state.rolling ? 'rolling' : ''}" type="button" data-view="dice" aria-label="Открыть кубики">
          <span>d20</span>
          <strong>${result}</strong>
        </button>
        <div class="dice-row">
          ${[4, 6, 8, 10, 12, 20].map((side) => `<button type="button" data-roll="1d${side}">d${side}</button>`).join('')}
        </div>
      </section>
    </aside>
  `
}

function renderTabs() {
  return `
    <nav class="top-tabs" aria-label="Разделы архива">
      ${Object.entries(FILTER_LABELS)
        .map(
          ([key, label]) => `
            <button class="${state.filter === key ? 'active' : ''}" type="button" data-view="${key === 'generators' ? 'dice' : 'archive'}" data-filter="${key}">
              ${label}
            </button>
          `,
        )
        .join('')}
    </nav>
  `
}

function renderHero() {
  const counts = getCounts()
  const total = state.records.length

  return `
    <section class="hero-panel panel-cut">
      <div class="hero-art" aria-hidden="true">
        <span class="sigil sigil-one"></span>
        <span class="sigil sigil-two"></span>
        <span class="tower"></span>
      </div>
      <div class="hero-copy">
        <h1>Aisol Pathfinder</h1>
        <p>Классы, народы, навыки, черты, заклинания, волшебные предметы, существа и генераторы в одном интерфейсе.</p>
        <div class="hero-actions">
          <button class="neon-button" type="button" data-view="characters">Начать создание персонажа</button>
          <button class="ghost-button" type="button" data-action="new-record">Добавить запись</button>
        </div>
      </div>
      <dl class="hero-stats">
        <div><dt>${total}</dt><dd>записей</dd></div>
        <div><dt>${counts['Заклинание'] || 0}</dt><dd>заклинаний</dd></div>
        <div><dt>${counts['Существо'] || 0}</dt><dd>существ</dd></div>
      </dl>
    </section>
  `
}

function renderArchiveCards() {
  const counts = getCounts()
  const cards = [
    {
      title: 'Создание персонажа',
      value: `${state.characters.length} ${pluralItems(state.characters.length, 'лист', 'листа', 'листов')}`,
      accent: 'cyan',
      action: 'characters',
      art: 'character',
    },
    { title: 'Классы', value: `${counts['Класс'] || 0} класса`, accent: 'gold', filter: 'classes', art: 'class' },
    { title: 'Черты', value: `${counts['Черта'] || 0} черт`, accent: 'teal', filter: 'rules', art: 'feat' },
    { title: 'Заклинания', value: `${counts['Заклинание'] || 0} заклинаний`, accent: 'violet', filter: 'spells', art: 'spell' },
    {
      title: 'Снаряжение',
      value: `${(counts['Волшебный предмет'] || 0) + (counts['Оружие'] || 0) + (counts['Броня'] || 0) + (counts['Снаряжение'] || 0)} предмет`,
      accent: 'gold',
      filter: 'items',
      art: 'item',
    },
    { title: 'Народы', value: `${counts['Народ'] || 0} народов`, accent: 'teal', filter: 'rules', art: 'race' },
    { title: 'Существа', value: `${counts['Существо'] || 0} существ`, accent: 'cyan', filter: 'creatures', art: 'creature' },
    { title: 'Генераторы', value: `${state.rolls.length || 12} инструментов`, accent: 'violet', action: 'dice', art: 'generator' },
  ]

  return `
    <section class="archive-grid">
      ${cards
        .map(
          (card) => `
            <button class="archive-card ${card.accent}" type="button" ${card.filter ? `data-view="archive" data-filter="${card.filter}"` : `data-view="${card.action}"`} data-art="${card.art}">
              <span class="card-visual" aria-hidden="true"></span>
              <strong>${card.title}</strong>
              <small>${card.value}</small>
            </button>
          `,
        )
        .join('')}
    </section>
  `
}

function renderRecordRow(item: ArchiveRecord, compact = false) {
  const favourite = state.favourites.includes(item.id)
  return `
    <button class="record-row ${state.selectedId === item.id ? 'active' : ''}" type="button" data-select="${escapeAttr(item.id)}">
      <span class="record-icon ${escapeAttr(item.accent || accentFor(item.kind))}" aria-hidden="true">${kindGlyph(item.kind)}</span>
      <span class="record-text">
        <strong>${escapeHtml(item.title)}</strong>
        <small>${escapeHtml(compact ? item.subtitle : `${item.kind}${item.subtitle ? ` · ${item.subtitle}` : ''}`)}</small>
      </span>
      <span class="row-star ${favourite ? 'on' : ''}" data-favorite="${escapeAttr(item.id)}" title="Избранное">☆</span>
    </button>
  `
}

function renderListPanels() {
  const popular = [
    findRecordByTitle('Огненный шар', 'Заклинание'),
    findRecordByTitle('Скрытая атака', 'Черта'),
    findRecordByTitle('Воровской', 'Класс') || findRecordByTitle('Плут', 'Класс'),
    findRecordByTitle('Длинный меч') || findRecordByTitle('Кольцо'),
    findRecordByTitle('Дракон', 'Существо'),
  ].filter(Boolean) as ArchiveRecord[]

  const recent = state.recent.map(byId).filter(Boolean).slice(0, 5)
  const newItems = state.records.slice(20, 25)

  const panels = [
    ['Популярное', popular],
    ['Новое в архиве', newItems],
    ['Недавние просмотры', recent.length ? recent : filteredRecords(5)],
  ] as const

  return `
    <section class="list-panels">
      ${panels
        .map(
          ([title, items]) => `
            <div class="list-panel panel-cut">
              <h2>${title}</h2>
              <div class="rows">
                ${items.map((item) => renderRecordRow(item, true)).join('')}
              </div>
            </div>
          `,
        )
        .join('')}
    </section>
  `
}

function renderArchiveBrowser() {
  const rows = state.filter === 'favourites' ? state.records.filter((item) => state.favourites.includes(item.id)) : filteredRecords()
  const selected = selectedRecord()

  return `
    <section class="browser-panel panel-cut">
      <div class="browser-list">
        <div class="section-heading">
          <span>${state.filter === 'favourites' ? 'Избранное' : FILTER_LABELS[state.filter] || 'Архив'}</span>
          <b>${rows.length}</b>
        </div>
        <div class="rows scroll-area">
          ${rows.length ? rows.map((item) => renderRecordRow(item)).join('') : '<p class="empty">Записей не найдено.</p>'}
        </div>
      </div>
      ${selected ? renderRecordEditor(selected) : ''}
    </section>
  `
}

function renderRecordEditor(item: ArchiveRecord) {
  return `
    <form class="editor-panel" id="recordForm">
      <input type="hidden" name="id" value="${escapeAttr(item.id)}" />
      <div class="section-heading">
        <span>Запись архива</span>
        <button class="tiny-button" type="button" data-action="new-record">Новая</button>
      </div>
      <label>
        <span>Категория</span>
        <select name="kind">
          ${['Класс', 'Народ', 'Навык', 'Черта', 'Трейт', 'Заклинание', 'Волшебный предмет', 'Оружие', 'Броня', 'Снаряжение', 'Существо', 'Домен', 'Поддомен', 'Инквизиция', 'Архетип', 'Домашнее правило']
            .map((kind) => `<option value="${kind}" ${item.kind === kind ? 'selected' : ''}>${kind}</option>`)
            .join('')}
        </select>
      </label>
      <label>
        <span>Название</span>
        <input name="title" value="${escapeAttr(item.title)}" required />
      </label>
      <label>
        <span>Подзаголовок</span>
        <input name="subtitle" value="${escapeAttr(item.subtitle)}" />
      </label>
      <label>
        <span>Описание</span>
        <textarea name="details" rows="8">${escapeHtml(item.details)}</textarea>
      </label>
      <label>
        <span>Метки</span>
        <input name="meta" value="${escapeAttr(item.meta.join(', '))}" />
      </label>
      <div class="editor-actions">
        <button class="neon-button" type="submit">Сохранить</button>
        <button class="ghost-button" type="button" data-favorite="${escapeAttr(item.id)}">${state.favourites.includes(item.id) ? 'Убрать из избранного' : 'В избранное'}</button>
      </div>
      <p class="source-line">Источник: ${escapeHtml(item.sourceUrl || 'локальная запись')}</p>
      ${renderFullInfo(item)}
    </form>
  `
}

const DETAIL_LABELS: Record<string, string> = {
  engName: 'Оригинальное название',
  description: 'Описание',
  fullDescription: 'Полное описание',
  role: 'Роль',
  alignment: 'Мировоззрение',
  hitDie: 'Кость здоровья',
  startingWealth: 'Начальное богатство',
  skillRanksPerLevel: 'Навыки за уровень',
  tableFeatures: 'Таблица способностей',
  tableSpellCount: 'Таблица заклинаний',
  features: 'Способности',
  skills: 'Навыки',
  baseRaceTraits: 'Базовые особенности народа',
  alterRaceTraits: 'Альтернативные особенности',
  favoredClass: 'Избранный класс',
  adventurerClass: 'Классы авантюристов',
  physicalDescription: 'Внешность',
  society: 'Общество',
  relations: 'Отношения',
  alignmentAndReligion: 'Мировоззрение и религия',
  adventurers: 'Авантюристы',
  namesDescription: 'Имена',
  castingTime: 'Время сотворения',
  components: 'Компоненты',
  range: 'Дистанция',
  target: 'Цель',
  area: 'Область',
  effect: 'Эффект',
  duration: 'Длительность',
  savingThrow: 'Испытание',
  spellResistance: 'Устойчивость к магии',
  subSchool: 'Подшкола',
  school: 'Школа',
  schools: 'Школы',
  classes: 'Классы',
  races: 'Народы',
  requirements: 'Требования',
  prerequisites: 'Предпосылки',
  benefit: 'Преимущество',
  normal: 'Обычно',
  special: 'Особое',
  types: 'Типы',
  aura: 'Аура',
  cl: 'Уровень заклинателя',
  price: 'Цена',
  weight: 'Вес',
  constructionRequirements: 'Требования создания',
  constructionCost: 'Стоимость создания',
  statistics: 'Параметры',
  destruction: 'Уничтожение',
  cr: 'КР',
  exp: 'Опыт',
  fullCreatureType: 'Тип существа',
  initiative: 'Инициатива',
  senses: 'Чувства',
  perception: 'Внимание',
  acDescription: 'КБ',
  hitPoints: 'HP',
  hitPointsDescription: 'Кость HP',
  fortitude: 'Стойкость',
  reflex: 'Реакция',
  will: 'Воля',
  defensiveAbilities: 'Защитные способности',
  immune: 'Иммунитет',
  resist: 'Сопротивления',
  weaknesses: 'Слабости',
  speed: 'Скорость',
  meleeAttacks: 'Ближний бой',
  rangedAttacks: 'Дальний бой',
  specialAttacks: 'Особые атаки',
  spellLikeAbilities: 'Псевдозаклинания',
  spellsPrepared: 'Подготовленные заклинания',
  spellsKnown: 'Известные заклинания',
  strength: 'СИЛ',
  dexterity: 'ЛВК',
  constitution: 'ТЕЛ',
  intelligence: 'ИНТ',
  wisdom: 'МДР',
  charisma: 'ХАР',
  baseAttack: 'БМА',
  cmb: 'БМ',
  cmd: 'ЗМ',
  feats: 'Черты',
  languages: 'Языки',
  environment: 'Среда',
  organization: 'Организация',
  treasure: 'Сокровища',
  specialAbilities: 'Особые способности',
  cost: 'Цена',
  damageS: 'Урон S',
  damageM: 'Урон M',
  criticalRoll: 'Критический диапазон',
  criticalDamage: 'Критический множитель',
  misfire: 'Осечка',
  capacity: 'Емкость',
  proficientCategory: 'Категория владения',
  rangeCategory: 'Дистанция оружия',
  encumbranceCategory: 'Габарит',
  armorBonus: 'Бонус брони',
  maxDexBonus: 'Макс. ЛВК',
  armorCheckPenalty: 'Штраф за доспех',
  arcaneSpellFailureChance: 'Провал мистического заклинания',
  speed30: 'Скорость 30',
  speed20: 'Скорость 20',
  equipmentSubType: 'Подтип снаряжения',
  craftDc: 'СЛ изготовления',
  power0Name: 'Сила 0',
  power0Description: 'Описание силы 0',
  power1Name: 'Сила 1',
  power1Description: 'Описание силы 1',
  power2Name: 'Сила 2',
  power2Description: 'Описание силы 2',
  gods: 'Божества',
  archetypeFeatures: 'Особенности архетипа',
  infoLinks: 'Связанная информация',
  book: 'Источник',
  parentClass: 'Родительский класс',
  prestigeClasses: 'Престиж-классы',
  ability: 'Характеристика',
  acNatural: 'Естественная броня',
  acArmor: 'Броня',
  acShield: 'Щит',
  acDodge: 'Уклонение',
  acDeflection: 'Отражение',
  acInsight: 'Интуиция',
  acRage: 'Ярость',
  acWisdom: 'Мудрость к КБ',
  acProfane: 'Нечестивый бонус к КБ',
  acMonk: 'Монах к КБ',
  maxAcDexterity: 'Макс. ЛВК к КБ',
  combatManeuverBonus: 'БМ',
  combatManeuverDefense: 'ЗМ',
  combatManeuverDefenseComment: 'Комментарий ЗМ',
}

const DETAIL_ORDER = [
  'engName',
  'book',
  'description',
  'fullDescription',
  'role',
  'fullCreatureType',
  'cr',
  'exp',
  'initiative',
  'senses',
  'perception',
  'aura',
  'acDescription',
  'acNatural',
  'acArmor',
  'acShield',
  'acDodge',
  'acDeflection',
  'hitPoints',
  'hitPointsDescription',
  'fortitude',
  'reflex',
  'will',
  'defensiveAbilities',
  'immune',
  'resist',
  'weaknesses',
  'speed',
  'meleeAttacks',
  'rangedAttacks',
  'specialAttacks',
  'spellLikeAbilities',
  'spellsPrepared',
  'spellsKnown',
  'strength',
  'dexterity',
  'constitution',
  'intelligence',
  'wisdom',
  'charisma',
  'baseAttack',
  'cmb',
  'cmd',
  'combatManeuverBonus',
  'combatManeuverDefense',
  'feats',
  'skills',
  'languages',
  'environment',
  'organization',
  'treasure',
  'specialAbilities',
  'physicalDescription',
  'society',
  'relations',
  'alignmentAndReligion',
  'adventurers',
  'baseRaceTraits',
  'alterRaceTraits',
  'favoredClass',
  'castingTime',
  'components',
  'school',
  'subSchool',
  'classes',
  'range',
  'target',
  'area',
  'effect',
  'duration',
  'savingThrow',
  'spellResistance',
  'requirements',
  'prerequisites',
  'benefit',
  'normal',
  'special',
  'types',
  'aura',
  'cl',
  'price',
  'cost',
  'weight',
  'damageS',
  'damageM',
  'criticalRoll',
  'criticalDamage',
  'range',
  'misfire',
  'capacity',
  'special',
  'armorBonus',
  'maxDexBonus',
  'armorCheckPenalty',
  'arcaneSpellFailureChance',
  'speed30',
  'speed20',
  'constructionRequirements',
  'constructionCost',
  'statistics',
  'destruction',
  'power0Name',
  'power0Description',
  'power1Name',
  'power1Description',
  'power2Name',
  'power2Description',
  'gods',
  'archetypeFeatures',
  'tableFeatures',
  'tableSpellCount',
  'features',
  'infoLinks',
]

function detailLabel(key: string) {
  return DETAIL_LABELS[key] || key.replace(/([A-Z])/g, ' $1').replace(/^./, (letter) => letter.toLocaleUpperCase('ru'))
}

function isEmptyDetail(value: DetailValue | undefined) {
  if (value == null || value === '') return true
  if (Array.isArray(value)) return value.length === 0
  if (typeof value === 'object') return Object.keys(value).length === 0
  return false
}

function detailValueText(value: DetailValue, depth = 0): string {
  if (value == null) return ''
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return compactText(value, depth > 1 ? 900 : 4000)
  if (Array.isArray(value)) {
    return value
      .map((item) => detailValueText(item, depth + 1))
      .filter(Boolean)
      .join('\n')
  }

  const named = value as Record<string, DetailValue>
  if (named.name && Object.keys(named).length <= 5) {
    const extra = [named.level != null && `${named.level}`, named.abbreviation, named.alias].filter(Boolean).join(' · ')
    return `${detailValueText(named.name, depth + 1)}${extra ? ` (${extra})` : ''}`
  }

  return Object.entries(named)
    .filter(([key, inner]) => !['id', 'alias', 'helpers', 'childs'].includes(key) && !isEmptyDetail(inner))
    .map(([key, inner]) => `${detailLabel(key)}: ${detailValueText(inner, depth + 1)}`)
    .join('\n')
}

function renderDetailValue(value: DetailValue) {
  const text = detailValueText(value)
  if (!text) return ''

  return text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 24)
    .map((line) => `<p>${escapeHtml(line)}</p>`)
    .join('')
}

function numberDetail(full: Record<string, DetailValue>, key: string) {
  const value = full[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function signed(value: number) {
  return value > 0 ? `+${value}` : String(value)
}

function abilityMod(value: number | null) {
  return value == null ? null : Math.floor((value - 10) / 2)
}

function creatureAcText(full: Record<string, DetailValue>) {
  const explicit = plainText(full.acString || full.acDescription)
  const dex = abilityMod(numberDetail(full, 'dexterity'))
  const parts = [
    dex != null && `ЛВК ${signed(dex)}`,
    numberDetail(full, 'acArmor') != null && `броня ${signed(numberDetail(full, 'acArmor') || 0)}`,
    numberDetail(full, 'acShield') != null && `щит ${signed(numberDetail(full, 'acShield') || 0)}`,
    numberDetail(full, 'acNatural') != null && `естественная ${signed(numberDetail(full, 'acNatural') || 0)}`,
    numberDetail(full, 'acDodge') != null && `уклонение ${signed(numberDetail(full, 'acDodge') || 0)}`,
    numberDetail(full, 'acDeflection') != null && `отражение ${signed(numberDetail(full, 'acDeflection') || 0)}`,
    numberDetail(full, 'acInsight') != null && `интуиция ${signed(numberDetail(full, 'acInsight') || 0)}`,
    numberDetail(full, 'acWisdom') != null && `мудрость ${signed(numberDetail(full, 'acWisdom') || 0)}`,
    numberDetail(full, 'acMonk') != null && `монах ${signed(numberDetail(full, 'acMonk') || 0)}`,
    numberDetail(full, 'acRage') != null && `ярость ${signed(numberDetail(full, 'acRage') || 0)}`,
    numberDetail(full, 'acProfane') != null && `нечестивый ${signed(numberDetail(full, 'acProfane') || 0)}`,
  ].filter(Boolean)

  return explicit || parts.join(', ')
}

function renderStatCards(item: ArchiveRecord) {
  const full = item.full
  if (!full) return ''

  if (item.kind === 'Существо') {
    const abilities = ([
      ['СИЛ', numberDetail(full, 'strength')],
      ['ЛВК', numberDetail(full, 'dexterity')],
      ['ТЕЛ', numberDetail(full, 'constitution')],
      ['ИНТ', numberDetail(full, 'intelligence')],
      ['МДР', numberDetail(full, 'wisdom')],
      ['ХАР', numberDetail(full, 'charisma')],
    ] as const)
      .filter(([, value]) => value != null)
      .map(([label, value]) => `${label} ${value} (${signed(abilityMod(value) || 0)})`)
      .join(' · ')

    const cards = [
      ['КР', full.cr],
      ['HP', [full.hitPoints, plainText(full.hitPointsDescription)].filter(Boolean).join(' · ')],
      ['КБ', creatureAcText(full)],
      ['Инициатива', typeof full.initiative === 'number' ? signed(full.initiative) : full.initiative],
      ['Спасброски', [`Ст ${full.fortitude ?? '-'}`, `Р ${full.reflex ?? '-'}`, `В ${full.will ?? '-'}`].join(' · ')],
      ['Характеристики', abilities],
      ['Бой', [`БМА ${full.baseAttack ?? '-'}`, `БМ ${full.cmb ?? full.combatManeuverBonus ?? '-'}`, `ЗМ ${full.cmd ?? full.combatManeuverDefense ?? '-'}`].join(' · ')],
    ].filter(([, value]) => value != null && value !== '')

    return `<div class="stat-strip">${cards.map(([label, value]) => `<div><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>`).join('')}</div>`
  }

  if (['Оружие', 'Броня', 'Снаряжение', 'Волшебный предмет'].includes(item.kind)) {
    const cards = [
      ['Цена', full.price ?? full.cost],
      ['Вес', full.weight],
      ['Урон', [full.damageS && `S ${full.damageS}`, full.damageM && `M ${full.damageM}`].filter(Boolean).join(' · ')],
      ['Крит', [full.criticalRoll, full.criticalDamage && `x${full.criticalDamage}`].filter(Boolean).join(' / ')],
      ['Броня', full.armorBonus],
      ['Макс. ЛВК', full.maxDexBonus],
      ['Штраф', full.armorCheckPenalty],
    ].filter(([, value]) => value != null && value !== '')

    return cards.length ? `<div class="stat-strip">${cards.map(([label, value]) => `<div><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>`).join('')}</div>` : ''
  }

  return ''
}

function renderFullInfo(item: ArchiveRecord) {
  const full = item.full
  if (!full) return ''

  const keys = [
    ...DETAIL_ORDER.filter((key) => key in full),
    ...Object.keys(full).filter((key) => !DETAIL_ORDER.includes(key)),
  ].filter((key, index, array) => array.indexOf(key) === index && !['id', 'alias', 'name', 'helpers'].includes(key) && !isEmptyDetail(full[key]))

  return `
    <section class="full-info">
      <div class="section-heading">
        <span>Полные данные</span>
        <b>${keys.length}</b>
      </div>
      ${renderStatCards(item)}
      <div class="full-info-grid">
        ${keys
          .map((key) => {
            const content = renderDetailValue(full[key])
            return content
              ? `
                <article class="detail-block">
                  <h3>${escapeHtml(detailLabel(key))}</h3>
                  ${content}
                </article>
              `
              : ''
          })
          .join('')}
      </div>
    </section>
  `
}

function renderArchiveView() {
  return `
    ${renderTabs()}
    ${renderHero()}
    ${renderArchiveCards()}
    ${renderListPanels()}
    ${renderArchiveBrowser()}
  `
}

function renderCharactersView() {
  const character = currentCharacter()
  if (!character) return ''

  return `
    ${renderTabs()}
    <section class="character-view">
      <div class="character-list panel-cut">
        <div class="section-heading">
          <span>Персонажи</span>
          <button class="tiny-button" type="button" data-action="new-character">Новый</button>
        </div>
        <div class="character-cards">
          ${state.characters
            .map(
              (item) => `
                <button class="character-card ${state.selectedCharacterId === item.id ? 'active' : ''}" type="button" data-character="${escapeAttr(item.id)}">
                  <span class="avatar large" aria-hidden="true"></span>
                  <strong>${escapeHtml(item.name)}</strong>
                  <small>${escapeHtml(item.ancestry)} · ${escapeHtml(item.className)}</small>
                  <b>${item.level}</b>
                </button>
              `,
            )
            .join('')}
        </div>
      </div>
      <form class="character-sheet panel-cut" id="characterForm">
        <input type="hidden" name="id" value="${escapeAttr(character.id)}" />
        <div class="section-heading">
          <span>Лист персонажа</span>
          <b>${escapeHtml(character.className)}</b>
        </div>
        <div class="sheet-grid">
          <label><span>Имя</span><input name="name" value="${escapeAttr(character.name)}" required /></label>
          <label><span>Уровень</span><input name="level" type="number" min="1" max="30" value="${character.level}" /></label>
          <label><span>Народ</span><input name="ancestry" value="${escapeAttr(character.ancestry)}" /></label>
          <label><span>Класс</span><input name="className" value="${escapeAttr(character.className)}" /></label>
          <label><span>HP</span><input name="hp" type="number" min="0" value="${character.hp}" /></label>
          <label><span>КБ</span><input name="ac" type="number" min="0" value="${character.ac}" /></label>
        </div>
        <div class="abilities">
          ${(['str', 'dex', 'con', 'int', 'wis', 'cha'] as const)
            .map(
              (key) => `
                <label>
                  <span>${abilityLabel(key)}</span>
                  <input name="${key}" type="number" min="1" max="40" value="${character.abilities[key]}" />
                </label>
              `,
            )
            .join('')}
        </div>
        <label>
          <span>Заметки</span>
          <textarea name="notes" rows="8">${escapeHtml(character.notes)}</textarea>
        </label>
        <div class="editor-actions">
          <button class="neon-button" type="submit">Сохранить персонажа</button>
          <button class="ghost-button" type="button" data-view="dice">Кубики</button>
        </div>
      </form>
    </section>
  `
}

function renderDiceView() {
  const last = state.rolls[0]
  const displayTotal = state.rolling ? state.rollingDisplay : last ? last.total : 19
  const displayNotation = state.rolling ? state.rollingNotation : last ? last.notation : state.diceNotation
  const trayClass = `dice-tray${state.rolling ? ` rolling throw-${state.rollVariant}` : ''}`
  const rollDetails = state.rolling
    ? 'Кубик летит, кувыркается и раскрывает результат на приземлении'
    : last
      ? `Броски: ${last.rolls.join(', ')}${last.modifier ? `; модификатор ${last.modifier}` : ''}`
      : 'Готов к броску'

  return `
    ${renderTabs()}
    <section class="dice-lab">
      <div class="dice-stage panel-cut">
        <div class="section-heading">
          <span>Кубики</span>
          <b>${displayNotation}</b>
        </div>
        <div class="${trayClass}" aria-live="polite">
          <div id="physicsDiceBox" class="physics-dice-box" aria-hidden="true"></div>
          <span class="tray-grid" aria-hidden="true"></span>
          <span class="tray-impact one" aria-hidden="true"></span>
          <span class="tray-impact two" aria-hidden="true"></span>
          <span class="die-shadow" aria-hidden="true"></span>
          <span class="thrown-die" data-sides="${escapeAttr(diceSidesLabel(displayNotation))}" aria-hidden="true">
            <i class="die-facet die-facet-a"></i>
            <i class="die-facet die-facet-b"></i>
            <i class="die-facet die-facet-c"></i>
            <strong>${displayTotal}</strong>
          </span>
          <div class="roll-readout">
            <span>${displayNotation}</span>
            <strong>${displayTotal}</strong>
            <small>${rollDetails}</small>
          </div>
        </div>
        <form class="notation-form" id="diceForm">
          <input name="notation" value="${escapeAttr(state.diceNotation)}" placeholder="2d6+3" />
          <button class="neon-button" type="submit">Бросить</button>
        </form>
        <div class="dice-buttons">
          ${[2, 3, 4, 6, 8, 10, 12, 20, 100].map((side) => `<button type="button" data-roll="1d${side}">d${side}</button>`).join('')}
        </div>
      </div>
      <div class="generator-panel panel-cut">
        <div class="section-heading">
          <span>Генераторы</span>
          <button class="tiny-button" type="button" data-action="generate-problem">Проблема</button>
        </div>
        <p class="generated-problem">${escapeHtml(state.generatedProblem || 'Запечатанный сундук каждый час меняет владельца по неизвестному правилу.')}</p>
        <div class="quick-grid">
          <button type="button" data-action="random-creature">Случайное существо</button>
          <button type="button" data-action="random-spell">Случайное заклинание</button>
          <button type="button" data-action="new-record">Новая запись</button>
          <button type="button" data-view="characters">Персонажи</button>
        </div>
      </div>
      <div class="history-panel panel-cut">
        <div class="section-heading">
          <span>История</span>
          <b>${state.rolls.length}</b>
        </div>
        <div class="roll-history">
          ${state.rolls.map(renderRollHistoryRow).join('')}
        </div>
      </div>
    </section>
  `
}

function renderRightRail() {
  const favourites = state.favourites.map(byId).filter(Boolean).slice(0, 4)
  const lists = [
    ['Мой персонаж', `${state.characters.length} элементов`],
    ['Кампания: Тени За...', '34 элемента'],
    ['Заклинания мага', `${getCounts()['Заклинание'] || 0} записей`],
    ['Монстры на сессию', `${getCounts()['Существо'] || 0} записей`],
  ]

  return `
    <aside class="right-rail">
      <section class="rail-panel panel-cut">
        <div class="section-heading">
          <span>Избранное</span>
          <button class="tiny-button" type="button" data-view="archive" data-filter="favourites">Все</button>
        </div>
        <div class="rows">
          ${(favourites.length ? favourites : filteredRecords(4)).map((item) => renderRecordRow(item, true)).join('')}
        </div>
      </section>
      <section class="rail-panel panel-cut">
        <div class="section-heading"><span>Быстрые действия</span></div>
        <div class="quick-actions">
          <button type="button" data-view="dice">Бросок кубиков</button>
          <button type="button" data-action="new-record">Создать запись</button>
          <button type="button" data-action="new-character">Новый персонаж</button>
          <button type="button" data-action="random-creature">Случайное существо</button>
        </div>
      </section>
      <section class="rail-panel panel-cut">
        <div class="section-heading">
          <span>Ваши списки</span>
          <button class="tiny-button" type="button" data-action="new-record">Новый</button>
        </div>
        <div class="mini-list">
          ${lists.map(([name, count]) => `<button type="button"><span>${name}</span><small>${count}</small></button>`).join('')}
        </div>
      </section>
      <section class="rail-panel notes-panel panel-cut">
        <div class="section-heading"><span>Быстрые заметки</span></div>
        <textarea id="quickNotes" rows="5">${escapeHtml(state.notes)}</textarea>
      </section>
    </aside>
  `
}

function renderMain() {
  if (state.view === 'characters') return renderCharactersView()
  if (state.view === 'dice') return renderDiceView()
  return renderArchiveView()
}

function render() {
  app.innerHTML = `
    <div class="app-shell">
      ${renderTopbar()}
      ${renderSidebar()}
      <main class="workspace">
        ${renderMain()}
      </main>
      ${renderRightRail()}
      ${state.toast ? `<div class="toast">${escapeHtml(state.toast)}</div>` : ''}
    </div>
  `

  if (state.focusSearch) {
    requestAnimationFrame(() => {
      const input = document.querySelector<HTMLInputElement>('#globalSearch')
      input?.focus()
      input?.setSelectionRange(input.value.length, input.value.length)
      state.focusSearch = false
    })
  }

  if (state.view === 'dice') {
    requestAnimationFrame(() => {
      void ensureDiceBox()
    })
  }
}

function kindGlyph(kind: string) {
  switch (kind) {
    case 'Класс':
      return '⌬'
    case 'Народ':
      return '◎'
    case 'Навык':
      return '✓'
    case 'Черта':
      return '✧'
    case 'Заклинание':
      return '✦'
    case 'Волшебный предмет':
      return '◈'
    case 'Оружие':
      return '⚔'
    case 'Броня':
      return '▰'
    case 'Снаряжение':
      return '◧'
    case 'Существо':
      return '♜'
    case 'Трейт':
      return '✣'
    case 'Домен':
    case 'Поддомен':
    case 'Инквизиция':
      return '◌'
    case 'Архетип':
      return '⌁'
    default:
      return '◇'
  }
}

function abilityLabel(key: keyof Character['abilities']) {
  const labels = {
    str: 'СИЛ',
    dex: 'ЛВК',
    con: 'ТЕЛ',
    int: 'ИНТ',
    wis: 'МДР',
    cha: 'ХАР',
  }

  return labels[key]
}

function getFormString(form: FormData, key: string) {
  return String(form.get(key) || '').trim()
}

function getFormNumber(form: FormData, key: string, fallback: number) {
  const value = Number(form.get(key))
  return Number.isFinite(value) ? value : fallback
}

function saveRecordForm(formElement: HTMLFormElement) {
  const form = new FormData(formElement)
  const id = getFormString(form, 'id') || uid('record')
  const kind = getFormString(form, 'kind') || 'Домашнее правило'
  const existing = state.records.find((item) => item.id === id)
  const updated: ArchiveRecord = {
    id,
    kind,
    alias: existing?.alias || id,
    title: getFormString(form, 'title') || 'Новая запись',
    subtitle: getFormString(form, 'subtitle'),
    details: getFormString(form, 'details'),
    meta: getFormString(form, 'meta')
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean),
    sourceUrl: existing?.sourceUrl || '/local/homebrew',
    accent: accentFor(kind),
    full: existing?.full || null,
    fullText: existing?.fullText || getFormString(form, 'details'),
  }

  const index = state.records.findIndex((item) => item.id === id)
  if (index >= 0) {
    state.records[index] = updated
  } else {
    state.records.unshift(updated)
  }

  state.selectedId = updated.id
  saveRecords()
  setToast('Запись сохранена')
  render()
}

function saveCharacterForm(formElement: HTMLFormElement) {
  const form = new FormData(formElement)
  const id = getFormString(form, 'id') || uid('char')
  const existing = currentCharacter()
  const character: Character = {
    id,
    name: getFormString(form, 'name') || 'Новый персонаж',
    level: getFormNumber(form, 'level', existing?.level || 1),
    ancestry: getFormString(form, 'ancestry') || 'Народ',
    className: getFormString(form, 'className') || 'Класс',
    hp: getFormNumber(form, 'hp', existing?.hp || 1),
    ac: getFormNumber(form, 'ac', existing?.ac || 10),
    abilities: {
      str: getFormNumber(form, 'str', 10),
      dex: getFormNumber(form, 'dex', 10),
      con: getFormNumber(form, 'con', 10),
      int: getFormNumber(form, 'int', 10),
      wis: getFormNumber(form, 'wis', 10),
      cha: getFormNumber(form, 'cha', 10),
    },
    notes: getFormString(form, 'notes'),
  }

  const index = state.characters.findIndex((item) => item.id === id)
  if (index >= 0) {
    state.characters[index] = character
  } else {
    state.characters.unshift(character)
  }

  state.selectedCharacterId = character.id
  saveCharacters()
  setToast('Персонаж сохранен')
  render()
}

function createRecord() {
  const item: ArchiveRecord = {
    id: uid('record'),
    kind: 'Домашнее правило',
    alias: '',
    title: 'Новая запись',
    subtitle: 'Локальная база',
    details: '',
    meta: ['homebrew'],
    sourceUrl: '/local/homebrew',
    accent: 'violet',
  }

  state.records.unshift(item)
  state.selectedId = item.id
  state.view = 'archive'
  state.filter = 'all'
  saveRecords()
  render()
}

function createCharacter() {
  const character: Character = {
    ...DEFAULT_CHARACTER,
    id: uid('char'),
    name: 'Новый персонаж',
    level: 1,
    hp: 10,
    ac: 10,
    notes: '',
  }

  state.characters.unshift(character)
  state.selectedCharacterId = character.id
  state.view = 'characters'
  saveCharacters()
  render()
}

document.addEventListener('click', (event) => {
  const target = event.target as HTMLElement
  const favourite = target.closest<HTMLElement>('[data-favorite]')
  const view = target.closest<HTMLElement>('[data-view]')
  const select = target.closest<HTMLElement>('[data-select]')
  const character = target.closest<HTMLElement>('[data-character]')
  const roll = target.closest<HTMLElement>('[data-roll]')
  const action = target.closest<HTMLElement>('[data-action]')

  if (favourite) {
    event.stopPropagation()
    const id = favourite.dataset.favorite || ''
    state.favourites = state.favourites.includes(id)
      ? state.favourites.filter((item) => item !== id)
      : [id, ...state.favourites].slice(0, 40)
    writeStorage(STORAGE.favourites, state.favourites)
    render()
    return
  }

  if (select) {
    setSelected(select.dataset.select || '')
    state.view = 'archive'
    render()
    return
  }

  if (character) {
    state.selectedCharacterId = character.dataset.character || state.selectedCharacterId
    state.view = 'characters'
    render()
    return
  }

  if (roll) {
    addRoll(roll.dataset.roll || state.diceNotation)
    return
  }

  if (action) {
    const name = action.dataset.action
    if (name === 'new-record') createRecord()
    if (name === 'new-character') createCharacter()
    if (name === 'random-creature') pickRandom('Существо')
    if (name === 'random-spell') pickRandom('Заклинание')
    if (name === 'generate-problem') {
      generateProblem()
      render()
    }
    if (name === 'theme') setToast('Ночной режим активен')
    return
  }

  if (view) {
    const nextView = view.dataset.view as AppState['view']
    const nextFilter = view.dataset.filter
    state.view = nextView || 'archive'
    if (nextFilter) state.filter = nextFilter
    if (state.filter === 'favourites') state.view = 'archive'
    render()
  }
})

document.addEventListener('input', (event) => {
  const target = event.target as HTMLInputElement | HTMLTextAreaElement
  if (target.id === 'globalSearch') {
    state.query = target.value
    state.view = 'archive'
    state.focusSearch = true
    render()
  }

  if (target.id === 'quickNotes') {
    state.notes = target.value
    localStorage.setItem(STORAGE.notes, state.notes)
  }
})

document.addEventListener('submit', (event) => {
  event.preventDefault()
  const form = event.target as HTMLFormElement
  if (form.id === 'recordForm') saveRecordForm(form)
  if (form.id === 'characterForm') saveCharacterForm(form)
  if (form.id === 'diceForm') {
    const data = new FormData(form)
    addRoll(getFormString(data, 'notation'))
  }
})

document.addEventListener('keydown', (event) => {
  if ((event.ctrlKey || event.metaKey) && event.key.toLocaleLowerCase() === 'k') {
    event.preventDefault()
    state.focusSearch = true
    render()
  }
})

async function bootstrap() {
  app.innerHTML = '<div class="loading-screen"><span class="logo-mark"><span></span></span><strong>Aisol Pathfinder</strong></div>'

  try {
    const response = await fetch(SEED_PATH)
    const seed = (await response.json()) as SeedPayload
    const storedRecordEdits = readStorage<ArchiveRecord[] | null>(STORAGE.records, null)

    state.seed = seed
    state.records = mergeRecordEdits(seed.records, storedRecordEdits)
    state.characters = readStorage<Character[]>(STORAGE.characters, [DEFAULT_CHARACTER])
    state.selectedCharacterId = state.characters[0]?.id || ''
    state.favourites = readStorage<string[]>(STORAGE.favourites, [])
    state.recent = readStorage<string[]>(STORAGE.recent, [])
    state.rolls = readStorage<RollResult[]>(STORAGE.rolls, [])
    state.notes = localStorage.getItem(STORAGE.notes) || 'Не забыть дать игрокам свитки лечения перед следующей сессией.'
    state.generatedProblem = ''
    state.selectedId =
      state.recent[0] ||
      findRecordByTitle('Огненный шар', 'Заклинание')?.id ||
      state.records[0]?.id ||
      ''

    render()
  } catch (error) {
    app.innerHTML = `
      <div class="loading-screen error">
        <strong>Aisol Pathfinder</strong>
        <p>Не удалось загрузить локальную базу данных.</p>
        <small>${escapeHtml(error instanceof Error ? error.message : String(error))}</small>
      </div>
    `
  }
}

bootstrap()
