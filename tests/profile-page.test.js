const assert = require('assert')
const fs = require('fs')
const path = require('path')
const worktime = require('../utils/worktime')

const previousWx = global.wx
const previousPage = global.Page
const previousSetTimeout = global.setTimeout
const backing = {
  __files: {},
  __remoteBackups: [
    {
      fileName: 'backup-260610-162205.json',
      createdAt: '2026-06-10T08:22:05.000Z',
      preview: {
        monthCount: 1,
        recordCount: 3,
        presetCount: 2
      },
      size: 4096
    }
  ],
  __remoteBackupBody: {
    format: 'worktime-miniapp-backup',
    version: 4,
    exportedAt: '2026-06-10T08:22:05.000Z',
    store: worktime.createDefaultStore()
  }
}
let capturedPage = null

function clone(value) {
  return JSON.parse(JSON.stringify(value))
}

function createPageInstance(pageDefinition) {
  return Object.assign({}, pageDefinition, {
    data: clone(pageDefinition.data),
    setData(patch, callback) {
      Object.keys(patch).forEach((key) => {
        if (key.indexOf('.') === -1) {
          this.data[key] = patch[key]
          return
        }
        const parts = key.split('.')
        let target = this.data
        for (let index = 0; index < parts.length - 1; index += 1) {
          target = target[parts[index]]
        }
        target[parts[parts.length - 1]] = patch[key]
      })
      if (callback) {
        callback()
      }
    }
  })
}

function flush() {
  return new Promise((resolve) => setImmediate(resolve))
}

async function waitFor(condition, label) {
  for (let index = 0; index < 20; index += 1) {
    await flush()
    if (condition()) {
      return
    }
  }
  throw new Error(`Timed out waiting for ${label}`)
}

let store = worktime.createDefaultStore()
store = worktime.setEntry(store, '2026-05-16', { type: 'work', start: '11:00', end: '17:00' })
store = worktime.setEntry(store, '2026-05-17', { type: 'work', start: '09:20', end: '17:00' })
store = worktime.setEntry(store, '2026-05-20', { type: 'rest' })
store = worktime.setEntry(store, '2026-05-22', { type: 'leave' })

backing[worktime.STORAGE_KEY] = store

