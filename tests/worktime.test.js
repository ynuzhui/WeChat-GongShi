const assert = require('assert')
const worktime = require('../utils/worktime')
const storage = require('../utils/storage')
const view = require('../utils/view')

function delta(entry) {
  return worktime.formatHours(worktime.calculateEntry(entry).diffMinutes)
}

function withMockWx(initialStorage, fn) {
  const previousWx = global.wx
  const backing = Object.assign({}, initialStorage || {})
  global.wx = {
    getStorageSync(key) {
      return backing[key] || ''
    },
    setStorageSync(key, value) {
      backing[key] = value
    },
    removeStorageSync(key) {
      delete backing[key]
    }
  }
  try {
    return fn(backing)
  } finally {
    global.wx = previousWx
  }
}

assert.strictEqual(delta({ type: 'work', start: '11:30', end: '15:30' }), '-3')
assert.strictEqual(delta({ type: 'work', start: '12:00', end: '16:00' }), '-3')
assert.strictEqual(delta({ type: 'work', start: '11:00', end: '17:00' }), '-1.5')
assert.strictEqual(delta({ type: 'work', start: '09:20', end: '17:00' }), '0')
assert.strictEqual(delta({ type: 'work', start: '10:20', end: '17:00' }), delta({ type: 'work', start: '10:30', end: '17:00' }))
assert.strictEqual(delta({ type: 'work', start: '10:50', end: '17:00' }), delta({ type: 'work', start: '11:00', end: '17:00' }))
assert.strictEqual(worktime.formatTimeRange({ start: '10:20', end: '17:00' }), '10:20-17:00')
assert.deepStrictEqual(worktime.buildHalfHourTimePickerRange()[1], ['00', '30'])
assert.deepStrictEqual(worktime.getHalfHourTimePickerValue('09:20'), [9, 1])
assert.strictEqual(worktime.getHalfHourTimeFromPickerValue([10, 0]), '10:00')
assert.strictEqual(worktime.getHalfHourTimeFromPickerValue([10, 1]), '10:30')
assert.strictEqual(delta({ type: 'work', start: '09:20', end: '17:00', deductBreak: true }), '0')
assert.strictEqual(delta({ type: 'work', start: '09:20', end: '17:00', deductBreak: false }), '0.5')
assert.strictEqual(delta({ type: 'work', start: '11:30', end: '15:30', deductBreak: true }), '-3.5')
assert.strictEqual(delta({ type: 'work', start: '11:30', end: '15:30', deductBreak: false }), '-3')
assert.deepStrictEqual(view.buildDateStatus({
  hasEntry: true,
  entry: { type: 'work' },
  calc: { valid: true, diffMinutes: 0 },
  displayTime: '09:20-17:00'
}), {
  time: '09:20-17:00',
  diff: '无'
})
assert.strictEqual(delta({ type: 'rest' }), '0')
assert.strictEqual(delta({ type: 'leave' }), '-7')

const defaultPresetStore = worktime.seedDefaultPresets(worktime.createDefaultStore())
assert.strictEqual(defaultPresetStore.version, 3)
assert.strictEqual(defaultPresetStore.settings.defaultPresetsSeeded, true)
assert.strictEqual(defaultPresetStore.settings.presets.length, 5)
assert.deepStrictEqual(defaultPresetStore.settings.presets.map((preset) => ({
  id: preset.id,
  start: preset.start,
  end: preset.end,
  deductBreak: preset.deductBreak,
  hasName: Object.prototype.hasOwnProperty.call(preset, 'name')
})), [
  { id: 'default-0930-1700', start: '09:30', end: '17:00', deductBreak: true, hasName: false },
  { id: 'default-1130-1530', start: '11:30', end: '15:30', deductBreak: false, hasName: false },
  { id: 'default-1400-1700', start: '14:00', end: '17:00', deductBreak: false, hasName: false },
  { id: 'default-0830-2030', start: '08:30', end: '20:30', deductBreak: true, hasName: false },
  { id: 'default-0830-2100', start: '08:30', end: '21:00', deductBreak: true, hasName: false }
])
assert.deepStrictEqual(defaultPresetStore.settings.presets.map(worktime.formatPresetOption), [
  '09:30-17:00 · 扣休',
  '11:30-15:30 · 不扣',
  '14:00-17:00 · 不扣',
  '08:30-20:30 · 扣休',
  '08:30-21:00 · 扣休'
])
assert.strictEqual(worktime.seedDefaultPresets(defaultPresetStore).settings.presets.length, 5)

const customPresetStore = worktime.upsertPreset(worktime.createDefaultStore(), {
  id: 'custom',
  name: '自定义',
  start: '10:00',
  end: '18:00',
  deductBreak: false
})
assert.deepStrictEqual(worktime.seedDefaultPresets(customPresetStore).settings.presets.map((preset) => preset.id), ['custom'])
assert.strictEqual(Object.prototype.hasOwnProperty.call(customPresetStore.settings.presets[0], 'name'), false)

