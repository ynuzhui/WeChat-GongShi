const time = require('./time')

const STORAGE_KEY = 'worktime.v1.store'
const PENDING_RECORD_DATE_KEY = 'worktime.v2.pendingRecordDate'
const STORE_VERSION = 3

const DAY_TYPES = {
  WORK: 'work',
  REST: 'rest',
  LEAVE: 'leave'
}

const TYPE_LABELS = {
  work: '上班',
  rest: '本休',
  leave: '调休'
}

const DEFAULT_SETTINGS = {
  standardMinutes: 7 * 60,
  breakMinutes: 30,
  breakStartLimit: '11:20',
  breakEndLimit: '12:00',
  roundingMinutes: 30,
  defaultStart: '09:20',
  defaultEnd: '17:00',
  defaultDeductBreak: true,
  defaultPresetsSeeded: false,
  presets: []
}

const DEFAULT_PRESETS = [
  {
    id: 'default-0930-1700',
    start: '09:30',
    end: '17:00',
    deductBreak: true
  },
  {
    id: 'default-1130-1530',
    start: '11:30',
    end: '15:30',
    deductBreak: false
  },
  {
    id: 'default-1400-1700',
    start: '14:00',
    end: '17:00',
    deductBreak: false
  },
  {
    id: 'default-0830-2030',
    start: '08:30',
    end: '20:30',
    deductBreak: true
  },
  {
    id: 'default-0830-2100',
    start: '08:30',
    end: '21:00',
    deductBreak: true
  }
]

function clone(value) {
  return JSON.parse(JSON.stringify(value))
}

function textValue(value) {
  return value === null || value === undefined ? '' : String(value)
}

function hasValue(input, key) {
  return input && input[key] !== null && input[key] !== undefined && input[key] !== ''
}

function coerceStoredTime(input) {
  if (input === null || input === undefined || input === '') {
    return ''
  }
  return time.formatPickerTime(input) || String(input).trim()
}

function createDefaultStore() {
  return {
    version: STORE_VERSION,
    settings: Object.assign({}, DEFAULT_SETTINGS, { presets: [] }),
    months: {}
  }
}

function createPreset(input) {
  const startInput = hasValue(input, 'start') ? input.start : DEFAULT_SETTINGS.defaultStart
  const endInput = hasValue(input, 'end') ? input.end : DEFAULT_SETTINGS.defaultEnd
  return {
    id: hasValue(input, 'id') ? String(input.id) : `preset-${Date.now()}-${Math.floor(Math.random() * 10000)}`,
    start: time.formatPickerTime(startInput),
    end: time.formatPickerTime(endInput),
    deductBreak: !!(input && input.deductBreak)
  }
}

function normalizePreset(preset) {
  if (!preset || typeof preset !== 'object') {
    return null
  }
  const start = time.formatPickerTime(preset.start)
  const end = time.formatPickerTime(preset.end)
  if (!start || !end || time.parseTime(end) <= time.parseTime(start)) {
    return null
  }
  return createPreset({
    id: preset.id,
    start,
    end,
    deductBreak: !!preset.deductBreak
  })
}

function formatPresetOption(preset) {
  const normalized = normalizePreset(preset)
  if (!normalized) {
    return ''
  }
  return `${normalized.start}-${normalized.end} · ${normalized.deductBreak ? '扣休' : '不扣'}`
}

function normalizeSettings(settingsInput) {
  const source = settingsInput && typeof settingsInput === 'object' ? settingsInput : {}
  const settings = Object.assign({}, DEFAULT_SETTINGS, source)
  settings.defaultPresetsSeeded = source.defaultPresetsSeeded === true
  settings.presets = Array.isArray(source.presets)
    ? source.presets.map(normalizePreset).filter(Boolean)
    : []
  return settings
}

function normalizeEntry(entry) {
  if (!entry || typeof entry !== 'object' || !entry.type) {
    return null
  }
  if (entry.type === DAY_TYPES.REST || entry.type === DAY_TYPES.LEAVE) {
    return {
      type: entry.type,
      note: textValue(entry.note)
    }
  }
  if (entry.type !== DAY_TYPES.WORK) {
    return null
  }

  const normalized = {
    type: DAY_TYPES.WORK,
    start: coerceStoredTime(entry.start),
    end: coerceStoredTime(entry.end),
    note: textValue(entry.note)
  }
  if (hasValue(entry, 'presetId')) {
    normalized.presetId = String(entry.presetId)
  }
  if (typeof entry.deductBreak === 'boolean') {
    normalized.deductBreak = entry.deductBreak
  }
  return normalized
}