global.wx = {
  env: {
    USER_DATA_PATH: '/tmp'
  },
  getSystemInfoSync() {
    return { platform: 'ios', system: 'iOS 15.0' }
  },
  getStorageSync(key) {
    return backing[key] || ''
  },
  setStorageSync(key, value) {
    backing[key] = value
  },
  removeStorageSync(key) {
    delete backing[key]
  },
  login(options) {
    backing.__loginCount = (backing.__loginCount || 0) + 1
    if (options.success) {
      options.success({ code: `code-${backing.__loginCount}` })
    }
  },
  request(options) {
    backing.__requests = backing.__requests || []
    backing.__requests.push(options)
    if (options.url.endsWith('/api/session')) {
      if (options.success) {
        options.success({
          statusCode: 200,
          data: {
            ok: true,
            token: 'remote-token',
            expiresAt: Date.now() + 60 * 60 * 1000
          }
        })
      }
      return
    }
    if (options.url.endsWith('/api/backups') && options.method === 'GET') {
      if (backing.__failRemoteListWithObject) {
        if (options.fail) {
          options.fail({ errMsg: '远端列表请求失败' })
        }
        return
      }
      if (options.success) {
        options.success({
          statusCode: 200,
          data: {
            ok: true,
            backups: backing.__remoteBackups
          }
        })
      }
      return
    }
    if (options.url.endsWith('/api/backups') && options.method === 'POST') {
      backing.__uploadCount = (backing.__uploadCount || 0) + 1
      if (backing.__failRemoteUploadWithObject) {
        if (options.fail) {
          options.fail({ detail: { reason: 'network lost' } })
        }
        return
      }
      if (options.success) {
        options.success({
          statusCode: 200,
          data: {
            ok: true,
            backup: backing.__remoteBackups[0],
            backupCount: 1
          }
        })
      }
      return
    }
    if (options.url.indexOf('/api/backups/') !== -1 && options.method === 'GET') {
      backing.__downloadCount = (backing.__downloadCount || 0) + 1
      if (options.success) {
        options.success({
          statusCode: 200,
          data: {
            ok: true,
            backup: backing.__remoteBackupBody
          }
        })
      }
      return
    }
    if (options.fail) {
      options.fail({ errMsg: `unexpected request ${options.url}` })
    }
  },
  setClipboardData(options) {
    backing.__clipboard = options.data
    if (options.success) {
      options.success()
    }
  },
  showToast(options) {
    backing.__lastToast = options
  },
  showModal(options) {
    backing.__lastModal = options
    if (options.success) {
      options.success({ confirm: true })
    }
  },
  showLoading(options) {
    backing.__loadingShown = options
  },
  hideLoading() {
    backing.__hideLoadingCount = (backing.__hideLoadingCount || 0) + 1
  },
  getFileSystemManager() {
    return {
      writeFile(options) {
        backing.__writeCount = (backing.__writeCount || 0) + 1
        backing.__writtenFile = {
          filePath: options.filePath,
          data: options.data,
          encoding: options.encoding
        }
        if (backing.__writeShouldFail) {
          if (options.fail) {
            options.fail({ errMsg: 'write fail' })
          }
          return
        }
        backing.__files[options.filePath] = options.data
        if (options.success) {
          backing.__writeSuccessCalled = true
          options.success({})
        }
      },
      access(options) {
        backing.__accessCount = (backing.__accessCount || 0) + 1
        backing.__accessedFilePath = options.path
        if (backing.__holdAccess) {
          backing.__pendingAccess = options
          return
        }
        if (backing.__accessShouldFail || !backing.__files[options.path]) {
          if (options.fail) {
            options.fail({ errMsg: 'access fail' })
          }
          return
        }
        backing.__accessSuccessCalled = true
        if (options.success) {
          options.success({})
        }
      },
      readFile(options) {
        backing.__readCount = (backing.__readCount || 0) + 1
        if (backing.__readShouldReturnWrongData) {
          options.success({ data: new ArrayBuffer(3) })
          return
        }
        if (backing.__files[options.filePath]) {
          options.success({ data: backing.__files[options.filePath] })
          return
        }
        if (options.fail) {
          options.fail({ errMsg: 'read fail' })
        }
      }
    }
  },
  shareFileMessage(options) {
    backing.__shareCount = (backing.__shareCount || 0) + 1
    backing.__sharedFile = {
      filePath: options.filePath,
      fileName: options.fileName,
      writeSuccessBeforeShare: backing.__writeSuccessCalled === true,
      accessSuccessBeforeShare: backing.__accessSuccessCalled === true,
      readBeforeShare: (backing.__readCount || 0) > 0
    }
    if (backing.__shareShouldFail) {
      if (options.fail) {
        options.fail({ errMsg: backing.__shareFailMessage || 'share fail' })
      }
      return
    }
    if (options.success) {
      options.success({})
    }
  },
}

const remoteLogin = global.wx.login
const remoteRequest = global.wx.request
delete global.wx.login
delete global.wx.request

function installRemoteBackupApi() {
  global.wx.login = remoteLogin
  global.wx.request = remoteRequest
}

global.Page = (pageDefinition) => {
  capturedPage = pageDefinition
}

global.setTimeout = (callback) => {
  backing.__timeoutCount = (backing.__timeoutCount || 0) + 1
  callback()
  return 0
}

delete require.cache[require.resolve('../pages/profile/profile.js')]
require('../pages/profile/profile.js')

