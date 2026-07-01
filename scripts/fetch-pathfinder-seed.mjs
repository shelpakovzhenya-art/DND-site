import { mkdir, writeFile } from 'node:fs/promises'

const SOURCE = 'https://pathfinder.family'

const endpoints = {
  classes: '/api/classes',
  races: '/api/races',
  skills: '/api/skills',
  feats: '/api/feats',
  spells: '/api/spells',
  magicItems: '/api/allMagicItems',
  beasts: '/api/beasts',
}

const htmlEntities = new Map([
  ['amp', '&'],
  ['quot', '"'],
  ['apos', "'"],
  ['lt', '<'],
  ['gt', '>'],
  ['nbsp', ' '],
  ['mdash', '-'],
  ['ndash', '-'],
])

function decodeEntities(value = '') {
  return String(value).replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (_, entity) => {
    if (entity[0] === '#') {
      const isHex = entity[1]?.toLowerCase() === 'x'
      const code = Number.parseInt(entity.slice(isHex ? 2 : 1), isHex ? 16 : 10)
      return Number.isFinite(code) ? String.fromCodePoint(code) : ''
    }

    return htmlEntities.get(entity.toLowerCase()) ?? ''
  })
}

function clean(value = '', max = 720) {
  const text = decodeEntities(String(value))
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

  return text.length > max ? `${text.slice(0, max - 1).trim()}...` : text
}

function compactMeta(values) {
  return values.filter(Boolean).map((value) => clean(value, 90))
}

function record({ kind, alias, name, title, subtitle, details, meta, sourceUrl, accent }) {
  return {
    id: `${kind}:${alias || title || name}`.replace(/\s+/g, '-').toLowerCase(),
    kind,
    alias: alias || '',
    title: clean(title || name || alias || 'Без названия', 120),
    subtitle: clean(subtitle || '', 160),
    details: clean(details || '', 920),
    meta: compactMeta(meta || []),
    sourceUrl,
    accent,
  }
}

async function load(endpoint) {
  const response = await fetch(`${SOURCE}${endpoint}`, {
    headers: { accept: 'application/json,text/plain,*/*' },
  })

  if (!response.ok) {
    throw new Error(`${endpoint}: ${response.status} ${response.statusText}`)
  }

  return response.json()
}

function normalizeClasses(items) {
  return items.map((item) =>
    record({
      kind: 'Класс',
      alias: item.alias,
      title: item.name,
      subtitle: item.book?.abbreviation ? `Источник: ${item.book.abbreviation}` : item.book?.name,
      details: item.description,
      meta: [item.book?.name],
      sourceUrl: `/class/${item.alias}`,
      accent: 'gold',
    }),
  )
}

function normalizeRaces(items) {
  return items.map((item) =>
    record({
      kind: 'Народ',
      alias: item.alias,
      title: item.name,
      subtitle: item.book?.abbreviation ? `Источник: ${item.book.abbreviation}` : item.book?.name,
      details: 'Игровой народ из раздела Pathfinder Family: происхождение, особенности и игровые заметки для кампании.',
      meta: [item.book?.name],
      sourceUrl: `/race/${item.alias}`,
      accent: 'cyan',
    }),
  )
}

function normalizeSkills(payload) {
  return (payload.skillsWithClasses || []).map((item) => {
    const classSkills = (item.classes || [])
      .filter((entry) => entry.isClassSkill)
      .map((entry) => entry.shortName || entry.name)
      .slice(0, 18)

    return record({
      kind: 'Навык',
      alias: item.alias,
      title: item.name,
      subtitle: classSkills.length ? `Классовый навык: ${classSkills.join(', ')}` : 'Навык персонажа',
      details: 'Матрица классовых навыков Pathfinder Family: проверки, классовые отметки и заметки ведущего.',
      meta: [`${(item.classes || []).length} классов`, classSkills.length ? `${classSkills.length} классовых` : 'общий'],
      sourceUrl: `/skill/${item.alias}`,
      accent: 'teal',
    })
  })
}

