const worktime = require('./worktime')
const storage = require('./storage')

const API_BASE_URL = 'https://wxgs.yunzhui.cn'
const SESSION_KEY = 'worktime.remoteBackup.session'
const STATUS_KEY = 'worktime.remoteBackup.status'
const LAST_HASH_KEY = 'worktime.remoteBackup.lastHash'
const DEVICE_ID_KEY = 'worktime.remoteBackup.deviceId'
const LOCAL_REV_KEY = 'worktime.remoteBackup.localRev'
const BASE_UPDATED_KEY = 'worktime.remoteBackup.baseUpdatedAt'
const DEFAULT_DEBOUNCE_MS = 5000
const TOKEN_REFRESH_SKEW_MS = 60 * 1000
// 退出自动推送的最小间隔，用于限制备份频率（手动同步不受限）
const MIN_AUTO_PUSH_INTERVAL_MS = 5 * 60 * 1000

let pendingStore = null
let pendingTimer = null
let inFlight = null

function looksLikeWxApi(input) {
  return !!(input && typeof input === 'object' && (
    typeof input.request === 'function' ||
    typeof input.login === 'function' ||
    typeof input.getStorageSync === 'function' ||
    typeof input.setStorageSync === 'function' ||
    typeof input.removeStorageSync === 'function' ||
    typeof input.getSystemInfoSync === 'function' ||
    typeof input.getAccountInfoSync === 'function'
  ))
}

function getWxApi(input) {
  if (looksLikeWxApi(input)) {
    return input
  }
  if (typeof wx !== 'undefined') {
    return wx
  }
  if (typeof globalThis !== 'undefined' && looksLikeWxApi(globalThis.wx)) {
    return globalThis.wx
  }
  return null
}

function normalizeErrorMessage(value, fallback) {
  if (typeof value === 'string') {
    const text = value.trim()
    return text && text !== '[object Object]' ? value : fallback
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value)
  }
  if (!value || typeof value !== 'object') {
    return fallback
  }
  if (typeof value.message === 'string' && value.message) {
    return normalizeErrorMessage(value.message, fallback)
  }
  if (typeof value.errMsg === 'string' && value.errMsg) {
    return normalizeErrorMessage(value.errMsg, fallback)
  }
  if (typeof value.error === 'string' && value.error) {
    return normalizeErrorMessage(value.error, fallback)
  }
  if (typeof value.msg === 'string' && value.msg) {
    return normalizeErrorMessage(value.msg, fallback)
  }
  if (value.data) {
    return normalizeErrorMessage(value.data, fallback)
  }
  if (value.statusCode) {
    return `请求失败 ${value.statusCode}`
  }
  return fallback
}

function createRemoteError(value, fallback) {
  const error = value instanceof Error ? value : new Error(normalizeErrorMessage(value, fallback))
  const message = normalizeErrorMessage(error.message, normalizeErrorMessage(value, fallback))
  if (!error.message || error.message === '[object Object]') {
    error.message = message
  }
  if (value && typeof value === 'object') {
    if (value.statusCode) {
      error.statusCode = value.statusCode
    }
    if (value.data) {
      error.data = value.data
    }
  }
  return error
}

function canUseRemote(wxApi) {
  return !!(wxApi && typeof wxApi.request === 'function' && typeof wxApi.login === 'function')
}

function readStorage(wxApi, key, fallback) {
  try {
    return wxApi.getStorageSync(key) || fallback
  } catch (error) {
    return fallback
  }
}

function writeStorage(wxApi, key, value) {
  try {
    wxApi.setStorageSync(key, value)
  } catch (error) {
    console.warn('[remoteBackup] write storage failed:', error)
  }
}

function removeStorage(wxApi, key) {
  try {
    wxApi.removeStorageSync(key)
  } catch (error) {
    console.warn('[remoteBackup] remove storage failed:', error)
  }
}

function hashText(text) {
  let hash = 2166136261
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index)
    hash += (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24)
  }
  return (hash >>> 0).toString(16)
}

function getStoreHash(store) {
  return hashText(JSON.stringify(worktime.normalizeStore(store)))
}

// 设备标识：首次随机生成并持久化，用于多端冲突时区分来源
function getDeviceId(wxApi) {
  let id = readStorage(wxApi, DEVICE_ID_KEY, '')
  if (!id) {
    id = `dev-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e9).toString(36)}`
    writeStorage(wxApi, DEVICE_ID_KEY, id)
  }
  return id
}

