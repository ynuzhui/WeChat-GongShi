const assert = require('assert')
const worktime = require('../utils/worktime')

function resetModule(modulePath) {
  delete require.cache[require.resolve(modulePath)]
}

function createWxMock(options) {
  const settings = options || {}
  const storage = {}
  const calls = {
    login: 0,
    session: 0,
    upload: 0,
    list: 0,
    download: 0
  }

  const wx = {
    getStorageSync(key) {
      return storage[key] || ''
    },
    setStorageSync(key, value) {
      storage[key] = value
    },
    removeStorageSync(key) {
      delete storage[key]
    },
    login(options) {
      calls.login += 1
      options.success({ code: `code-${calls.login}` })
    },
    getSystemInfoSync() {
      return {
        platform: 'ios',
        system: 'iOS 18.0',
        version: '8.0.50',
        SDKVersion: '3.6.0'
      }
    },
    getAccountInfoSync() {
      return {
        miniProgram: {
          appId: 'wx-test',
          version: '1.2.3',
          envVersion: 'develop'
        }
      }
    },
    request(options) {
      const url = options.url
      if (url.endsWith('/api/session')) {
        calls.session += 1
        options.success({
          statusCode: 200,
          data: {
            ok: true,
            token: settings.nextToken || `token-${calls.session}`,
            expiresAt: Date.now() + 60 * 60 * 1000
          }
        })
        return
      }
      if (url.endsWith('/api/backups') && options.method === 'POST') {
        calls.upload += 1
        const body = options.data || {}
        if (settings.failFirstUpload401 && calls.upload === 1) {
          options.success({
            statusCode: 401,
            data: { ok: false, message: 'Unauthorized' }
          })
          return
        }
        if (settings.failUploadWithObject) {
          options.fail({ detail: { reason: 'offline' } })
          return
        }
        if (settings.conflictOnUpload && body.overwrite !== true) {
          options.success({
            statusCode: 409,
            data: {
              ok: false,
              conflict: true,
              message: '云端存在更新的数据',
              cloud: {
                updatedAt: Date.now(),
                deviceLabel: '平板',
                fileName: 'backup-260610-120000.json',
                savedAt: '2026-06-10T12:00:00+08:00'
              }
            }
          })
          return
        }
        options.success({
          statusCode: 200,
          data: {
            ok: true,
            backup: { fileName: `backup-${calls.upload}.json` },
            backupCount: 1
          }
        })
        return
      }
      if (url.endsWith('/api/backups') && options.method === 'GET') {
        calls.list += 1
        if (settings.failListWithObject) {
          options.fail({ errMsg: 'list failed' })
          return
        }
        options.success({
          statusCode: 200,
          data: {
            ok: true,
            backups: [{ fileName: 'backup-260610-162205.json' }]
          }
        })
        return
      }
      if (url.indexOf('/api/backups/') !== -1 && options.method === 'GET') {
        calls.download += 1
        options.success({
          statusCode: 200,
          data: {
            ok: true,
            backup: {
              format: 'worktime-miniapp-backup',
              version: 4,
              store: worktime.createDefaultStore()
            }
          }
        })
        return
      }
      options.fail({ errMsg: `unexpected request ${url}` })
    }
  }

  return {
    wx,
    calls,
    storage
  }
}