function normalizeFeats(items) {
  return items.map((item) =>
    record({
      kind: 'Черта',
      alias: item.alias,
      title: item.name,
      subtitle: item.types?.map((type) => type.name).join(', ') || 'Черта',
      details: [item.requirements && `Требования: ${item.requirements}`, item.description]
        .filter(Boolean)
        .join(' '),
      meta: [item.book?.abbreviation || item.book?.name, item.parentFeatId ? 'цепочка' : 'самостоятельная'],
      sourceUrl: `/feat/${item.alias}`,
      accent: 'violet',
    }),
  )
}

function normalizeSpells(items) {
  return items.map((item) => {
    const levels = (item.classes || [])
      .slice()
      .sort((a, b) => a.level - b.level || a.name.localeCompare(b.name, 'ru'))
      .slice(0, 8)
      .map((entry) => `${entry.name} ${entry.level}`)
      .join(', ')

    return record({
      kind: 'Заклинание',
      alias: item.alias,
      title: item.name,
      subtitle: item.schools?.map((school) => school.name).join(', ') || 'Заклинание',
      details: item.shortDescription || item.shortDescriptionComponents || 'Описание заклинания доступно для дополнения в редакторе.',
      meta: [levels, item.book?.abbreviation || item.book?.name],
      sourceUrl: `/spell/${item.alias}`,
      accent: 'violet',
    })
  })
}

function normalizeMagicItems(items) {
  return items.map((item) =>
    record({
      kind: 'Волшебный предмет',
      alias: item.alias,
      title: item.name,
      subtitle: item.type?.name || 'Волшебный предмет',
      details: [
        item.engName && `Оригинал: ${item.engName}`,
        item.slot?.name && `Слот: ${item.slot.name}`,
        item.type?.name && `Тип: ${item.type.name}`,
      ]
        .filter(Boolean)
        .join('. '),
      meta: [item.slot?.name || 'без слота', item.book?.abbreviation || item.book?.name],
      sourceUrl: `/magicItem/${item.alias}`,
      accent: 'gold',
    }),
  )
}

function normalizeBeasts(items) {
  return items.map((item) =>
    record({
      kind: 'Существо',
      alias: item.alias,
      title: item.name,
      subtitle: item.cr != null ? `КР ${item.cr}` : item.fullCreatureType || 'Существо',
      details: item.description || item.fullCreatureType || 'Существо из бестиария Pathfinder Family.',
      meta: [item.fullCreatureType, item.terrain?.name, item.climate?.name, item.book?.abbreviation || item.book?.name],
      sourceUrl: `/bestiary/beast/${item.alias}`,
      accent: 'cyan',
    }),
  )
}

const raw = {}
for (const [name, endpoint] of Object.entries(endpoints)) {
  process.stdout.write(`Loading ${endpoint}... `)
  raw[name] = await load(endpoint)
  const size = Array.isArray(raw[name]) ? raw[name].length : Object.keys(raw[name]).length
  process.stdout.write(`${size}\n`)
}

const records = [
  ...normalizeClasses(raw.classes),
  ...normalizeRaces(raw.races),
  ...normalizeSkills(raw.skills),
  ...normalizeFeats(raw.feats),
  ...normalizeSpells(raw.spells),
  ...normalizeMagicItems(raw.magicItems),
  ...normalizeBeasts(raw.beasts),
].sort((a, b) => a.title.localeCompare(b.title, 'ru'))

const counts = records.reduce((acc, item) => {
  acc[item.kind] = (acc[item.kind] || 0) + 1
  return acc
}, {})

const payload = {
  source: SOURCE,
  generatedAt: new Date().toISOString(),
  version: 1,
  counts,
  records,
}

await mkdir('public/data', { recursive: true })
await writeFile('public/data/pathfinder-seed.json', JSON.stringify(payload), 'utf8')

console.log(`Saved ${records.length} records to public/data/pathfinder-seed.json`)