function getDeviceLabel(wxApi) {
  try {
    const client = storage.getClientInfo(wxApi)
    const device = client.device || {}
    const mini = client.miniProgram || {}
    const label = [device.brand, device.model, device.platform || device.system]
      .filter(Boolean)
      .join(' ')
      .trim()
    if (label) {
      return label
    }
    return mini.envVersion ? `小程序 ${mini.envVersion}` : '未知设备'
  } catch (error) {
    return '未知设备'
  }
}

// 本地数据修订：仅在内容哈希变化时更新 updatedAt，避免与去重哈希耦合
function getLocalRevision(wxApi) {
  const rev = readStorage(wxApi, LOCAL_REV_KEY, null)
  if (rev && typeof rev === 'object' && typeof rev.updatedAt === 'number') {
    return rev
  }
  return { hash: '', updatedAt: 0 }
}

function markLocalChange(store, options) {
  const settings = options || {}
  const wxApi = getWxApi(settings.wxApi)
  if (!wxApi || typeof wxApi.getStorageSync !== 'function') {
    return null
  }
  const hash = getStoreHash(store)
  const current = getLocalRevision(wxApi)
  if (current.hash === hash && current.updatedAt) {
    return current
  }
  const next = { hash, updatedAt: Date.now() }
  writeStorage(wxApi, LOCAL_REV_KEY, next)
  return next
}

function getBaseUpdatedAt(wxApi) {
  const value = Number(readStorage(wxApi, BASE_UPDATED_KEY, 0))
  return Number.isFinite(value) ? value : 0
}

function setBaseUpdatedAt(wxApi, value) {
  writeStorage(wxApi, BASE_UPDATED_KEY, Number(value) || 0)
}

// 采纳云端状态（恢复/保留云端后调用）：对齐本地修订、基线与去重哈希
function adoptRemoteState(store, options) {
  const settings = options || {}
  const wxApi = getWxApi(settings.wxApi)
  if (!wxApi || typeof wxApi.setStorageSync !== 'function') {
    return null
  }
  const normalized = worktime.normalizeStore(store)
  const hash = getStoreHash(normalized)
  const updatedAt = Number(settings.updatedAt) || Date.now()
  writeStorage(wxApi, LAST_HASH_KEY, hash)
  writeStorage(wxApi, LOCAL_REV_KEY, { hash, updatedAt })
  setBaseUpdatedAt(wxApi, updatedAt)
  return setStatus(wxApi, {
    state: 'success',
    message: '已恢复云端备份',
    lastStoreHash: hash,
    lastSyncedAt: new Date().toISOString(),
    cloud: null
  })
}

function normalizeUrl(path) {
  return `${API_BASE_URL}${path}`
}

function parseResponseData(data) {
  if (typeof data !== 'string') {
    return data || {}
  }
  try {
    return JSON.parse(data)
  } catch (error) {
    return { ok: false, message: data }
  }
}

function request(wxApi, options) {
  return new Promise((resolve, reject) => {
    wxApi.request(Object.assign({}, options, {
      success: (result) => {
        const data = parseResponseData(result.data)
        const statusCode = result.statusCode || 0
        if (statusCode >= 200 && statusCode < 300) {
          resolve(Object.assign({}, result, { data }))
          return
        }
        const error = new Error(normalizeErrorMessage(data.message || data.error, `请求失败 ${statusCode}`))
        error.statusCode = statusCode
        error.data = data
        reject(error)
      },
      fail: (error) => reject(createRemoteError(error, '网络请求失败'))
    }))
  })
}

function login(wxApi) {
  return new Promise((resolve, reject) => {
    wxApi.login({
      success: (result) => {
        if (!result || !result.code) {
          reject(new Error('微信登录没有返回 code'))
          return
        }
        resolve(result.code)
      },
      fail: (error) => reject(createRemoteError(error, '微信登录失败'))
    })
  })
}

function getSession(wxApi, options) {
  const settings = options || {}
  if (!canUseRemote(wxApi)) {
    return Promise.reject(new Error('当前环境不支持远端备份'))
  }

  const cached = readStorage(wxApi, SESSION_KEY, null)
  const now = Date.now()
  if (!settings.forceRefresh && cached && cached.token && cached.expiresAt > now + TOKEN_REFRESH_SKEW_MS) {
    return Promise.resolve(cached)
  }

  return login(wxApi)
    .then((code) => request(wxApi, {
      url: normalizeUrl('/api/session'),
      method: 'POST',
      header: {
        'content-type': 'application/json'
      },
      data: {
        code
      }
    }))
    .then((response) => {
      const data = response.data || {}
      if (!data.ok || !data.token) {
        throw new Error(normalizeErrorMessage(data.message || data.error, '远端登录失败'))
      }
      const session = {
        token: data.token,
        expiresAt: data.expiresAt || (Date.now() + 2 * 60 * 60 * 1000),
        openidHint: data.openidHint || ''
      }
      writeStorage(wxApi, SESSION_KEY, session)
      return session
    })
}