function normalizeStore(store) {
  const base = createDefaultStore()
  if (!store || typeof store !== 'object') {
    return base
  }

  const months = {}
  const sourceMonths = store.months && typeof store.months === 'object' ? store.months : {}
  Object.keys(sourceMonths).forEach((monthKey) => {
    const month = sourceMonths[monthKey] || {}
    const entries = {}
    const sourceEntries = month.entries && typeof month.entries === 'object' ? month.entries : {}
    Object.keys(sourceEntries).forEach((dateKey) => {
      const entry = normalizeEntry(sourceEntries[dateKey])
      if (entry) {
        entries[dateKey] = entry
      }
    })
    months[monthKey] = {
      openingBalanceMinutes: typeof month.openingBalanceMinutes === 'number' ? month.openingBalanceMinutes : null,
      entries
    }
  })

  return {
    version: STORE_VERSION,
    settings: normalizeSettings(store.settings),
    months
  }
}

function getMonth(store, monthKey) {
  const normalized = normalizeStore(store)
  const month = normalized.months[monthKey] || {}
  return {
    openingBalanceMinutes: typeof month.openingBalanceMinutes === 'number' ? month.openingBalanceMinutes : null,
    entries: month.entries && typeof month.entries === 'object' ? month.entries : {}
  }
}

function cloneStore(storeInput) {
  return clone(normalizeStore(storeInput))
}

function ensureMonth(store, monthKey) {
  if (!store.months[monthKey]) {
    store.months[monthKey] = { openingBalanceMinutes: null, entries: {} }
  }
  if (!store.months[monthKey].entries) {
    store.months[monthKey].entries = {}
  }
}

function setEntry(storeInput, dateKey, entry) {
  const store = cloneStore(storeInput)
  const monthKey = time.toMonthKey(dateKey)
  ensureMonth(store, monthKey)
  const normalized = normalizeEntry(entry)
  if (normalized) {
    store.months[monthKey].entries[dateKey] = normalized
  }
  return store
}

function clearEntry(storeInput, dateKey) {
  const store = cloneStore(storeInput)
  const monthKey = time.toMonthKey(dateKey)
  if (store.months[monthKey] && store.months[monthKey].entries) {
    delete store.months[monthKey].entries[dateKey]
  }
  return store
}

function setOpeningBalance(storeInput, monthKey, minutes) {
  const store = cloneStore(storeInput)
  ensureMonth(store, monthKey)
  store.months[monthKey].openingBalanceMinutes = minutes
  return store
}

function validateEntry(entry, settingsInput) {
  const settings = normalizeSettings(settingsInput)
  if (!entry || typeof entry !== 'object' || !entry.type) {
    return {
      ok: false,
      message: '请选择记录类型',
      normalized: null
    }
  }

  if (entry.type === DAY_TYPES.REST || entry.type === DAY_TYPES.LEAVE) {
    return {
      ok: true,
      message: '',
      normalized: {
        type: entry.type,
        note: textValue(entry.note)
      }
    }
  }

  if (entry.type !== DAY_TYPES.WORK) {
    return {
      ok: false,
      message: '请选择记录类型',
      normalized: null
    }
  }

  const start = time.parseTime(entry.start)
  const end = time.parseTime(entry.end)
  if (start === null || end === null) {
    return {
      ok: false,
      message: '请补全上班和下班时间',
      normalized: null
    }
  }
  if (end <= start) {
    return {
      ok: false,
      message: '上班时间需要早于下班时间',
      normalized: null
    }
  }

  const normalized = {
    type: DAY_TYPES.WORK,
    start: time.formatPickerTime(start),
    end: time.formatPickerTime(end),
    deductBreak: typeof entry.deductBreak === 'boolean'
      ? entry.deductBreak
      : settings.defaultDeductBreak !== false,
    note: textValue(entry.note)
  }
  if (hasValue(entry, 'presetId')) {
    normalized.presetId = String(entry.presetId)
  }
  return {
    ok: true,
    message: '',
    normalized
  }
}

function saveEntry(storeInput, dateKey, entry) {
  const store = cloneStore(storeInput)
  const validation = validateEntry(entry, store.settings)
  if (!validation.ok) {
    return {
      ok: false,
      message: validation.message,
      store
    }
  }
  const monthKey = time.toMonthKey(dateKey)
  ensureMonth(store, monthKey)
  store.months[monthKey].entries[dateKey] = validation.normalized
  return {
    ok: true,
    message: '',
    entry: validation.normalized,
    store
  }
}

