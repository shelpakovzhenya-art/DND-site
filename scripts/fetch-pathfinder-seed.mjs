import { mkdir, writeFile } from 'node:fs/promises'

const SOURCE = 'https://pathfinder.family'
const OUT_FILE = 'public/data/pathfinder-seed.json'
const CONCURRENCY = Number(process.env.PATHFINDER_CONCURRENCY || 8)
const REQUEST_TIMEOUT_MS = Number(process.env.PATHFINDER_TIMEOUT_MS || 45000)
const RETRIES = Number(process.env.PATHFINDER_RETRIES || 4)

const endpoints = {
  classes: '/api/classes',
  races: '/api/races',
  skills: '/api/skills',
  feats: '/api/feats',
  spells: '/api/spells',
  magicItems: '/api/allMagicItems',
  beasts: '/api/beasts',
  weapons: '/api/weapons',
  armors: '/api/armors',
  goodsAndServices: '/api/goodsAndServices',
  traits: '/api/traits',
  domains: '/api/domains',
  archetypes: '/api/archetypes',
}

const detailEndpoints = {
  classes: (item) => `/api/classInfo?alias=${encodeURIComponent(item.alias)}`,
  races: (item) => `/api/raceInfo?alias=${encodeURIComponent(item.alias)}`,
  skills: (item) => `/api/skillInfo?alias=${encodeURIComponent(item.alias)}`,
  feats: (item) => `/api/featInfo?alias=${encodeURIComponent(item.alias)}`,
  spells: (item) => `/api/spellInfo?alias=${encodeURIComponent(item.alias)}`,
  magicItems: (item) => `/api/magicItemInfo?alias=${encodeURIComponent(item.alias)}`,
  beasts: (item) => `/api/beastInfo?alias=${encodeURIComponent(item.alias)}`,
  domains: (item) => `/api/domainInfo?alias=${encodeURIComponent(item.alias)}&type=${encodeURIComponent(item.detailType || item.type || 'domain')}`,
  archetypes: (item) => `/api/archetypeInfo?alias=${encodeURIComponent(item.alias)}`,
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

const failures = []

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

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

function clean(value = '', max = 900) {
  const text = decodeEntities(String(value ?? ''))
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<\/(p|div|li|tr|h[1-6])>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/[ \t\r\f\v]+/g, ' ')
    .replace(/\n\s+/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()

  return text.length > max ? `${text.slice(0, max - 1).trim()}...` : text
}

function textFromValue(value, max = 14000, seen = new WeakSet()) {
  if (value == null) return ''
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return clean(value, max)
  if (Array.isArray(value)) return value.map((item) => textFromValue(item, max, seen)).filter(Boolean).join('\n')
  if (typeof value === 'object') {
    if (seen.has(value)) return ''
    seen.add(value)
    return Object.entries(value)
      .filter(([key]) => !['helpers'].includes(key))
      .map(([key, inner]) => `${key}: ${textFromValue(inner, max, seen)}`)
      .filter((line) => !line.endsWith(': '))
      .join('\n')
      .slice(0, max)
  }

  return ''
}

function compactMeta(values) {
  return values.filter(Boolean).map((value) => clean(value, 110))
}

function sourceId(kind, alias, title) {
  return `${kind}:${alias || title || 'record'}`.replace(/\s+/g, '-').toLowerCase()
}

function record({ kind, alias, name, title, subtitle, details, meta, sourceUrl, accent, full }) {
  const compactFullText = textFromValue(full, 16000)

  return {
    id: sourceId(kind, alias, title || name),
    kind,
    alias: alias || '',
    title: clean(title || name || alias || 'Без названия', 160),
    subtitle: clean(subtitle || '', 180),
    details: clean(details || compactFullText || '', 1500),
    meta: compactMeta(meta || []),
    sourceUrl,
    accent,
    full: full || null,
    fullText: compactFullText,
  }
}

async function fetchJson(endpoint) {
  const url = endpoint.startsWith('http') ? endpoint : `${SOURCE}${endpoint}`
  let lastError

  for (let attempt = 1; attempt <= RETRIES; attempt += 1) {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)

    try {
      const response = await fetch(url, {
        signal: controller.signal,
        headers: {
          accept: 'application/json,text/plain,*/*',
          'user-agent': 'Aisol Pathfinder seed sync',
        },
      })

      if (!response.ok) {
        throw new Error(`${response.status} ${response.statusText}`)
      }

      return await response.json()
    } catch (error) {
      lastError = error
      if (attempt < RETRIES) await sleep(450 * attempt ** 2)
    } finally {
      clearTimeout(timeout)
    }
  }

  throw new Error(`${endpoint}: ${lastError?.message || lastError}`)
}