function setStatus(wxApi, patch) {
  const current = readStorage(wxApi, STATUS_KEY, {})
  const next = Object.assign({}, current, patch, {
    updatedAt: new Date().toISOString()
  })
  writeStorage(wxApi, STATUS_KEY, next)
  return next
}

function getStatus(wxApiInput) {
  const wxApi = getWxApi(wxApiInput)
  if (!wxApi || !wxApi.getStorageSync) {
    return {}
  }
  return readStorage(wxApi, STATUS_KEY, {})
}

function uploadBackup(store, options) {
  const settings = options || {}
  const wxApi = getWxApi(settings.wxApi)
  if (!canUseRemote(wxApi)) {
    return Promise.resolve({
      ok: false,
      skipped: true,
      message: '当前环境不支持远端备份'
    })
  }

  const normalizedStore = worktime.normalizeStore(store)
  const storeHash = getStoreHash(normalizedStore)
  if (!settings.force && readStorage(wxApi, LAST_HASH_KEY, '') === storeHash) {
    const status = setStatus(wxApi, {
      state: 'success',
      message: '远端备份已是最新',
      lastStoreHash: storeHash
    })
    return Promise.resolve({
      ok: true,
      skipped: true,
      status
    })
  }

  // 确保本地修订存在，构造本次上传的数据修订信息
  const localRev = markLocalChange(normalizedStore, { wxApi }) || getLocalRevision(wxApi)
  const revision = {
    updatedAt: localRev.updatedAt || Date.now(),
    deviceId: getDeviceId(wxApi),
    deviceLabel: getDeviceLabel(wxApi)
  }
  const baseUpdatedAt = getBaseUpdatedAt(wxApi)
  const overwrite = settings.overwrite === true

  setStatus(wxApi, {
    state: 'syncing',
    message: '正在同步远端备份'
  })

  function postWithSession(forceRefresh) {
    return getSession(wxApi, { forceRefresh })
      .then((session) => {
        const backup = storage.buildBackup(normalizedStore, {
          wxApi,
          client: storage.getClientInfo(wxApi),
          revision
        })
        return request(wxApi, {
          url: normalizeUrl('/api/backups'),
          method: 'POST',
          header: {
            authorization: `Bearer ${session.token}`,
            'content-type': 'application/json'
          },
          data: {
            backup,
            baseUpdatedAt,
            overwrite
          }
        })
      })
  }

  return postWithSession(false)
    .catch((error) => {
      if (error && error.statusCode === 401) {
        removeStorage(wxApi, SESSION_KEY)
        return postWithSession(true)
      }
      throw error
    })
    .then((response) => {
      const data = response.data || {}
      if (!data.ok) {
        throw new Error(normalizeErrorMessage(data.message || data.error, '远端备份失败'))
      }
      writeStorage(wxApi, LAST_HASH_KEY, storeHash)
      setBaseUpdatedAt(wxApi, revision.updatedAt)
      const status = setStatus(wxApi, {
        state: 'success',
        message: data.message || '远端备份已更新',
        lastSyncedAt: new Date().toISOString(),
        lastStoreHash: storeHash,
        fileName: data.backup && data.backup.fileName ? data.backup.fileName : '',
        backupCount: data.backupCount || 0,
        cloud: null
      })
      return Object.assign({ ok: true, status }, data)
    })
    .catch((error) => {
      // 多端冲突：云端数据比本地基线更新，交由用户手动选择保留哪一端
      if (error && error.statusCode === 409 && error.data && error.data.conflict) {
        const cloud = error.data.cloud || {}
        const message = normalizeErrorMessage(error.data.message, '云端存在更新的数据，请选择保留哪一端')
        const status = setStatus(wxApi, {
          state: 'conflict',
          message,
          cloud
        })
        return {
          ok: false,
          conflict: true,
          cloud,
          status,
          message
        }
      }
      const message = normalizeErrorMessage(error, '远端备份失败')
      const status = setStatus(wxApi, {
        state: 'failed',
        message
      })
      return {
        ok: false,
        status,
        message
      }
    })
}

