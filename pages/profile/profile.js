const worktime = require('../../utils/worktime')
const storage = require('../../utils/storage')
const remoteBackup = require('../../utils/remoteBackup')
const theme = require('../../utils/theme')
const profileState = require('./state')

const CANVAS_WIDTH = 960
const REPORT_MARGIN = 40
const REPORT_HEADER_HEIGHT = 168
const REPORT_ROW_HEIGHT = 56
const REPORT_SUMMARY_HEIGHT = 152
// 微信 canvas 物理尺寸上限约 4096px，超出会绘制失败；留余量取 4000
const MAX_CANVAS_EDGE = 4000

// 报表备注列只展示用户手写备注，过滤与班次列重复的系统自动备注
function getReportRemark(row) {
  if (!row.hasEntry || !row.entry.note) {
    return ''
  }
  const note = String(row.entry.note)
  if (note === '全天' || note === '本休' || note === '调休' || /^\d{2}:\d{2}-\d{2}:\d{2}$/.test(note)) {
    return ''
  }
  return note
}

// 圆角矩形路径（canvas 2d 无内建 roundRect 的兼容实现）
function traceRoundRect(ctx, x, y, w, h, r) {
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.arcTo(x + w, y, x + w, y + h, r)
  ctx.arcTo(x + w, y + h, x, y + h, r)
  ctx.arcTo(x, y + h, x, y, r)
  ctx.arcTo(x, y, x + w, y, r)
  ctx.closePath()
}

function getEventValue(event) {
  const detail = event ? event.detail : ''
  if (detail && typeof detail === 'object' && Object.prototype.hasOwnProperty.call(detail, 'value')) {
    return detail.value
  }
  return detail
}

function getDevicePixelRatio() {
  try {
    const info = wx.getWindowInfo ? wx.getWindowInfo() : null
    return info && info.pixelRatio ? info.pixelRatio : 1
  } catch (error) {
    return 1
  }
}

function formatRemoteTime(value) {
  if (!value) {
    return ''
  }
  return worktime.formatBeijingDisplayDateTime(value)
}

function decorateRemoteBackup(item) {
  const createdAt = item.createdAt || item.savedAt || item.exportedAt || ''
  return {
    fileName: item.fileName || '',
    createdAt,
    createdAtText: formatRemoteTime(createdAt) || '未知时间'
  }
}

// 每日远端拉取（恢复）限流：本地按自然日计数，最多 3 次
const PULL_QUOTA_KEY = 'worktime.profile.dailyPullQuota'
const MAX_DAILY_PULL = 3

function readPullQuota() {
  const today = worktime.getTodayKey()
  let stored = null
  try {
    stored = wx.getStorageSync(PULL_QUOTA_KEY)
  } catch (error) {
    stored = null
  }
  if (stored && stored.date === today && typeof stored.count === 'number') {
    return { date: today, count: stored.count }
  }
  return { date: today, count: 0 }
}

// 检查是否还有拉取额度（不消耗）
function hasPullQuota() {
  return readPullQuota().count < MAX_DAILY_PULL
}

// 消耗一次拉取额度
function consumePullQuota() {
  const quota = readPullQuota()
  quota.count += 1
  try {
    wx.setStorageSync(PULL_QUOTA_KEY, quota)
  } catch (error) {
    // 写入失败不阻断恢复
  }
}

function normalizeDisplayText(value, fallback) {
  if (typeof value === 'string') {
    const text = value.trim()
    return text && text !== '[object Object]' ? value : fallback
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value)
  }
  if (value && typeof value === 'object') {
    if (typeof value.message === 'string' && value.message) {
      return normalizeDisplayText(value.message, fallback)
    }
    if (typeof value.errMsg === 'string' && value.errMsg) {
      return normalizeDisplayText(value.errMsg, fallback)
    }
    if (typeof value.error === 'string' && value.error) {
      return normalizeDisplayText(value.error, fallback)
    }
    if (typeof value.msg === 'string' && value.msg) {
      return normalizeDisplayText(value.msg, fallback)
    }
    if (value.data) {
      return normalizeDisplayText(value.data, fallback)
    }
  }
  return fallback
}

