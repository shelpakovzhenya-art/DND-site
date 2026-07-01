import './index.css'

type Accent = 'violet' | 'cyan' | 'gold' | 'teal' | 'red'

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
  rules: ['Класс', 'Народ', 'Навык', 'Черта'],
  classes: ['Класс'],
  spells: ['Заклинание'],
  items: ['Волшебный предмет'],
  creatures: ['Существо'],
  generators: ['Существо', 'Заклинание', 'Волшебный предмет'],
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
  Существо: 'cyan',
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
  generatedProblem: '',
  focusSearch: false,
  toast: '',
}

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

  const haystack = [item.title, item.kind, item.subtitle, item.details, ...item.meta]
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
  writeStorage(STORAGE.records, state.records)
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

  if (!Number.isFinite(count) || !Number.isFinite(sides) || count < 1 || sides < 2 || sides > 1000) {
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

function addRoll(notation: string) {
  const result = rollNotation(notation)
  if (!result) {
    setToast('Формула кубика не распознана')
    return
  }

  state.diceNotation = result.notation
  state.rolls = [result, ...state.rolls].slice(0, 14)
  writeStorage(STORAGE.rolls, state.rolls)
  render()
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
  const result = lastRoll?.total ?? 19

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
        <button class="die-visual" type="button" data-view="dice" aria-label="Открыть кубики">
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
    { title: 'Снаряжение', value: `${counts['Волшебный предмет'] || 0} предмет`, accent: 'gold', filter: 'items', art: 'item' },
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
          ${['Класс', 'Народ', 'Навык', 'Черта', 'Заклинание', 'Волшебный предмет', 'Существо', 'Домашнее правило']
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
    </form>
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

  return `
    ${renderTabs()}
    <section class="dice-lab">
      <div class="dice-stage panel-cut">
        <div class="section-heading">
          <span>Кубики</span>
          <b>${last ? last.notation : state.diceNotation}</b>
        </div>
        <div class="giant-die" aria-live="polite">
          <span>${last ? last.notation : 'd20'}</span>
          <strong>${last ? last.total : 19}</strong>
          <small>${last ? `Броски: ${last.rolls.join(', ')}${last.modifier ? `; модификатор ${last.modifier}` : ''}` : 'Готов к броску'}</small>
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
          ${state.rolls
            .map(
              (roll) => `
                <div>
                  <strong>${roll.total}</strong>
                  <span>${escapeHtml(roll.notation)} · ${escapeHtml(roll.createdAt)}</span>
                </div>
              `,
            )
            .join('')}
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
    case 'Существо':
      return '♜'
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
  const existing = byId(id)
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
    const storedRecords = readStorage<ArchiveRecord[] | null>(STORAGE.records, null)

    state.seed = seed
    state.records = storedRecords?.length ? storedRecords : seed.records
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