async function main() {
  const previousWx = global.wx
  const previousSetTimeout = global.setTimeout
  const previousClearTimeout = global.clearTimeout

  global.setTimeout = (callback) => {
    callback()
    return 1
  }
  global.clearTimeout = () => {}

  try {
    resetModule('../utils/remoteBackup')
    const remoteBackup = require('../utils/remoteBackup')
    const mock = createWxMock()
    global.wx = mock.wx

    let store = worktime.createDefaultStore()
    store = worktime.setEntry(store, '2026-06-10', {
      type: 'work',
      start: '09:30',
      end: '17:00'
    })

    const first = await remoteBackup.uploadBackup(store, { wxApi: mock.wx })
    assert.strictEqual(first.ok, true)
    assert.strictEqual(mock.calls.login, 1)
    assert.strictEqual(mock.calls.session, 1)
    assert.strictEqual(mock.calls.upload, 1)
    assert.strictEqual(remoteBackup.getStatus(mock.wx).state, 'success')

    const second = await remoteBackup.uploadBackup(store, { wxApi: mock.wx })
    assert.strictEqual(second.skipped, true)
    assert.strictEqual(mock.calls.upload, 1)

    const list = await remoteBackup.listBackups({ wxApi: mock.wx })
    assert.strictEqual(list.ok, true)
    assert.strictEqual(list.backups.length, 1)
    mock.storage[remoteBackup.STATUS_KEY] = {
      state: 'success',
      message: '远端备份已更新'
    }
    assert.strictEqual(remoteBackup.getStatus({
      detail: {},
      currentTarget: {}
    }).state, 'success')

    const download = await remoteBackup.downloadBackup('backup-260610-162205.json', { wxApi: mock.wx })
    assert.strictEqual(download.ok, true)
    assert.strictEqual(download.backup.version, 4)

    resetModule('../utils/remoteBackup')
    const retryRemoteBackup = require('../utils/remoteBackup')
    const retryMock = createWxMock({ failFirstUpload401: true, nextToken: 'fresh-token' })
    global.wx = retryMock.wx
    retryMock.storage[retryRemoteBackup.SESSION_KEY] = {
      token: 'stale-token',
      expiresAt: Date.now() + 60 * 60 * 1000
    }
    const retry = await retryRemoteBackup.uploadBackup(store, { wxApi: retryMock.wx, force: true })
    assert.strictEqual(retry.ok, true)
    assert.strictEqual(retryMock.calls.upload, 2)
    assert.strictEqual(retryMock.calls.login, 1)
    assert.strictEqual(retryMock.calls.session, 1)

    resetModule('../utils/remoteBackup')
    const failRemoteBackup = require('../utils/remoteBackup')
    const failMock = createWxMock({ failListWithObject: true, failUploadWithObject: true })
    global.wx = failMock.wx
    const failedList = await failRemoteBackup.listBackups({
      wxApi: {
        detail: {},
        currentTarget: {}
      }
    })
    assert.strictEqual(failedList.ok, false)
    assert.strictEqual(failedList.message, 'list failed')
    assert.notStrictEqual(failedList.message, '[object Object]')

    const failedUpload = await failRemoteBackup.uploadBackup(store, {
      wxApi: failMock.wx,
      force: true
    })
    assert.strictEqual(failedUpload.ok, false)
    assert.strictEqual(failedUpload.message, '网络请求失败')
    assert.notStrictEqual(failedUpload.message, '[object Object]')

    // 多端冲突：云端较新时返回 conflict，用户保留本地（overwrite）可强制覆盖
    resetModule('../utils/remoteBackup')
    const conflictRemoteBackup = require('../utils/remoteBackup')
    const conflictMock = createWxMock({ conflictOnUpload: true })
    global.wx = conflictMock.wx
    const conflictResult = await conflictRemoteBackup.uploadBackup(store, {
      wxApi: conflictMock.wx,
      force: true
    })
    assert.strictEqual(conflictResult.ok, false)
    assert.strictEqual(conflictResult.conflict, true)
    assert.strictEqual(conflictResult.cloud.deviceLabel, '平板')
    assert.strictEqual(conflictRemoteBackup.getStatus(conflictMock.wx).state, 'conflict')

    const keepLocalResult = await conflictRemoteBackup.uploadBackup(store, {
      wxApi: conflictMock.wx,
      force: true,
      overwrite: true
    })
    assert.strictEqual(keepLocalResult.ok, true)

    // 本地修订：内容不变时 updatedAt 保持稳定
    resetModule('../utils/remoteBackup')
    const revRemoteBackup = require('../utils/remoteBackup')
    const revMock = createWxMock()
    global.wx = revMock.wx
    const rev1 = revRemoteBackup.markLocalChange(store, { wxApi: revMock.wx })
    assert.ok(rev1 && rev1.updatedAt > 0)
    const rev2 = revRemoteBackup.markLocalChange(store, { wxApi: revMock.wx })
    assert.strictEqual(rev2.updatedAt, rev1.updatedAt)

    // 退出推送：距上次成功同步不足间隔则节流跳过
    resetModule('../utils/remoteBackup')
    const exitRemoteBackup = require('../utils/remoteBackup')
    const exitMock = createWxMock()
    global.wx = exitMock.wx
    const exitFirst = await exitRemoteBackup.uploadBackup(store, { wxApi: exitMock.wx })
    assert.strictEqual(exitFirst.ok, true)
    const exitThrottled = await exitRemoteBackup.flushOnExit({ wxApi: exitMock.wx, store })
    assert.strictEqual(exitThrottled.skipped, true)
    assert.strictEqual(exitThrottled.throttled, true)

    console.log('remote backup tests passed')
  } finally {
    global.wx = previousWx
    global.setTimeout = previousSetTimeout
    global.clearTimeout = previousClearTimeout
  }
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