Page({
  store: worktime.createDefaultStore(),
  isGeneratingReport: false,
  hasLoadedOnce: false,
  skippedInitialShow: false,

  data: {
    activeProfileTab: profileState.DEFAULT_PROFILE_TAB,
    profileTabs: profileState.PROFILE_TABS,
    presets: [],
    presetForm: profileState.createPresetForm(),
    editingPresetId: '',
    selectedPresetId: '',
    isPresetEditorVisible: false,
    isAddingPreset: false,
    timePickerRange: worktime.buildHalfHourTimePickerRange(),
    presetStartTimePickerValue: worktime.getHalfHourTimePickerValue('09:30'),
    presetEndTimePickerValue: worktime.getHalfHourTimePickerValue('17:00'),
    currentMonthKey: worktime.toMonthKey(new Date()),
    openingBalanceText: '0',
    monthDeltaText: '0',
    closingBalanceText: '0',
    balanceMonthKey: worktime.toMonthKey(new Date()),
    balanceMonthLabel: '',
    balanceClosingText: '0',
    balanceInput: '0',
    exportStart: '',
    exportEnd: '',
    exportLines: [],
    exportText: '',
    exportDeltaText: '',
    canvasWidth: CANVAS_WIDTH,
    canvasHeight: 1280,
    reportImagePath: '',
    remoteBackupStatusText: '',
    remoteBackupState: '',
    remoteBackupConflict: null,
    remoteBackups: [],
    isRemoteBackupLoading: false,
    appVersion: '0.5.0',
    icpNumber: '陇ICP备2025016413号-4X'
  },

  onLoad() {
    this.hasLoadedOnce = true
    const monthKey = worktime.toMonthKey(new Date())
    this.setData({
      currentMonthKey: monthKey,
      balanceMonthKey: monthKey,
      exportStart: worktime.getDateKey(monthKey, 1),
      exportEnd: worktime.getTodayKey()
    }, () => {
      this.refresh()
      // 进入即自动渲染默认范围（本月1号至今天）的预览，免去再次手动选择
      this.refreshExportText()
    })
  },

  onShow() {
    if (this.hasLoadedOnce && !this.skippedInitialShow) {
      this.skippedInitialShow = true
      return
    }
    this.refresh()
  },

  refresh() {
    const store = storage.loadStore()
    this.store = store
    this.setData(profileState.buildProfileState(store, this.data))
  },

  refreshExportText(storeInput) {
    const store = storeInput || this.store
    const exportLines = worktime.buildExportLines(store, this.data.exportStart, this.data.exportEnd)
    this.setData({
      exportLines,
      exportText: exportLines.join('\n'),
      exportDeltaText: worktime.buildDeltaExportText(store, this.data.exportStart, this.data.exportEnd)
    })
  },

  switchProfileTab(event) {
    const tab = event && event.currentTarget && event.currentTarget.dataset.tab
    if (!tab || tab === this.data.activeProfileTab) {
      return
    }
    this.setData({
      activeProfileTab: tab
    }, () => {
      if (tab === 'backup') {
        this.refreshRemoteBackupStatus()
        this.loadRemoteBackups()
      }
    })
  },

  onBalanceMonthChange(event) {
    const monthKey = getEventValue(event)
    if (!monthKey) {
      return
    }
    const balanceView = worktime.buildMonthView(this.store, monthKey)
    this.setData({
      balanceMonthKey: monthKey,
      balanceMonthLabel: balanceView.monthLabel,
      balanceClosingText: worktime.formatHours(balanceView.ledger.closingBalanceMinutes),
      balanceInput: worktime.formatHours(balanceView.ledger.closingBalanceMinutes)
    })
  },

  onBalanceInput(event) {
    this.setData({
      balanceInput: getEventValue(event)
    })
  },

  // 结余步进调整：data-step 为 ±0.5（小时）
  stepBalanceInput(event) {
    const step = Number(event.currentTarget.dataset.step) || 0
    const current = Number(String(this.data.balanceInput).trim().replace(',', '.'))
    const base = Number.isFinite(current) ? current : 0
    const next = Math.round((base + step) * 10) / 10
    this.setData({
      balanceInput: String(next)
    })
  },

  saveOpeningBalanceSetting() {
    const monthKey = this.data.balanceMonthKey || this.data.currentMonthKey
    const targetClosingMinutes = worktime.parseHoursToMinutes(this.data.balanceInput)
    if (targetClosingMinutes === null) {
      wx.showToast({
        title: '请输入数字',
        icon: 'none'
      })
      return
    }
    const monthDeltaMinutes = worktime.computeLedger(this.store, monthKey).monthDeltaMinutes
    const openingBalanceMinutes = targetClosingMinutes - monthDeltaMinutes
    const savedStore = storage.saveStore(worktime.setOpeningBalance(this.store, monthKey, openingBalanceMinutes))
    this.store = savedStore
    this.refresh()
    this.refreshExportText(savedStore)
    wx.showToast({
      title: '已保存'
    })
  },

  // 行内编辑：点击班次行的编辑按钮，填充表单并展开编辑器
  editPreset(event) {
    const presetId = event && event.currentTarget && event.currentTarget.dataset.id
    const preset = worktime.getPresetById(this.store, presetId)
    if (!preset) {
      return
    }
    this.setData({
      selectedPresetId: preset.id,
      presetForm: Object.assign({}, preset),
      editingPresetId: preset.id,
      isPresetEditorVisible: true,
      isAddingPreset: false,
      presetStartTimePickerValue: profileState.getPresetTimePickerValue(preset, 'start'),
      presetEndTimePickerValue: profileState.getPresetTimePickerValue(preset, 'end')
    })
  },

  startAddPreset() {
    const form = profileState.createPresetForm()
    form.id = `preset-${Date.now()}`
    this.setData({
      selectedPresetId: '',
      presetForm: form,
      editingPresetId: '',
      isPresetEditorVisible: true,
      isAddingPreset: true,
      presetStartTimePickerValue: profileState.getPresetTimePickerValue(form, 'start'),
      presetEndTimePickerValue: profileState.getPresetTimePickerValue(form, 'end')
    })
  },

  onPresetStartChange(event) {
    const start = worktime.getHalfHourTimeFromPickerValue(event.detail.value, this.data.presetForm.start)
    this.setData({
      'presetForm.start': start,
      presetStartTimePickerValue: profileState.getPresetTimePickerValue({ start }, 'start')
    })
  },

  onPresetEndChange(event) {
    const end = worktime.getHalfHourTimeFromPickerValue(event.detail.value, this.data.presetForm.end)
    this.setData({
      'presetForm.end': end,
      presetEndTimePickerValue: profileState.getPresetTimePickerValue({ end }, 'end')
    })
  },

  onPresetBreakChange(event) {
    this.setData({
      'presetForm.deductBreak': getEventValue(event)
    })
  },

  savePreset() {
    const form = Object.assign({}, this.data.presetForm)
    const start = worktime.parseTime(form.start)
    const end = worktime.parseTime(form.end)
    if (start === null || end === null || end <= start) {
      wx.showToast({
        title: '请检查班次时间',
        icon: 'none'
      })
      return
    }
    const nextStore = worktime.upsertPreset(this.store, form)
    const savedStore = storage.saveStore(nextStore)
    this.store = savedStore
    const savedPreset = worktime.getPresetById(savedStore, form.id)
    this.setData({
      selectedPresetId: form.id,
      presetForm: Object.assign({}, savedPreset || form),
      editingPresetId: form.id,
      isPresetEditorVisible: false,
      isAddingPreset: false,
      presetStartTimePickerValue: profileState.getPresetTimePickerValue(savedPreset || form, 'start'),
      presetEndTimePickerValue: profileState.getPresetTimePickerValue(savedPreset || form, 'end')
    }, () => {
      this.refresh()
      this.refreshExportText(savedStore)
    })
    wx.showToast({
      title: '已保存'
    })
  },

  cancelPresetEdit() {
    this.setData({
      presetForm: profileState.createPresetForm(),
      editingPresetId: '',
      selectedPresetId: '',
      isPresetEditorVisible: false,
      isAddingPreset: false,
      presetStartTimePickerValue: profileState.getPresetTimePickerValue(profileState.createPresetForm(), 'start'),
      presetEndTimePickerValue: profileState.getPresetTimePickerValue(profileState.createPresetForm(), 'end')
    })
  },

  deletePreset(event) {
    const presetId = event && event.currentTarget && event.currentTarget.dataset.id
      ? event.currentTarget.dataset.id
      : this.data.selectedPresetId
    if (!presetId) {
      return
    }
    wx.showModal({
      title: '删除班次',
      content: '已记录的日期会保留原时间，只删除这个快捷班次。',
      confirmText: '删除',
      confirmColor: theme.DANGER_COLOR,
      success: (result) => {
        if (!result.confirm) {
          return
        }
        const nextStore = worktime.deletePreset(this.store, presetId)
        const savedStore = storage.saveStore(nextStore)
        this.store = savedStore
        this.setData({
          presetForm: profileState.createPresetForm(),
          editingPresetId: '',
          selectedPresetId: '',
          isPresetEditorVisible: false,
          isAddingPreset: false
        }, () => {
          this.refresh()
          this.refreshExportText(savedStore)
        })
      }
    })
  },

  onExportStartChange(event) {
    this.setData({
      exportStart: event.detail.value
    }, () => this.refreshExportText())
  },

  onExportEndChange(event) {
    this.setData({
      exportEnd: event.detail.value
    }, () => this.refreshExportText())
  },

  useMonthExportRange() {
    const start = worktime.getDateKey(this.data.currentMonthKey, 1)
    const end = worktime.getDateKey(this.data.currentMonthKey, worktime.daysInMonth(this.data.currentMonthKey))
    this.setData({
      exportStart: start,
      exportEnd: end
    }, () => this.refreshExportText())
  },

  useWeekExportRange() {
    const today = worktime.getTodayKey()
    const range = worktime.getWeekRange(today)
    this.setData({
      currentMonthKey: worktime.toMonthKey(today),
      exportStart: range.start,
      exportEnd: range.end
    }, () => {
      this.refresh()
      this.refreshExportText()
    })
  },

  // 上月整月快捷范围
  useLastMonthExportRange() {
    const lastMonthKey = worktime.previousMonthKey(worktime.toMonthKey(worktime.getTodayKey()))
    this.setData({
      exportStart: worktime.getDateKey(lastMonthKey, 1),
      exportEnd: worktime.getDateKey(lastMonthKey, worktime.daysInMonth(lastMonthKey))
    }, () => this.refreshExportText())
  },

  copyToClipboard(text) {
    if (!text) {
      wx.showToast({
        title: '当前范围没有记录',
        icon: 'none'
      })
      return
    }
    wx.setClipboardData({
      data: text,
      success: () => {
        wx.showToast({
          title: '已复制'
        })
      }
    })
  },

  copyExportText() {
    const exportLines = worktime.buildExportLines(this.store, this.data.exportStart, this.data.exportEnd)
    const exportText = exportLines.join('\n')
    this.setData({
      exportLines,
      exportText
    })
    this.copyToClipboard(exportText)
  },

  copyExportDeltaText() {
    const exportDeltaText = worktime.buildDeltaExportText(this.store, this.data.exportStart, this.data.exportEnd)
    this.setData({
      exportDeltaText
    })
    this.copyToClipboard(exportDeltaText)
  },

  generateReportImage() {
    if (this.isGeneratingReport) {
      return
    }
    const report = worktime.buildReportImageData(this.store, this.data.exportStart, this.data.exportEnd)
    this.isGeneratingReport = true
    wx.showLoading({
      title: '正在生成',
      mask: true
    })
    const height = REPORT_HEADER_HEIGHT + (report.rows.length + 1) * REPORT_ROW_HEIGHT + REPORT_SUMMARY_HEIGHT
    this.setData({
      canvasHeight: height
    }, () => this.drawReportImage(height, report))
  },

  drawReportImage(height, report) {
    if (!wx.createSelectorQuery) {
      this.finishReportGeneration(false)
      return
    }
    wx.createSelectorQuery()
      .in(this)
      .select('#reportCanvas')
      .fields({
        node: true,
        size: true
      })
      .exec((result) => {
        const canvas = result && result[0] && result[0].node
        if (!canvas || !canvas.getContext) {
          this.finishReportGeneration(false)
          return
        }

        const width = CANVAS_WIDTH
        const dpr = getDevicePixelRatio()
        // 整月行数多时按比例降采样，保证任意月份/跨月范围都不超 canvas 尺寸上限
        const scale = Math.min(dpr, MAX_CANVAS_EDGE / height, MAX_CANVAS_EDGE / width)
        if (scale < 0.5) {
          this.finishReportGeneration(false, '范围过长，请缩小导出范围')
          return
        }
        const destWidth = Math.floor(width * scale)
        const destHeight = Math.floor(height * scale)
        canvas.width = destWidth
        canvas.height = destHeight

        const ctx = canvas.getContext('2d')
        ctx.save()
        ctx.scale(scale, scale)
        try {
          this.drawReportCanvas(ctx, width, height, report)
        } catch (error) {
          ctx.restore()
          console.error('[profile] draw report canvas failed:', error)
          this.finishReportGeneration(false)
          return
        }
        ctx.restore()

        wx.canvasToTempFilePath({
          canvas,
          x: 0,
          y: 0,
          width,
          height,
          destWidth,
          destHeight,
          fileType: 'png',
          success: (pathResult) => {
            this.setData({
              reportImagePath: pathResult.tempFilePath
            })
            this.isGeneratingReport = false
            wx.hideLoading()
            wx.previewImage({
              urls: [pathResult.tempFilePath]
            })
          },
          fail: () => this.finishReportGeneration(false)
        }, this)
      })
  },

  finishReportGeneration(success, message) {
    this.isGeneratingReport = false
    wx.hideLoading()
    if (!success) {
      wx.showToast({
        title: message || '生成图片失败',
        icon: 'none'
      })
    }
  },

  drawReportCanvas(ctx, width, height, reportInput) {
    const report = reportInput || worktime.buildReportImageData(this.store, this.data.exportStart, this.data.exportEnd)
    const rows = report.rows
    const margin = REPORT_MARGIN
    const contentWidth = width - margin * 2
    const rowHeight = REPORT_ROW_HEIGHT
    const tableTop = REPORT_HEADER_HEIGHT
    const tableHeight = (rows.length + 1) * rowHeight
    const colDate = margin + 28
    const colShift = margin + 256
    const colDelta = margin + 516
    const colRemark = margin + 668

    // 页面底
    ctx.clearRect(0, 0, width, height)
    ctx.fillStyle = '#f4f4f8'
    ctx.fillRect(0, 0, width, height)
    ctx.textBaseline = 'middle'

    // 顶部标题与副标题
    ctx.fillStyle = '#1a1a21'
    ctx.font = '800 44px sans-serif'
    ctx.fillText(report.title, margin, 78)
    ctx.fillStyle = '#65656f'
    ctx.font = '400 24px sans-serif'
    ctx.fillText(`${report.start} 至 ${report.end} · 共 ${rows.length} 天`, margin, 126)

    // 右上角主色角标
    ctx.fillStyle = '#5b5bd6'
    traceRoundRect(ctx, width - margin - 152, 52, 152, 52, 26)
    ctx.fill()
    ctx.fillStyle = '#ffffff'
    ctx.font = '600 22px sans-serif'
    const badgeText = '工时清单'
    const badgeWidth = ctx.measureText(badgeText).width
    ctx.fillText(badgeText, width - margin - 152 + (152 - badgeWidth) / 2, 79)

    // 表格白卡，内部全部裁切在圆角内
    ctx.save()
    traceRoundRect(ctx, margin, tableTop, contentWidth, tableHeight, 20)
    ctx.fillStyle = '#ffffff'
    ctx.fill()
    ctx.clip()

    // 表头
    ctx.fillStyle = '#ededfd'
    ctx.fillRect(margin, tableTop, contentWidth, rowHeight)
    ctx.fillStyle = '#5b5bd6'
    ctx.font = '700 24px sans-serif'
    const headerY = tableTop + rowHeight / 2
    ctx.fillText('日期', colDate, headerY)
    ctx.fillText('班次', colShift, headerY)
    ctx.fillText('差额', colDelta, headerY)
    ctx.fillText('备注', colRemark, headerY)

    rows.forEach((row, index) => {
      const y = tableTop + rowHeight * (index + 1)
      const centerY = y + rowHeight / 2

      if (index % 2 === 1) {
        ctx.fillStyle = '#f7f7fb'
        ctx.fillRect(margin, y, contentWidth, rowHeight)
      }

      // 日期列（含星期）
      const parsed = worktime.parseDateKey(row.dateKey)
      ctx.fillStyle = '#1a1a21'
      ctx.font = '500 25px sans-serif'
      ctx.fillText(`${worktime.pad(parsed.month)}-${worktime.pad(parsed.day)} 周${row.weekday}`, colDate, centerY)

      // 班次列：时间范围或类型，语义着色
      let shiftText = '未记录'
      let shiftColor = '#9d9da7'
      if (row.hasEntry && row.entry.type === worktime.DAY_TYPES.WORK) {
        shiftText = row.displayTime || '时间不完整'
        shiftColor = '#1a1a21'
      } else if (row.hasEntry && row.entry.type === worktime.DAY_TYPES.REST) {
        shiftText = '本休'
        shiftColor = '#d97706'
      } else if (row.hasEntry && row.entry.type === worktime.DAY_TYPES.LEAVE) {
        shiftText = '调休'
        shiftColor = '#e5484d'
      }
      ctx.fillStyle = shiftColor
      ctx.font = '500 25px sans-serif'
      ctx.fillText(shiftText, colShift, centerY)

      // 差额列：正靛蓝 / 负玫红 / 全天灰
      let deltaText = ''
      let deltaColor = '#65656f'
      if (row.hasEntry && !row.calc.valid) {
        deltaText = '待补全'
        deltaColor = '#d97706'
      } else if (row.hasEntry && row.entry.type === worktime.DAY_TYPES.WORK && row.calc.diffMinutes === 0) {
        deltaText = '全天'
      } else if (row.hasEntry && row.calc.diffMinutes !== 0) {
        deltaText = `${worktime.formatHours(row.calc.diffMinutes, true)}h`
        deltaColor = row.calc.diffMinutes > 0 ? '#5b5bd6' : '#e5484d'
      }
      ctx.fillStyle = deltaColor
      ctx.font = '700 25px sans-serif'
      ctx.fillText(deltaText, colDelta, centerY)

      // 备注列（仅用户手写备注）
      const remark = getReportRemark(row)
      if (remark) {
        ctx.fillStyle = '#65656f'
        ctx.font = '400 24px sans-serif'
        ctx.fillText(this.fitText(ctx, remark, width - margin - 28 - colRemark), colRemark, centerY)
      }

      // 细分隔线
      if (index < rows.length - 1) {
        ctx.strokeStyle = 'rgba(26, 26, 33, 0.05)'
        ctx.lineWidth = 1
        ctx.beginPath()
        ctx.moveTo(margin + 28, y + rowHeight)
        ctx.lineTo(width - margin - 28, y + rowHeight)
        ctx.stroke()
      }
    })
    ctx.restore()

    // 底部汇总卡
    const summaryTop = tableTop + tableHeight + 20
    ctx.fillStyle = '#ffffff'
    traceRoundRect(ctx, margin, summaryTop, contentWidth, 76, 20)
    ctx.fill()
    const summaryY = summaryTop + 38
    const totalText = `范围合计 ${worktime.formatHours(report.rangeDeltaMinutes, true)}h`
    ctx.fillStyle = report.rangeDeltaMinutes < 0 ? '#e5484d' : '#5b5bd6'
    ctx.font = '700 26px sans-serif'
    ctx.fillText(totalText, margin + 28, summaryY)
    ctx.fillStyle = '#65656f'
    ctx.font = '400 24px sans-serif'
    ctx.fillText(`已记录 ${report.recordedCount} 天`, margin + 420, summaryY)
    ctx.fillText(`未记录 ${report.missingCount} 天`, margin + 640, summaryY)

    // 底部署名与生成时间
    ctx.fillStyle = '#9d9da7'
    ctx.font = '400 20px sans-serif'
    ctx.fillText(`工时清单 · 生成于 ${worktime.formatBeijingDisplayDateTime()}`, margin, summaryTop + 76 + 32)
  },

  fitText(ctx, value, maxWidth) {
    const text = value === null || value === undefined ? '' : String(value)
    if (!text) {
      return ''
    }
    if (!ctx.measureText || ctx.measureText(text).width <= maxWidth) {
      return text
    }
    const suffix = '...'
    let result = text
    while (result.length > 0 && ctx.measureText(`${result}${suffix}`).width > maxWidth) {
      result = result.slice(0, -1)
    }
    return result ? `${result}${suffix}` : suffix
  },

  refreshRemoteBackupStatus() {
    const status = remoteBackup.getStatus()
    const state = status.state || ''
    let text = normalizeDisplayText(status.message, '')
    if (!text) {
      text = state === 'syncing' ? '正在同步远端备份' : '远端备份待同步'
    }
    if (state === 'success') {
      text = '远端备份已更新'
    }
    this.setData({
      remoteBackupStatusText: text,
      remoteBackupState: state,
      remoteBackupConflict: state === 'conflict' ? (status.cloud || null) : null
    })
  },

  // 描述云端冲突来源：设备 + 时间
  describeConflictCloud(cloud) {
    const info = cloud || {}
    const device = normalizeDisplayText(info.deviceLabel, '其他设备')
    const when = formatRemoteTime(info.savedAt || (info.updatedAt ? new Date(info.updatedAt) : '')) || '未知时间'
    return `${device} · ${when}`
  },

  // 入口：横幅“解决冲突”按钮
  resolveRemoteConflict() {
    if (this.data.isRemoteBackupLoading) {
      return
    }
    this.promptConflict(this.data.remoteBackupConflict)
  },

  // 弹出冲突选择：保留本地（覆盖云端）/ 保留云端（覆盖本地）
  promptConflict(cloud) {
    const info = cloud || remoteBackup.getStatus().cloud || {}
    wx.showModal({
      title: '检测到多端数据冲突',
      content: `云端存在更新的数据（${this.describeConflictCloud(info)}）。\n保留本地会覆盖云端，保留云端会覆盖本地。`,
      cancelText: '保留云端',
      confirmText: '保留本地',
      confirmColor: theme.DANGER_COLOR,
      success: (result) => {
        if (result.confirm) {
          this.resolveConflictKeepLocal()
        } else if (result.cancel) {
          this.resolveConflictKeepCloud(info)
        }
      }
    })
  },

  // 保留本地：强制覆盖云端
  resolveConflictKeepLocal() {
    this.setData({
      isRemoteBackupLoading: true
    })
    wx.showLoading({
      title: '正在保留本地',
      mask: true
    })
    remoteBackup.uploadBackup(this.store, {
      force: true,
      overwrite: true
    }).then((result) => {
      this.finishRemoteBackupLoading(result.ok ? '已保留本地并同步' : normalizeDisplayText(result.message, '同步失败'))
      if (result.ok) {
        this.loadRemoteBackups()
      }
    }).catch((error) => {
      const message = normalizeDisplayText(error, '同步失败')
      this.finishRemoteBackupLoading(message || '同步失败')
    })
  },

  // 保留云端：下载云端最新备份覆盖本地，并对齐基线避免再次冲突
  resolveConflictKeepCloud(cloud) {
    const fileName = cloud && cloud.fileName
    if (!fileName) {
      this.finishRemoteBackupLoading('未找到云端文件，请刷新列表后手动恢复')
      return
    }
    this.setData({
      isRemoteBackupLoading: true
    })
    wx.showLoading({
      title: '正在保留云端',
      mask: true
    })
    remoteBackup.downloadBackup(fileName).then((result) => {
      if (!result.ok || !result.backup) {
        throw new Error(normalizeDisplayText(result.message, '下载远端备份失败'))
      }
      const parsed = storage.parseBackupText(JSON.stringify(result.backup))
      if (!parsed.ok) {
        throw new Error(normalizeDisplayText(parsed.message, '远端备份不可用'))
      }
      const savedStore = storage.saveStore(parsed.store)
      this.store = savedStore
      const revision = result.backup.revision || {}
      remoteBackup.adoptRemoteState(savedStore, {
        updatedAt: revision.updatedAt || (cloud && cloud.updatedAt)
      })
      this.setData({}, () => {
        this.refresh()
        this.refreshExportText(savedStore)
      })
      this.finishRemoteBackupLoading('已保留云端')
      this.loadRemoteBackups()
    }).catch((error) => {
      const message = normalizeDisplayText(error, '恢复失败')
      this.finishRemoteBackupLoading(message || '恢复失败')
    })
  },

  finishRemoteBackupLoading(toastTitle) {
    this.setData({
      isRemoteBackupLoading: false
    })
    wx.hideLoading()
    this.refreshRemoteBackupStatus()
    const title = normalizeDisplayText(toastTitle, '')
    if (title) {
      wx.showToast({
        title,
        icon: 'none'
      })
    }
  },

  syncRemoteBackupNow() {
    if (this.data.isRemoteBackupLoading) {
      return
    }
    this.setData({
      isRemoteBackupLoading: true
    })
    wx.showLoading({
      title: '正在同步',
      mask: true
    })
    remoteBackup.flushBackup({
      store: this.store,
      force: true,
      reason: 'manual'
    }).then((result) => {
      if (result && result.conflict) {
        this.finishRemoteBackupLoading('')
        this.promptConflict(result.cloud)
        return
      }
      this.finishRemoteBackupLoading(result.ok ? '已同步' : normalizeDisplayText(result.message, '同步失败'))
      if (result.ok) {
        this.loadRemoteBackups()
      }
    }).catch((error) => {
      const message = normalizeDisplayText(error, '同步失败')
      this.finishRemoteBackupLoading(message || '同步失败')
    })
  },

  loadRemoteBackups() {
    this.refreshRemoteBackupStatus()
    return remoteBackup.listBackups().then((result) => {
      if (!result.ok) {
        this.setData({
          remoteBackups: []
        })
        const message = normalizeDisplayText(result.message, '')
        if (message) {
          this.setData({
            remoteBackupStatusText: message,
            remoteBackupState: 'failed'
          })
        }
        return
      }
      this.setData({
        remoteBackups: (result.backups || []).map(decorateRemoteBackup)
      })
    })
  },

  restoreRemoteBackup(event) {
    const fileName = event && event.currentTarget && event.currentTarget.dataset.file
    const backupTime = event && event.currentTarget && event.currentTarget.dataset.time
    if (!fileName || this.data.isRemoteBackupLoading) {
      return
    }
    if (!hasPullQuota()) {
      wx.showToast({
        title: '今日恢复次数已达上限',
        icon: 'none'
      })
      return
    }
    wx.showModal({
      title: '恢复远端备份',
      content: `将使用 ${backupTime || '所选时间'} 的远端备份覆盖当前本地数据。`,
      confirmText: '恢复',
      confirmColor: theme.DANGER_COLOR,
      success: (result) => {
        if (!result.confirm) {
          return
        }
        this.applyRemoteBackup(fileName)
      }
    })
  },

  applyRemoteBackup(fileName) {
    this.setData({
      isRemoteBackupLoading: true
    })
    wx.showLoading({
      title: '正在恢复',
      mask: true
    })
    remoteBackup.downloadBackup(fileName).then((result) => {
      if (!result.ok || !result.backup) {
        throw new Error(normalizeDisplayText(result.message, '下载远端备份失败'))
      }
      const parsed = storage.parseBackupText(JSON.stringify(result.backup))
      if (!parsed.ok) {
        throw new Error(normalizeDisplayText(parsed.message, '远端备份不可用'))
      }
      const savedStore = storage.saveStore(parsed.store)
      this.store = savedStore
      const revision = result.backup.revision || {}
      remoteBackup.adoptRemoteState(savedStore, {
        updatedAt: revision.updatedAt
      })
      consumePullQuota()
      this.setData({}, () => {
        this.refresh()
        this.refreshExportText(savedStore)
      })
      this.finishRemoteBackupLoading('恢复完成')
    }).catch((error) => {
      const message = normalizeDisplayText(error, '恢复失败')
      this.finishRemoteBackupLoading(message || '恢复失败')
    })
  }
})