async function mapConcurrent(label, items, mapper) {
  const results = new Array(items.length)
  let index = 0
  let completed = 0

  async function worker() {
    while (index < items.length) {
      const current = index
      index += 1

      try {
        results[current] = await mapper(items[current], current)
      } catch (error) {
        failures.push({
          label,
          alias: items[current]?.alias,
          message: error?.message || String(error),
        })
        results[current] = null
      } finally {
        completed += 1
        if (completed % 100 === 0 || completed === items.length) {
          process.stdout.write(`\r${label}: ${completed}/${items.length}`)
        }
      }
    }
  }

  process.stdout.write(`${label}: 0/${items.length}`)
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, items.length) }, worker))
  process.stdout.write('\n')

  return results
}

async function detailMap(label, items) {
  const buildEndpoint = detailEndpoints[label]
  if (!buildEndpoint) return new Map()

  const details = await mapConcurrent(`Details ${label}`, items, (item) => fetchJson(buildEndpoint(item)))
  return new Map(items.map((item, index) => [item.alias, details[index] || null]))
}

function flattenDomains(items) {
  return items.flatMap((item) => {
    const base = [{ ...item, detailType: item.type || 'domain', parentDomain: null }]
    const children = (item.childs || []).map((child) => ({
      ...child,
      detailType: item.type === 'inquisition' ? 'inquisition' : 'subdomain',
      parentDomain: { name: item.name, alias: item.alias, type: item.type },
    }))

    return [...base, ...children]
  })
}

function flattenArchetypes(items) {
  return items.flatMap((entry) =>
    (entry.archetypes || []).map((archetype) => ({
      ...archetype,
      parentClass: {
        name: entry.name,
        alias: entry.alias,
      },
      archetypesDescription: entry.archetypesDescription,
    })),
  )
}

function normalizeClasses(items, details) {
  return items.map((item) => {
    const full = details.get(item.alias) || item
    return record({
      kind: 'Класс',
      alias: item.alias,
      title: item.name,
      subtitle: full.book?.abbreviation ? `Источник: ${full.book.abbreviation}` : full.book?.name || item.book?.name,
      details: full.fullDescription || full.description || item.description,
      meta: [full.book?.name || item.book?.name, full.hitDie && `КЗ d${full.hitDie}`, full.skillRanksPerLevel && `${full.skillRanksPerLevel} навыков/ур.`],
      sourceUrl: `/class/${item.alias}`,
      accent: 'gold',
      full,
    })
  })
}

function normalizeRaces(items, details) {
  return items.map((item) => {
    const full = details.get(item.alias) || item
    return record({
      kind: 'Народ',
      alias: item.alias,
      title: item.name,
      subtitle: full.book?.abbreviation ? `Источник: ${full.book.abbreviation}` : full.book?.name || item.book?.name,
      details: full.description || full.physicalDescription || item.description,
      meta: [full.book?.name || item.book?.name, full.alignmentAndReligion],
      sourceUrl: `/race/${item.alias}`,
      accent: 'cyan',
      full,
    })
  })
}

function normalizeSkills(payload, details) {
  return (payload.skillsWithClasses || []).map((item) => {
    const full = { ...item, ...(details.get(item.alias) || {}) }
    const classSkills = [...(item.classes || []), ...(item.prestigeClasses || [])]
      .filter((entry) => entry.isClassSkill)
      .map((entry) => entry.shortName || entry.name)
      .slice(0, 22)

    return record({
      kind: 'Навык',
      alias: item.alias,
      title: item.name,
      subtitle: classSkills.length ? `Классовый навык: ${classSkills.join(', ')}` : 'Навык персонажа',
      details: [full.description, full.fullDescription].filter(Boolean).join('\n'),
      meta: [`${(item.classes || []).length} классов`, `${(item.prestigeClasses || []).length} престиж-классов`, classSkills.length ? `${classSkills.length} классовых` : 'общий'],
      sourceUrl: `/skill/${item.alias}`,
      accent: 'teal',
      full,
    })
  })
}

function normalizeFeats(items, details) {
  return items.map((item) => {
    const full = details.get(item.alias) || item
    return record({
      kind: 'Черта',
      alias: item.alias,
      title: item.name,
      subtitle: full.types?.map((type) => type.name).join(', ') || item.types?.map((type) => type.name).join(', ') || 'Черта',
      details: [full.prerequisites && `Требования: ${full.prerequisites}`, full.benefit, full.fullDescription, full.description].filter(Boolean).join('\n'),
      meta: [full.book?.abbreviation || item.book?.abbreviation || full.book?.name, item.parentFeatId ? 'цепочка' : 'самостоятельная'],
      sourceUrl: `/feat/${item.alias}`,
      accent: 'violet',
      full,
    })
  })
}