function scheduleBackup(store, options) {
  const settings = options || {}
  const wxApi = getWxApi(settings.wxApi)
  if (!canUseRemote(wxApi)) {
    return {
      ok: false,
      skipped: true,
      message: '当前环境不支持远端备份'
    }
  }

  const normalizedStore = worktime.normalizeStore(store)
  const storeHash = getStoreHash(normalizedStore)
  if (!settings.force && readStorage(wxApi, LAST_HASH_KEY, '') === storeHash) {
    setStatus(wxApi, {
      state: 'success',
      message: '远端备份已是最新',
      lastStoreHash: storeHash
    })
    return {
      ok: true,
      skipped: true
    }
  }

  pendingStore = normalizedStore
  if (pendingTimer && typeof clearTimeout === 'function') {
    clearTimeout(pendingTimer)
  }
  setStatus(wxApi, {
    state: 'pending',
    message: '等待同步远端备份'
  })
  pendingTimer = setTimeout(() => {
    pendingTimer = null
    flushBackup({
      wxApi,
      reason: settings.reason
    })
  }, settings.debounceMs || DEFAULT_DEBOUNCE_MS)

  return {
    ok: true,
    scheduled: true
  }
}

function flushBackup(options) {
  const settings = options || {}
  const wxApi = getWxApi(settings.wxApi)
  if (!canUseRemote(wxApi)) {
    return Promise.resolve({
      ok: false,
      skipped: true,
      message: '当前环境不支持远端备份'
    })
  }
  if (pendingTimer && typeof clearTimeout === 'function') {
    clearTimeout(pendingTimer)
    pendingTimer = null
  }
  const store = settings.store || pendingStore || storage.loadStore()
  pendingStore = null
  if (inFlight) {
    return inFlight
  }
  inFlight = uploadBackup(store, settings).then((result) => {
    inFlight = null
    return result
  }).catch((error) => {
    inFlight = null
    throw error
  })
  return inFlight
}

// 退出时推送：非强制 + 节流 + 内容未变跳过；冲突仅记录状态不覆盖
function flushOnExit(options) {
  const settings = options || {}
  const wxApi = getWxApi(settings.wxApi)
  if (!canUseRemote(wxApi)) {
    return Promise.resolve({
      ok: false,
      skipped: true,
      message: '当前环境不支持远端备份'
    })
  }
  const status = readStorage(wxApi, STATUS_KEY, {})
  const lastSyncedAt = status && status.lastSyncedAt ? Date.parse(status.lastSyncedAt) : 0
  const interval = settings.minIntervalMs || MIN_AUTO_PUSH_INTERVAL_MS
  if (!settings.force && lastSyncedAt && (Date.now() - lastSyncedAt) < interval) {
    return Promise.resolve({
      ok: true,
      skipped: true,
      throttled: true
    })
  }
  return flushBackup({
    wxApi,
    store: settings.store,
    reason: settings.reason || 'appHide'
  })
}

function listBackups(options) {
  const settings = options || {}
  const wxApi = getWxApi(settings.wxApi)
  if (!canUseRemote(wxApi)) {
    return Promise.resolve({
      ok: false,
      backups: [],
      message: '当前环境不支持远端备份'
    })
  }
  return getSession(wxApi)
    .then((session) => request(wxApi, {
      url: normalizeUrl('/api/backups'),
      method: 'GET',
      header: {
        authorization: `Bearer ${session.token}`
      }
    }))
    .then((response) => response.data)
    .catch((error) => ({
      ok: false,
      backups: [],
      message: normalizeErrorMessage(error, '获取远端备份列表失败')
    }))
}

function downloadBackup(fileName, options) {
  const settings = options || {}
  const wxApi = getWxApi(settings.wxApi)
  if (!canUseRemote(wxApi)) {
    return Promise.resolve({
      ok: false,
      message: '当前环境不支持远端备份'
    })
  }
  return getSession(wxApi)
    .then((session) => request(wxApi, {
      url: normalizeUrl(`/api/backups/${encodeURIComponent(fileName)}`),
      method: 'GET',
      header: {
        authorization: `Bearer ${session.token}`
      }
    }))
    .then((response) => response.data)
    .catch((error) => ({
      ok: false,
      message: normalizeErrorMessage(error, '下载远端备份失败')
    }))
}

module.exports = {
  API_BASE_URL,
  DEFAULT_DEBOUNCE_MS,
  MIN_AUTO_PUSH_INTERVAL_MS,
  SESSION_KEY,
  STATUS_KEY,
  LAST_HASH_KEY,
  DEVICE_ID_KEY,
  LOCAL_REV_KEY,
  BASE_UPDATED_KEY,
  getStoreHash,
  getStatus,
  getSession,
  getDeviceId,
  getDeviceLabel,
  getLocalRevision,
  markLocalChange,
  getBaseUpdatedAt,
  setBaseUpdatedAt,
  adoptRemoteState,
  uploadBackup,
  scheduleBackup,
  flushBackup,
  flushOnExit,
  listBackups,
  downloadBackup
}