function getDefaultWorkEntry(settingsInput) {
  const settings = normalizeSettings(settingsInput)
  return {
    type: DAY_TYPES.WORK,
    start: settings.defaultStart,
    end: settings.defaultEnd,
    deductBreak: settings.defaultDeductBreak !== false,
    note: ''
  }
}

function getPresetById(storeInput, presetId) {
  const store = normalizeStore(storeInput)
  return store.settings.presets.find((preset) => preset.id === presetId) || null
}

function upsertPreset(storeInput, presetInput) {
  const store = cloneStore(storeInput)
  const preset = normalizePreset(presetInput)
  if (!preset) {
    return store
  }
  store.settings.defaultPresetsSeeded = true
  store.settings.presets = store.settings.presets.filter((item) => item.id !== preset.id)
  store.settings.presets.push(preset)
  return store
}

function deletePreset(storeInput, presetId) {
  const store = cloneStore(storeInput)
  store.settings.defaultPresetsSeeded = true
  store.settings.presets = store.settings.presets.filter((item) => item.id !== presetId)
  return store
}

function seedDefaultPresets(storeInput) {
  const store = cloneStore(storeInput)
  store.settings.defaultPresetsSeeded = true
  if (!store.settings.presets.length) {
    store.settings.presets = DEFAULT_PRESETS.map((preset) => createPreset(preset))
  }
  return store
}

function ensureDefaultPresets(storeInput) {
  const store = cloneStore(storeInput)
  const ids = store.settings.presets.map((preset) => preset.id)
  const hasExistingDefaultPreset = ids.some((id) => /^default-/.test(id))
  if (!hasExistingDefaultPreset) {
    return store
  }
  DEFAULT_PRESETS.forEach((preset) => {
    if (ids.indexOf(preset.id) !== -1) {
      return
    }
    const normalized = createPreset(preset)
    store.settings.presets.push(normalized)
    ids.push(normalized.id)
  })
  return store
}

function entryFromPreset(preset, note) {
  const normalized = normalizePreset(preset)
  if (!normalized) {
    return getDefaultWorkEntry()
  }
  return {
    type: DAY_TYPES.WORK,
    start: normalized.start,
    end: normalized.end,
    deductBreak: normalized.deductBreak,
    presetId: normalized.id,
    note: textValue(note)
  }
}

function countRecords(storeInput) {
  const store = normalizeStore(storeInput)
  return Object.keys(store.months).reduce((total, monthKey) => {
    const month = getMonth(store, monthKey)
    return total + Object.keys(month.entries).length
  }, 0)
}

// 查找 beforeDate 之前（不含当天）最近一条上班记录，用于录入页「复用上次」
function findLatestWorkEntry(storeInput, beforeDate) {
  const store = normalizeStore(storeInput)
  const limit = beforeDate ? String(beforeDate) : ''
  let bestDate = ''
  let bestEntry = null
  Object.keys(store.months).forEach((monthKey) => {
    const entries = getMonth(store, monthKey).entries
    Object.keys(entries).forEach((dateKey) => {
      if (limit && dateKey >= limit) {
        return
      }
      const entry = entries[dateKey]
      if (entry && entry.type === DAY_TYPES.WORK && entry.start && entry.end && dateKey > bestDate) {
        bestDate = dateKey
        bestEntry = entry
      }
    })
  })
  return bestEntry ? Object.assign({}, bestEntry) : null
}

module.exports = {
  STORAGE_KEY,
  PENDING_RECORD_DATE_KEY,
  STORE_VERSION,
  DAY_TYPES,
  TYPE_LABELS,
  DEFAULT_SETTINGS,
  DEFAULT_PRESETS,
  createDefaultStore,
  createPreset,
  normalizeStore,
  normalizeSettings,
  normalizePreset,
  formatPresetOption,
  normalizeEntry,
  getMonth,
  cloneStore,
  setEntry,
  clearEntry,
  setOpeningBalance,
  validateEntry,
  saveEntry,
  getDefaultWorkEntry,
  getPresetById,
  upsertPreset,
  deletePreset,
  seedDefaultPresets,
  ensureDefaultPresets,
  entryFromPreset,
  countRecords,
  findLatestWorkEntry
}