let deletedPresetStore = worktime.deletePreset(defaultPresetStore, 'default-0930-1700')
deletedPresetStore = worktime.deletePreset(deletedPresetStore, 'default-1130-1530')
deletedPresetStore = worktime.deletePreset(deletedPresetStore, 'default-1400-1700')
deletedPresetStore = worktime.deletePreset(deletedPresetStore, 'default-0830-2030')
deletedPresetStore = worktime.deletePreset(deletedPresetStore, 'default-0830-2100')
assert.strictEqual(deletedPresetStore.settings.defaultPresetsSeeded, true)
assert.strictEqual(deletedPresetStore.settings.presets.length, 0)
assert.strictEqual(worktime.normalizeStore(deletedPresetStore).settings.presets.length, 0)

withMockWx({}, (backing) => {
  const loaded = storage.loadStore()
  assert.strictEqual(loaded.settings.defaultPresetsSeeded, true)
  assert.strictEqual(loaded.settings.presets.length, 5)
  assert.strictEqual(backing[worktime.STORAGE_KEY].settings.presets.length, 5)
})

withMockWx({
  [worktime.STORAGE_KEY]: {
    version: worktime.STORE_VERSION,
    settings: Object.assign({}, worktime.DEFAULT_SETTINGS, {
      defaultPresetsSeeded: true,
      presets: [
        { id: 'default-0930-1700', start: '09:30', end: '17:00', deductBreak: true },
        { id: 'default-1130-1530', start: '11:30', end: '15:30', deductBreak: false },
        { id: 'default-1400-1700', start: '14:00', end: '17:00', deductBreak: false }
      ]
    }),
    months: {}
  }
}, (backing) => {
  const loaded = storage.loadStore()
  assert.deepStrictEqual(loaded.settings.presets.map((preset) => preset.id), [
    'default-0930-1700',
    'default-1130-1530',
    'default-1400-1700',
    'default-0830-2030',
    'default-0830-2100'
  ])
  assert.strictEqual(backing[worktime.STORAGE_KEY].settings.presets.length, 5)
})

withMockWx({
  [worktime.STORAGE_KEY]: {
    version: 2,
    settings: Object.assign({}, worktime.DEFAULT_SETTINGS, { presets: [] }),
    months: {}
  }
}, (backing) => {
  const loaded = storage.loadStore()
  assert.strictEqual(loaded.version, 3)
  assert.strictEqual(loaded.settings.defaultPresetsSeeded, true)
  assert.strictEqual(loaded.settings.presets.length, 0)
  assert.strictEqual(backing[worktime.STORAGE_KEY].settings.presets.length, 0)
})

withMockWx({
  [worktime.STORAGE_KEY]: {
    settings: Object.assign({}, worktime.DEFAULT_SETTINGS, { presets: [] }),
    months: {}
  }
}, () => {
  const loaded = storage.loadStore()
  assert.strictEqual(loaded.version, 3)
  assert.strictEqual(loaded.settings.defaultPresetsSeeded, true)
  assert.strictEqual(loaded.settings.presets.length, 0)
})

assert.strictEqual(worktime.addMonthsClamped('2026-05-31', 1), '2026-06-30')
assert.strictEqual(worktime.addMonthsClamped('2026-03-31', -1), '2026-02-28')
assert.deepStrictEqual(worktime.getWeekRange('2026-05-23'), {
  start: '2026-05-18',
  end: '2026-05-24'
})
assert.deepStrictEqual(worktime.getWeekRange('2026-06-30'), {
  start: '2026-06-29',
  end: '2026-07-05'
})

let store = worktime.createDefaultStore()
store = worktime.setEntry(store, '2026-05-16', { type: 'work', start: '11:00', end: '17:00' })
store = worktime.setEntry(store, '2026-05-17', { type: 'work', start: '09:20', end: '17:00' })
store = worktime.setEntry(store, '2026-05-20', { type: 'rest' })
store = worktime.setEntry(store, '2026-05-22', { type: 'leave' })
store = worktime.setOpeningBalance(store, '2026-05', 14.5 * 60)

const may = worktime.computeLedger(store, '2026-05')
assert.strictEqual(worktime.formatHours(may.monthDeltaMinutes), '-8.5')
assert.strictEqual(worktime.formatHours(may.closingBalanceMinutes), '6')
assert.deepStrictEqual(worktime.buildMonthStats(store, '2026-05'), {
  totalDays: 31,
  recordedCount: 4,
  workCount: 2,
  restCount: 1,
  leaveCount: 1,
  missingCount: 27
})

const june = worktime.computeLedger(store, '2026-06')
assert.strictEqual(worktime.formatHours(june.openingBalanceMinutes), '6')
assert.deepStrictEqual(worktime.buildMonthStats(store, '2026-06'), {
  totalDays: 30,
  recordedCount: 0,
  workCount: 0,
  restCount: 0,
  leaveCount: 0,
  missingCount: 30
})