function normalizeSpells(items, details) {
  return items.map((item) => {
    const full = details.get(item.alias) || item
    const levels = (full.classes || item.classes || [])
      .slice()
      .sort((a, b) => a.level - b.level || a.name.localeCompare(b.name, 'ru'))
      .slice(0, 10)
      .map((entry) => `${entry.name} ${entry.level}`)
      .join(', ')

    return record({
      kind: 'Заклинание',
      alias: item.alias,
      title: item.name,
      subtitle: full.school?.name || item.schools?.map((school) => school.name).join(', ') || 'Заклинание',
      details: full.description || full.shortDescription || item.shortDescription || item.shortDescriptionComponents,
      meta: [levels, full.book?.abbreviation || item.book?.abbreviation || full.book?.name],
      sourceUrl: `/spell/${item.alias}`,
      accent: 'violet',
      full,
    })
  })
}

function normalizeMagicItems(items, details) {
  return items.map((item) => {
    const full = details.get(item.alias) || item
    return record({
      kind: 'Волшебный предмет',
      alias: item.alias,
      title: item.name,
      subtitle: full.type?.name || item.type?.name || 'Волшебный предмет',
      details: full.description || full.statistics || full.destruction || item.description,
      meta: [full.slot?.name || item.slot?.name || 'без слота', full.book?.abbreviation || item.book?.abbreviation || full.book?.name],
      sourceUrl: `/magicItem/${item.alias}`,
      accent: 'gold',
      full,
    })
  })
}

function normalizeBeasts(items, details) {
  return items.map((item) => {
    const full = details.get(item.alias) || item
    return record({
      kind: 'Существо',
      alias: item.alias,
      title: item.name,
      subtitle: full.cr != null ? `КР ${full.cr}` : full.fullCreatureType || 'Существо',
      details: full.description || full.rootPageDescription || full.fullCreatureType || item.description || 'Существо из бестиария Pathfinder Family.',
      meta: [full.fullCreatureType, full.terrain?.name || item.terrain?.name, full.climate?.name || item.climate?.name, full.book?.abbreviation || item.book?.abbreviation],
      sourceUrl: `/bestiary/beast/${item.alias}`,
      accent: 'cyan',
      full,
    })
  })
}

function normalizeWeapons(items) {
  return items.map((item) =>
    record({
      kind: 'Оружие',
      alias: item.alias,
      title: item.name,
      subtitle: [item.proficientCategory?.name, item.rangeCategory?.name].filter(Boolean).join(' · ') || 'Оружие',
      details: item.description || [item.damageM && `Урон ${item.damageM}`, item.criticalRoll && `Крит ${item.criticalRoll}/x${item.criticalDamage}`].filter(Boolean).join('. '),
      meta: [item.book?.abbreviation || item.book?.name, item.cost != null && `${item.cost} зм`, item.weight != null && `${item.weight} фн.`],
      sourceUrl: `/weapon/${item.alias}`,
      accent: 'gold',
      full: item,
    }),
  )
}

function normalizeArmors(items) {
  return items.map((item) =>
    record({
      kind: 'Броня',
      alias: item.alias,
      title: item.name,
      subtitle: item.type?.name || 'Броня',
      details: item.description || [item.armorBonus != null && `Бонус ${item.armorBonus}`, item.maxDexBonus != null && `Макс. ЛВК ${item.maxDexBonus}`].filter(Boolean).join('. '),
      meta: [item.book?.abbreviation || item.book?.name, item.cost != null && `${item.cost} зм`, item.weight != null && `${item.weight} фн.`],
      sourceUrl: `/armor/${item.alias}`,
      accent: 'gold',
      full: item,
    }),
  )
}

function normalizeGoodsAndServices(items) {
  return items.map((item) =>
    record({
      kind: 'Снаряжение',
      alias: item.alias,
      title: item.name,
      subtitle: [item.equipmentSubType, item.type?.name].filter(Boolean).join(' · ') || 'Снаряжение',
      details: item.description || item.costDescription || item.weightDescription,
      meta: [item.book?.abbreviation || item.book?.name, item.cost != null && `${item.cost} зм`, item.weight != null && `${item.weight} фн.`],
      sourceUrl: `/goodsAndServices/${item.alias}`,
      accent: 'teal',
      full: item,
    }),
  )
}