async function main() {
  const page = createPageInstance(capturedPage)
  page.onLoad()
  page.setData({
    currentMonthKey: '2026-05',
    balanceMonthKey: '2026-05',
    exportStart: '2026-05-16',
    exportEnd: '2026-05-22'
  }, () => page.refresh())

  assert.strictEqual(page.data.activeProfileTab, 'report')
  assert.deepStrictEqual(page.data.profileTabs.map((tab) => tab.key), ['report', 'presets', 'balance', 'backup'])

  const appConfig = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'app.json'), 'utf8'))
  assert.deepStrictEqual(appConfig.tabBar.list.map((item) => item.iconPath), [
    'assets/tab/overview.png',
    'assets/tab/record.png',
    'assets/tab/manage.png'
  ])
  assert.deepStrictEqual(appConfig.tabBar.list.map((item) => item.selectedIconPath), [
    'assets/tab/overview-active.png',
    'assets/tab/record-active.png',
    'assets/tab/manage-active.png'
  ])
  appConfig.tabBar.list.forEach((item) => {
    ;[item.iconPath, item.selectedIconPath].forEach((iconPath) => {
      const fullPath = path.join(__dirname, '..', iconPath)
      assert.ok(fs.existsSync(fullPath), `${iconPath} should exist`)
      assert.ok(fs.statSync(fullPath).size < 40 * 1024, `${iconPath} should be smaller than 40KB`)
    })
  })

  const indexConfig = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'pages', 'index', 'index.json'), 'utf8'))
  assert.ok(!Object.values(indexConfig.usingComponents).some((value) => value === 'tdesign-miniprogram/icon/icon'))
  const indexWxml = fs.readFileSync(path.join(__dirname, '..', 'pages', 'index', 'index.wxml'), 'utf8')
  const indexWxss = fs.readFileSync(path.join(__dirname, '..', 'pages', 'index', 'index.wxss'), 'utf8')
  assert.ok(indexWxml.indexOf('<t-icon') === -1)
  assert.ok(indexWxml.includes('<van-icon name="arrow-left"'))
  assert.ok(indexWxml.includes('<van-icon name="arrow"'))
  // 新版总览页：胶囊日期切换（picker）+ 周排班视图 + 近期出勤，月份切换通过日期选择器完成
  assert.ok(indexWxml.includes('mode="date"'))
  assert.ok(indexWxml.includes('date-capsule'))
  assert.ok(indexWxml.indexOf('goPrevMonth') === -1)
  assert.ok(indexWxml.indexOf('goNextMonth') === -1)
  assert.strictEqual((indexWxml.match(/bindtap="go(Prev|Next)Day"/g) || []).length, 2)
  assert.ok(indexWxml.includes('applyLastShift'))
  assert.ok(indexWxss.includes('.nav-arrow'))
  assert.ok(indexWxss.includes('.week-day-dot'))
  assert.ok(indexWxss.includes('.list-row'))
  assert.ok(indexWxss.indexOf('.double-nav-icon') === -1)

  const profileWxml = fs.readFileSync(path.join(__dirname, '..', 'pages', 'profile', 'profile.wxml'), 'utf8')
  assert.ok(profileWxml.indexOf('profile-subtitle') === -1)
  assert.ok(profileWxml.indexOf('导出并发送') === -1)
  assert.ok(profileWxml.indexOf('从文件导入') === -1)
  assert.ok(profileWxml.indexOf('remoteBackupFileName') === -1)
  assert.ok(profileWxml.indexOf('remote-backup-name') === -1)
  assert.ok(profileWxml.indexOf('<text class="remote-backup-time">{{item.createdAtText}}</text>') !== -1)
  assert.ok(profileWxml.indexOf('data-file="{{item.fileName}}"') !== -1)
  assert.ok(profileWxml.indexOf('{{item.summaryText}}') === -1)
  assert.ok(profileWxml.includes('{{icpNumber}}'))
  assert.ok(profileWxml.includes('v{{appVersion}}'))
  assert.ok(profileWxml.indexOf('bindtap="openIcpFiling"') === -1)
  assert.ok(profileWxml.indexOf('navigator') === -1)
  assert.ok(profileWxml.indexOf('web-view') === -1)
  // 新版管理页:班次列表平铺 + 结余步进 + 上月快捷范围,旧 picker 流程移除
  assert.ok(profileWxml.includes('preset-row'))
  assert.ok(profileWxml.includes('bindtap="editPreset"'))
  assert.ok(profileWxml.includes('bindtap="stepBalanceInput"'))
  assert.ok(profileWxml.includes('bindtap="useLastMonthExportRange"'))
  assert.ok(profileWxml.indexOf('onManagedPresetPickerChange') === -1)

  const profileWxss = fs.readFileSync(path.join(__dirname, '..', 'pages', 'profile', 'profile.wxss'), 'utf8')
  assert.ok(profileWxss.includes('.profile-footer'))
  assert.ok(profileWxss.includes('margin-top: 26rpx'))
  assert.ok(profileWxss.includes('env(safe-area-inset-bottom)'))

  const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'))
  assert.strictEqual(pkg.version, '0.5.0')

  ;['overview', 'overview-active', 'record', 'record-active', 'manage', 'manage-active'].forEach((name) => {
    assert.ok(fs.existsSync(path.join(__dirname, '..', 'assets', 'tab', 'svg', `${name}.svg`)))
  })

  assert.deepStrictEqual(page.data.exportLines, [])

  page.refreshExportText()
  assert.deepStrictEqual(page.data.exportLines, [
    '5.16日  11:00-17:00   -1.5',
    '5.17日  全天',
    '5.20日  本休',
    '5.22日  调休'
  ])
  assert.strictEqual(page.data.exportText, page.data.exportLines.join('\n'))

  page.copyExportText()
  assert.strictEqual(backing.__clipboard, page.data.exportText)

  page.copyExportDeltaText()
  assert.strictEqual(backing.__clipboard, [
    '5.16日  -1.5',
    '5.17日  全天',
    '5.20日  本休',
    '5.22日  调休'
  ].join('\n'))

  const rangeReport = worktime.buildReportImageData(page.store, page.data.exportStart, page.data.exportEnd)
  assert.strictEqual(rangeReport.title, '2026-05-16 至 2026-05-22 工时')
  assert.strictEqual(rangeReport.rows.length, 7)
  assert.deepStrictEqual(rangeReport.rows.map((row) => row.dateKey), [
    '2026-05-16',
    '2026-05-17',
    '2026-05-18',
    '2026-05-19',
    '2026-05-20',
    '2026-05-21',
    '2026-05-22'
  ])
  assert.strictEqual(worktime.formatHours(rangeReport.rangeDeltaMinutes, true), '-8.5')
  assert.strictEqual(rangeReport.recordedCount, 4)
  assert.strictEqual(rangeReport.missingCount, 3)
  assert.strictEqual(rangeReport.rows[2].displayType, '无记录')

  const monthReport = worktime.buildReportImageData(page.store, '2026-05-01', '2026-05-31')
  assert.strictEqual(monthReport.title, '5月工时')
  assert.strictEqual(monthReport.rows.length, 31)
  const singleDayReport = worktime.buildReportImageData(page.store, '2026-05-16', '2026-05-16')
  assert.strictEqual(singleDayReport.title, '2026-05-16 工时')

  assert.deepStrictEqual(page.data.timePickerRange[1], ['00', '30'])
  page.switchProfileTab({ currentTarget: { dataset: { tab: 'presets' } } })
  assert.strictEqual(page.data.activeProfileTab, 'presets')
  page.startAddPreset()
  assert.strictEqual(page.data.presetForm.start, '09:30')
  assert.strictEqual(page.data.presetForm.end, '17:00')
  assert.deepStrictEqual(page.data.presetStartTimePickerValue, [9, 1])
  page.onPresetStartChange({ detail: { value: [8, 1] } })
  page.onPresetEndChange({ detail: { value: [20, 0] } })
  assert.strictEqual(page.data.presetForm.start, '08:30')
  assert.strictEqual(page.data.presetForm.end, '20:00')
  page.savePreset()
  const savedPreset = page.store.settings.presets.find((preset) => preset.id === page.data.selectedPresetId)
  assert.strictEqual(savedPreset.start, '08:30')
  assert.strictEqual(savedPreset.end, '20:00')

  page.switchProfileTab({ currentTarget: { dataset: { tab: 'balance' } } })
  assert.strictEqual(page.data.activeProfileTab, 'balance')
  assert.strictEqual(page.data.balanceMonthLabel, '2026年5月')
  assert.strictEqual(page.data.balanceClosingText, '-8.5')

  page.setData({
    balanceInput: '4.5'
  })
  page.saveOpeningBalanceSetting()
  assert.strictEqual(worktime.getMonth(page.store, '2026-05').openingBalanceMinutes, 780)
  assert.strictEqual(page.data.balanceClosingText, '4.5')
  assert.strictEqual(page.data.openingBalanceText, '13')
  assert.strictEqual(page.data.closingBalanceText, '4.5')

  page.setData({
    balanceInput: 'abc'
  })
  page.saveOpeningBalanceSetting()
  assert.strictEqual(backing.__lastToast.title, '请输入数字')
  assert.strictEqual(worktime.getMonth(page.store, '2026-05').openingBalanceMinutes, 780)

  page.switchProfileTab({ currentTarget: { dataset: { tab: 'backup' } } })
  installRemoteBackupApi()
  page.loadRemoteBackups({
    detail: {},
    currentTarget: {}
  })
  assert.strictEqual(page.data.activeProfileTab, 'backup')
  await waitFor(() => page.data.remoteBackups.length === 1, 'remote backup list')
  assert.strictEqual(page.data.remoteBackups[0].fileName, 'backup-260610-162205.json')
  assert.strictEqual(page.data.remoteBackups[0].createdAtText, '2026-06-10 16:22:05')
  assert.strictEqual(page.data.remoteBackups[0].summaryText, undefined)
  assert.strictEqual(page.data.remoteBackups[0].sizeText, undefined)
  assert.strictEqual(page.data.appVersion, '0.5.0')
  assert.strictEqual(page.data.icpNumber, '陇ICP备2025016413号-4X')
  assert.strictEqual(typeof page.openIcpFiling, 'undefined')

  backing.__lastToast = null
  backing.__hideLoadingCount = 0
  page.syncRemoteBackupNow({
    detail: {},
    currentTarget: {}
  })
  await waitFor(() => page.data.isRemoteBackupLoading === false, 'remote backup sync')
  assert.strictEqual(backing.__uploadCount, 1)
  assert.deepStrictEqual(backing.__loadingShown, {
    title: '正在同步',
    mask: true
  })
  assert.strictEqual(backing.__lastToast.title, '已同步')
  assert.notStrictEqual(backing.__lastToast.title, '[object Object]')
  assert.strictEqual(backing.__hideLoadingCount, 1)
  assert.ok(page.data.remoteBackupStatusText.indexOf('完成') === -1)
  assert.notStrictEqual(page.data.remoteBackupStatusText, '[object Object]')
  const uploadRequest = backing.__requests.find((request) => request.url.endsWith('/api/backups') && request.method === 'POST')
  assert.ok(uploadRequest)
  assert.match(uploadRequest.data.backup.exportedAt, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\+08:00$/)

  backing.__failRemoteListWithObject = true
  page.loadRemoteBackups({
    detail: {},
    currentTarget: {}
  })
  await waitFor(() => page.data.remoteBackupState === 'failed', 'remote backup failed list')
  assert.strictEqual(page.data.remoteBackupStatusText, '远端列表请求失败')
  assert.notStrictEqual(page.data.remoteBackupStatusText, '[object Object]')
  backing.__failRemoteListWithObject = false

  backing.__failRemoteUploadWithObject = true
  backing.__lastToast = null
  page.syncRemoteBackupNow({
    detail: {},
    currentTarget: {}
  })
  await waitFor(() => page.data.isRemoteBackupLoading === false, 'remote backup failed sync')
  assert.strictEqual(page.data.remoteBackupStatusText, '网络请求失败')
  assert.strictEqual(backing.__lastToast.title, '网络请求失败')
  assert.notStrictEqual(backing.__lastToast.title, '[object Object]')
  backing.__failRemoteUploadWithObject = false

  page.loadRemoteBackups({
    detail: {},
    currentTarget: {}
  })
  await waitFor(() => page.data.remoteBackups.length === 1, 'remote backup list after failures')

  backing.__hideLoadingCount = 0
  page.restoreRemoteBackup({
    currentTarget: {
      dataset: {
        file: page.data.remoteBackups[0].fileName,
        time: page.data.remoteBackups[0].createdAtText
      }
    }
  })
  assert.strictEqual(backing.__lastModal.title, '恢复远端备份')
  assert.ok(backing.__lastModal.content.includes('2026-06-10 16:22:05'))
  assert.ok(backing.__lastModal.content.indexOf('backup-260610-162205.json') === -1)
  await waitFor(() => page.data.isRemoteBackupLoading === false, 'remote backup restore')
  assert.strictEqual(backing.__downloadCount, 1)
  assert.strictEqual(backing.__hideLoadingCount, 1)

  // ===== 每日拉取（恢复）限流：每天最多 3 次 =====
  // 上面已成功恢复 1 次，再恢复 2 次后应达上限
  for (let i = 0; i < 2; i += 1) {
    page.restoreRemoteBackup({
      currentTarget: {
        dataset: {
          file: page.data.remoteBackups[0].fileName,
          time: page.data.remoteBackups[0].createdAtText
        }
      }
    })
    await waitFor(() => page.data.isRemoteBackupLoading === false, `remote backup restore quota ${i}`)
  }
  assert.strictEqual(backing.__downloadCount, 3)

  // 第 4 次恢复应被本地限流拦截，不再发起下载
  backing.__lastToast = null
  page.restoreRemoteBackup({
    currentTarget: {
      dataset: {
        file: page.data.remoteBackups[0].fileName,
        time: page.data.remoteBackups[0].createdAtText
      }
    }
  })
  assert.strictEqual(backing.__lastToast.title, '今日恢复次数已达上限')
  assert.strictEqual(backing.__downloadCount, 3)

  // ===== 班次行内编辑 =====
  page.editPreset({ currentTarget: { dataset: { id: page.data.presets[0].id } } })
  assert.strictEqual(page.data.isPresetEditorVisible, true)
  assert.strictEqual(page.data.isAddingPreset, false)
  assert.strictEqual(page.data.presetForm.id, page.data.presets[0].id)
  page.cancelPresetEdit()
  assert.strictEqual(page.data.isPresetEditorVisible, false)

  // ===== 结余步进调整 =====
  page.setData({ balanceInput: '4.5' })
  page.stepBalanceInput({ currentTarget: { dataset: { step: 0.5 } } })
  assert.strictEqual(page.data.balanceInput, '5')
  page.stepBalanceInput({ currentTarget: { dataset: { step: -0.5 } } })
  assert.strictEqual(page.data.balanceInput, '4.5')
  page.setData({ balanceInput: 'abc' })
  page.stepBalanceInput({ currentTarget: { dataset: { step: 0.5 } } })
  assert.strictEqual(page.data.balanceInput, '0.5')

  // ===== 上月快捷范围 =====
  const lastMonthKey = worktime.previousMonthKey(worktime.toMonthKey(worktime.getTodayKey()))
  page.useLastMonthExportRange()
  assert.strictEqual(page.data.exportStart, worktime.getDateKey(lastMonthKey, 1))
  assert.strictEqual(page.data.exportEnd, worktime.getDateKey(lastMonthKey, worktime.daysInMonth(lastMonthKey)))

  // ===== 生图:31 天整月在高分屏(dpr=3)下不超 canvas 物理尺寸上限 =====
  const ctxStub = {
    save() {}, restore() {}, scale() {}, clearRect() {}, fillRect() {}, fillText() {},
    beginPath() {}, moveTo() {}, lineTo() {}, arcTo() {}, closePath() {},
    fill() {}, clip() {}, stroke() {},
    measureText(text) {
      return { width: String(text).length * 12 }
    }
  }
  const canvasNode = {
    width: 0,
    height: 0,
    getContext: () => ctxStub
  }
  global.wx.getWindowInfo = () => ({ pixelRatio: 3 })
  global.wx.createSelectorQuery = () => {
    const query = {
      in: () => query,
      select: () => query,
      fields: () => query,
      exec: (callback) => callback([{ node: canvasNode }])
    }
    return query
  }
  global.wx.canvasToTempFilePath = (options) => {
    backing.__canvasExport = options
    options.success({ tempFilePath: 'tmp://report.png' })
  }
  global.wx.previewImage = (options) => {
    backing.__previewedUrls = options.urls
  }

  page.setData({
    exportStart: '2026-07-01',
    exportEnd: '2026-07-31'
  })
  page.generateReportImage()
  assert.ok(canvasNode.width > 0 && canvasNode.width <= 4000, 'canvas width within wechat limit')
  assert.ok(canvasNode.height > 0 && canvasNode.height <= 4000, 'canvas height within wechat limit')
  assert.strictEqual(backing.__canvasExport.destWidth, canvasNode.width)
  assert.strictEqual(backing.__canvasExport.destHeight, canvasNode.height)
  assert.deepStrictEqual(backing.__previewedUrls, ['tmp://report.png'])
  assert.strictEqual(page.isGeneratingReport, false)

  // 跨月范围同样可以稳定出图
  backing.__previewedUrls = null
  page.setData({
    exportStart: '2026-05-20',
    exportEnd: '2026-06-10'
  })
  page.generateReportImage()
  assert.deepStrictEqual(backing.__previewedUrls, ['tmp://report.png'])
  assert.strictEqual(page.isGeneratingReport, false)

  console.log('profile page tests passed')
}

main().finally(() => {
  global.wx = previousWx
  global.Page = previousPage
  global.setTimeout = previousSetTimeout
})
