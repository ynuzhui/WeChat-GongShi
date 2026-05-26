const worktime = require('./worktime')

const BACKUP_FORMAT = 'worktime-miniapp-backup'
const BACKUP_VERSION = 3

function writeStore(store) {
  const normalized = worktime.normalizeStore(store)
  wx.setStorageSync(worktime.STORAGE_KEY, normalized)
  return normalized
}

function tryWriteStore(store) {
  try {
    return writeStore(store)
  } catch (error) {
    return worktime.normalizeStore(store)
  }
}

function loadStore() {
  try {
    const raw = wx.getStorageSync(worktime.STORAGE_KEY)
    const normalized = worktime.normalizeStore(raw)
    const isStoredObject = raw && typeof raw === 'object'
    const isLegacyStore = isStoredObject && (typeof raw.version !== 'number' || raw.version < worktime.STORE_VERSION)

    if (isLegacyStore) {
      normalized.settings.defaultPresetsSeeded = true
      return tryWriteStore(normalized)
    }

    if (!normalized.settings.defaultPresetsSeeded && normalized.settings.presets.length === 0) {
      return tryWriteStore(worktime.seedDefaultPresets(normalized))
    }

    return tryWriteStore(worktime.ensureDefaultPresets(normalized))
  } catch (error) {
    return tryWriteStore(worktime.seedDefaultPresets(worktime.createDefaultStore()))
  }
}

function saveStore(store) {
  return writeStore(store)
}

function getStoredEntry(store, dateKey) {
  const normalized = worktime.normalizeStore(store)
  const monthKey = worktime.toMonthKey(dateKey)
  const month = normalized.months[monthKey]
  if (!month || !month.entries) {
    return null
  }
  return month.entries[dateKey] || null
}

function makeDraftEntry(store, dateKey) {
  const saved = getStoredEntry(store, dateKey)
  if (saved) {
    return Object.assign({ note: '' }, saved)
  }
  return worktime.getDefaultWorkEntry(worktime.normalizeStore(store).settings)
}

function setPendingRecordDate(dateKey) {
  wx.setStorageSync(worktime.PENDING_RECORD_DATE_KEY, dateKey)
}

function takePendingRecordDate() {
  try {
    const dateKey = wx.getStorageSync(worktime.PENDING_RECORD_DATE_KEY)
    if (dateKey) {
      wx.removeStorageSync(worktime.PENDING_RECORD_DATE_KEY)
    }
    return dateKey || ''
  } catch (error) {
    return ''
  }
}

function buildBackup(store) {
  return {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    exportedAt: new Date().toISOString(),
    store: worktime.normalizeStore(store)
  }
}

function serializeBackup(store) {
  return JSON.stringify(buildBackup(store), null, 2)
}

function buildStorePreview(store, exportedAt) {
  const normalized = worktime.normalizeStore(store)
  return {
    version: normalized.version,
    exportedAt: exportedAt || '',
    monthCount: Object.keys(normalized.months).length,
    recordCount: worktime.countRecords(normalized),
    presetCount: normalized.settings.presets.length
  }
}

function parseBackupText(text) {
  let parsed
  try {
    parsed = JSON.parse(text)
  } catch (error) {
    return {
      ok: false,
      message: '文件不是有效的 JSON'
    }
  }

  if (!parsed || parsed.format !== BACKUP_FORMAT || !parsed.store) {
    return {
      ok: false,
      message: '这不是本应用导出的备份文件'
    }
  }

  const backupVersion = typeof parsed.version === 'number' ? parsed.version : 1

  if (backupVersion > BACKUP_VERSION) {
    return {
      ok: false,
      message: '备份版本过新，当前小程序暂不支持'
    }
  }

  const store = worktime.normalizeStore(parsed.store)
  if (backupVersion < worktime.STORE_VERSION) {
    store.settings.defaultPresetsSeeded = true
  }
  return {
    ok: true,
    store,
    preview: buildStorePreview(store, parsed.exportedAt)
  }
}

function makeBackupFileName(input) {
  const stamp = worktime.formatBeijingMinuteStamp(input)
  return `工时清单备份-${stamp}.json`
}

module.exports = {
  BACKUP_FORMAT,
  BACKUP_VERSION,
  loadStore,
  saveStore,
  getStoredEntry,
  makeDraftEntry,
  setPendingRecordDate,
  takePendingRecordDate,
  buildBackup,
  serializeBackup,
  parseBackupText,
  buildStorePreview,
  makeBackupFileName
}