function normalizeTraits(items) {
  return items.map((item) =>
    record({
      kind: 'Трейт',
      alias: item.alias,
      title: item.name,
      subtitle: item.type?.name || 'Трейт',
      details: [item.prerequisites && `Требования: ${item.prerequisites}`, item.benefit].filter(Boolean).join('\n'),
      meta: [item.type?.parentType?.name, item.book?.abbreviation || item.book?.name],
      sourceUrl: `/trait/${item.alias}`,
      accent: 'teal',
      full: item,
    }),
  )
}

function normalizeDomains(items, details) {
  return items.map((item) => {
    const full = details.get(item.alias) || item
    const kind = item.detailType === 'inquisition' ? 'Инквизиция' : item.detailType === 'subdomain' ? 'Поддомен' : 'Домен'
    const sourceUrl =
      item.detailType === 'inquisition'
        ? `/god/inquisition/${item.alias}`
        : item.detailType === 'subdomain'
          ? `/god/subdomain/${item.alias}`
          : `/god/domain/${item.alias}`

    return record({
      kind,
      alias: item.alias,
      title: item.name,
      subtitle: item.parentDomain?.name || full.book?.abbreviation || item.book?.abbreviation || kind,
      details: [full.description, full.power0Description, full.power1Description, full.power2Description].filter(Boolean).join('\n'),
      meta: [full.book?.abbreviation || item.book?.abbreviation || full.book?.name, item.parentDomain?.name, full.gods?.slice?.(0, 4)?.join(', ')],
      sourceUrl,
      accent: 'violet',
      full: { ...full, parentDomain: item.parentDomain, detailType: item.detailType },
    })
  })
}

function normalizeArchetypes(items, details) {
  return items.map((item) => {
    const full = { ...item, ...(details.get(item.alias) || {}) }
    return record({
      kind: 'Архетип',
      alias: item.alias,
      title: item.name,
      subtitle: item.parentClass?.name || full.parentClass?.name || 'Архетип',
      details: full.description || item.description || full.archetypeFeatures,
      meta: [item.book?.abbreviation || full.book?.abbreviation || item.book?.name, item.parentClass?.name || full.parentClass?.name],
      sourceUrl: `/class/archetype/${item.parentClass?.alias || full.parentClass?.alias || ''}/${item.alias}`,
      accent: 'cyan',
      full,
    })
  })
}

const raw = {}
for (const [name, endpoint] of Object.entries(endpoints)) {
  process.stdout.write(`Loading ${endpoint}... `)
  raw[name] = await fetchJson(endpoint)
  const size = Array.isArray(raw[name]) ? raw[name].length : Object.keys(raw[name]).length
  process.stdout.write(`${size}\n`)
}

const domainItems = flattenDomains(raw.domains)
const archetypeItems = flattenArchetypes(raw.archetypes)

const detailMaps = {
  classes: await detailMap('classes', raw.classes),
  races: await detailMap('races', raw.races),
  skills: await detailMap('skills', raw.skills.skillsWithClasses || []),
  feats: await detailMap('feats', raw.feats),
  spells: await detailMap('spells', raw.spells),
  magicItems: await detailMap('magicItems', raw.magicItems),
  beasts: await detailMap('beasts', raw.beasts),
  domains: await detailMap('domains', domainItems),
  archetypes: await detailMap('archetypes', archetypeItems),
}

const records = [
  ...normalizeClasses(raw.classes, detailMaps.classes),
  ...normalizeRaces(raw.races, detailMaps.races),
  ...normalizeSkills(raw.skills, detailMaps.skills),
  ...normalizeFeats(raw.feats, detailMaps.feats),
  ...normalizeSpells(raw.spells, detailMaps.spells),
  ...normalizeMagicItems(raw.magicItems, detailMaps.magicItems),
  ...normalizeBeasts(raw.beasts, detailMaps.beasts),
  ...normalizeWeapons(raw.weapons),
  ...normalizeArmors(raw.armors),
  ...normalizeGoodsAndServices(raw.goodsAndServices),
  ...normalizeTraits(raw.traits),
  ...normalizeDomains(domainItems, detailMaps.domains),
  ...normalizeArchetypes(archetypeItems, detailMaps.archetypes),
].sort((a, b) => a.title.localeCompare(b.title, 'ru'))

const counts = records.reduce((acc, item) => {
  acc[item.kind] = (acc[item.kind] || 0) + 1
  return acc
}, {})

const payload = {
  source: SOURCE,
  generatedAt: new Date().toISOString(),
  version: 2,
  detailMode: 'full-api',
  counts,
  failures,
  records,
}

await mkdir('public/data', { recursive: true })
await writeFile(OUT_FILE, JSON.stringify(payload), 'utf8')

console.log(`Saved ${records.length} full records to ${OUT_FILE}`)
if (failures.length) {
  console.log(`Completed with ${failures.length} failed detail requests. See payload.failures for aliases.`)
}