const exportText = worktime.buildExportText(store, '2026-05-16', '2026-05-22')
assert.strictEqual(exportText, [
  '5.16日  11:00-17:00   -1.5',
  '5.17日  全天',
  '5.20日  本休',
  '5.22日  调休'
].join('\n'))
assert.deepStrictEqual(worktime.buildExportLines(store, '2026-05-16', '2026-05-22'), exportText.split('\n'))
assert.strictEqual(worktime.buildDeltaExportText(store, '2026-05-16', '2026-05-22'), [
  '5.16日  -1.5',
  '5.17日  全天',
  '5.20日  本休',
  '5.22日  调休'
].join('\n'))

store = worktime.upsertPreset(store, {
  id: 'p1',
  name: '全天班',
  start: '09:20',
  end: '17:00',
  deductBreak: true
})
assert.strictEqual(store.settings.presets.length, 1)
assert.deepStrictEqual(worktime.entryFromPreset(store.settings.presets[0], '备注'), {
  type: 'work',
  start: '09:20',
  end: '17:00',
  deductBreak: true,
  presetId: 'p1',
  note: '备注'
})
store = worktime.deletePreset(store, 'p1')
assert.strictEqual(store.settings.presets.length, 0)

const normalizedLegacy = worktime.normalizeStore({
  version: 2,
  settings: {
    presets: [{
      id: 'legacy',
      name: '旧班次',
      start: '09:00',
      end: '17:00',
      deductBreak: true
    }]
  },
  months: {
    '2026-05': {
      entries: {
        '2026-05-01': {
          type: 'work',
          start: '09:00',
          end: '17:00',
          deductBreak: true,
          presetName: '旧班次'
        }
      }
    }
  }
})
assert.strictEqual(Object.prototype.hasOwnProperty.call(normalizedLegacy.settings.presets[0], 'name'), false)
assert.strictEqual(Object.prototype.hasOwnProperty.call(normalizedLegacy.months['2026-05'].entries['2026-05-01'], 'presetName'), false)

const invalidSave = worktime.saveEntry(store, '2026-05-23', { type: 'work', start: '18:00', end: '09:00' })
assert.strictEqual(invalidSave.ok, false)
assert.strictEqual(storage.getStoredEntry(invalidSave.store, '2026-05-23'), null)
const validSave = worktime.saveEntry(store, '2026-05-23', { type: 'work', start: '09:00', end: '17:00' })
assert.strictEqual(validSave.ok, true)
assert.deepStrictEqual(storage.getStoredEntry(validSave.store, '2026-05-23'), {
  type: 'work',
  start: '09:00',
  end: '17:00',
  deductBreak: true,
  note: ''
})

const backupText = storage.serializeBackup(store)
const parsedBackup = storage.parseBackupText(backupText)
assert.strictEqual(parsedBackup.ok, true)
assert.strictEqual(parsedBackup.preview.version, 3)
assert.strictEqual(parsedBackup.preview.monthCount, 1)
assert.strictEqual(parsedBackup.preview.recordCount, 4)
assert.strictEqual(parsedBackup.preview.presetCount, 0)
assert.strictEqual(JSON.parse(backupText).version, 3)
assert.ok(storage.makeBackupFileName().startsWith('备份-'))
assert.strictEqual(storage.makeBackupFileName(new Date('2026-06-03T02:01:00.000Z')), '备份-260603-1001.json')
assert.ok(/^备份-\d{6}-\d{4}\.json$/.test(storage.makeBackupFileName()))
assert.strictEqual(storage.parseBackupText('not json').ok, false)
assert.strictEqual(storage.parseBackupText(JSON.stringify({ hello: 'world' })).ok, false)

const v2Backup = storage.parseBackupText(JSON.stringify({
  format: storage.BACKUP_FORMAT,
  version: 2,
  exportedAt: '2026-05-24T00:00:00.000Z',
  store: {
    version: 2,
    settings: Object.assign({}, worktime.DEFAULT_SETTINGS, { presets: [] }),
    months: {}
  }
}))
assert.strictEqual(v2Backup.ok, true)
assert.strictEqual(v2Backup.store.version, 3)
assert.strictEqual(v2Backup.store.settings.defaultPresetsSeeded, true)
assert.strictEqual(v2Backup.store.settings.presets.length, 0)

const unversionedBackup = storage.parseBackupText(JSON.stringify({
  format: storage.BACKUP_FORMAT,
  store: {
    settings: Object.assign({}, worktime.DEFAULT_SETTINGS, { presets: [] }),
    months: {}
  }
}))
assert.strictEqual(unversionedBackup.ok, true)
assert.strictEqual(unversionedBackup.store.settings.defaultPresetsSeeded, true)
assert.strictEqual(unversionedBackup.store.settings.presets.length, 0)

console.log('worktime tests passed')
