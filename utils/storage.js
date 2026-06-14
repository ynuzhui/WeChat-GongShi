const worktime = require('./worktime')

const BACKUP_FORMAT = 'worktime-miniapp-backup'
const BACKUP_VERSION = 4

function safeCall(fn, fallback) {
  try {
    return fn()
  } catch (error) {
    return fallback
  }
}

function textValue(value) {
  return value === null || value === undefined ? '' : String(value)
}

function getWxApi(input) {
  if (input) {
    return input
  }
  if (typeof wx === 'undefined') {
    return null
  }
  return wx
}

function getClientInfo(wxApiInput) {
  const wxApi = getWxApi(wxApiInput)
  if (!wxApi) {
    return {
      device: {},
      os: {},
      wechat: {},
      miniProgram: {}
    }
  }

  const systemInfo = safeCall(() => (
    typeof wxApi.getSystemInfoSync === 'function' ? wxApi.getSystemInfoSync() : {}
  ), {}) || {}
  const deviceInfo = safeCall(() => (
    typeof wxApi.getDeviceInfo === 'function' ? wxApi.getDeviceInfo() : {}
  ), {}) || {}
  const appBaseInfo = safeCall(() => (
    typeof wxApi.getAppBaseInfo === 'function' ? wxApi.getAppBaseInfo() : {}
  ), {}) || {}
  const accountInfo = safeCall(() => (
    typeof wxApi.getAccountInfoSync === 'function' ? wxApi.getAccountInfoSync() : {}
  ), {}) || {}
  const miniProgram = accountInfo.miniProgram || {}

  const platform = deviceInfo.platform || systemInfo.platform
  const system = deviceInfo.system || systemInfo.system

  return {
    device: {
      brand: textValue(deviceInfo.brand || systemInfo.brand),
      model: textValue(deviceInfo.model || systemInfo.model),
      platform: textValue(platform),
      system: textValue(system)
    },
    os: {
      platform: textValue(platform),
      system: textValue(system)
    },
    wechat: {
      version: textValue(appBaseInfo.version || systemInfo.version),
      SDKVersion: textValue(appBaseInfo.SDKVersion || systemInfo.SDKVersion),
      language: textValue(appBaseInfo.language || systemInfo.language)
    },
    miniProgram: {
      appId: textValue(miniProgram.appId),
      version: textValue(miniProgram.version),
      envVersion: textValue(miniProgram.envVersion)
    }
  }
}

function notifyStoreSaved(store) {
  if (typeof wx === 'undefined' || !wx) {
    return
  }
  try {
    const remoteBackup = require('./remoteBackup')
    // 默认只更新本地数据修订，不触发网络推送；远端推送统一在退出时进行
    if (remoteBackup && typeof remoteBackup.markLocalChange === 'function') {
      remoteBackup.markLocalChange(store)
    }
  } catch (error) {
    console.warn('[storage] mark local change failed:', error)
  }
}

function writeStore(store) {
  try {
    const normalized = worktime.normalizeStore(store)
    wx.setStorageSync(worktime.STORAGE_KEY, normalized)
    return normalized
  } catch (error) {
    console.error('[storage] writeStore failed:', error)
    throw error
  }
}

function tryWriteStore(store) {
  try {
    return writeStore(store)
  } catch (error) {
    console.warn('[storage] tryWriteStore fallback to memory:', error)
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
    console.warn('[storage] loadStore failed, creating default:', error)
    return tryWriteStore(worktime.seedDefaultPresets(worktime.createDefaultStore()))
  }
}

function saveStore(store) {
  const saved = writeStore(store)
  notifyStoreSaved(saved)
  return saved
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
  try {
    wx.setStorageSync(worktime.PENDING_RECORD_DATE_KEY, dateKey)
  } catch (error) {
    console.error('[storage] setPendingRecordDate failed:', error)
  }
}

function takePendingRecordDate() {
  try {
    const dateKey = wx.getStorageSync(worktime.PENDING_RECORD_DATE_KEY)
    if (dateKey) {
      wx.removeStorageSync(worktime.PENDING_RECORD_DATE_KEY)
    }
    return dateKey || ''
  } catch (error) {
    console.error('[storage] takePendingRecordDate failed:', error)
    return ''
  }
}

function buildBackup(store, options) {
  const settings = options || {}
  const timeSource = settings.now || settings.exportedAt || new Date()
  const exportedAt = worktime.formatBeijingDateTime(timeSource)
  const fileName = settings.fileName || makeBackupFileName(timeSource)
  const backup = {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    fileName,
    exportedAt,
    client: settings.client || getClientInfo(settings.wxApi),
    store: worktime.normalizeStore(store)
  }
  if (settings.remote) {
    backup.remote = settings.remote
  }
  if (settings.revision) {
    backup.revision = settings.revision
  }
  return {
    format: backup.format,
    version: backup.version,
    fileName: backup.fileName,
    exportedAt: backup.exportedAt,
    client: backup.client,
    store: backup.store,
    remote: backup.remote,
    revision: backup.revision
  }
}

function serializeBackup(store) {
  return JSON.stringify(buildBackup(store), null, 2)
}

function buildStorePreview(store, exportedAt, backup) {
  const normalized = worktime.normalizeStore(store)
  return {
    version: normalized.version,
    exportedAt: exportedAt || '',
    fileName: backup && backup.fileName ? backup.fileName : '',
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
    preview: buildStorePreview(store, parsed.exportedAt, parsed),
    backup: parsed
  }
}

function makeBackupFileName(input) {
  const stamp = worktime.formatBeijingCompactSecondStamp(input)
  return `backup-${stamp}.json`
}

function makeLegacyBackupFileName(input) {
  const stamp = worktime.formatBeijingCompactMinuteStamp(input)
  return `备份-${stamp}.json`
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
  getClientInfo,
  makeBackupFileName,
  makeLegacyBackupFileName
}
