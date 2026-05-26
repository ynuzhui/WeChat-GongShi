const worktime = require('../../utils/worktime')
const storage = require('../../utils/storage')
const view = require('../../utils/view')

const CANVAS_WIDTH = 960
const REPORT_ROW_HEIGHT = 48
const REPORT_TABLE_Y = 88

function createPresetForm() {
  return {
    id: '',
    start: '09:30',
    end: '17:00',
    deductBreak: true
  }
}

function findPresetIndex(presets, presetId) {
  return presets.findIndex((preset) => preset.id === presetId)
}

function getReportRemark(row) {
  if (!row.hasEntry) {
    return ''
  }
  if (row.entry.note) {
    return row.entry.note
  }
  if (row.entry.type === worktime.DAY_TYPES.WORK) {
    return row.displayTime || row.calc.label
  }
  return row.displayType
}

function getEventValue(event) {
  const detail = event ? event.detail : ''
  if (detail && typeof detail === 'object' && Object.prototype.hasOwnProperty.call(detail, 'value')) {
    return detail.value
  }
  return detail
}

function getPresetTimePickerValue(form, key) {
  const fallback = key === 'start' ? '09:30' : '17:00'
  return worktime.getHalfHourTimePickerValue(form && form[key], fallback)
}

function getDevicePixelRatio() {
  try {
    const info = wx.getSystemInfoSync ? wx.getSystemInfoSync() : null
    return info && info.pixelRatio ? info.pixelRatio : 1
  } catch (error) {
    return 1
  }
}

Page({
  pendingImportStore: null,
  isGeneratingReport: false,

  data: {
    store: worktime.createDefaultStore(),
    presets: [],
    presetOptions: [],
    presetForm: createPresetForm(),
    editingPresetId: '',
    selectedPresetId: '',
    selectedPresetLabel: '选择班次',
    selectedPresetIndex: 0,
    isPresetEditorVisible: false,
    isAddingPreset: false,
    timePickerRange: worktime.buildHalfHourTimePickerRange(),
    presetStartTimePickerValue: worktime.getHalfHourTimePickerValue('09:30'),
    presetEndTimePickerValue: worktime.getHalfHourTimePickerValue('17:00'),
    currentMonthKey: worktime.toMonthKey(new Date()),
    monthLabel: '',
    monthRows: [],
    ledger: {
      openingBalanceMinutes: 0,
      monthDeltaMinutes: 0,
      closingBalanceMinutes: 0
    },
    exportStart: '',
    exportEnd: '',
    exportLines: [],
    exportText: '',
    exportDeltaText: '',
    canvasWidth: CANVAS_WIDTH,
    canvasHeight: 1280,
    reportImagePath: '',
    exportFilePath: '',
    pendingImportPreview: null,
    pendingImportFileName: ''
  },

  onLoad() {
    const monthKey = worktime.toMonthKey(new Date())
    this.setData({
      currentMonthKey: monthKey,
      exportStart: worktime.getDateKey(monthKey, 1),
      exportEnd: worktime.getTodayKey()
    }, () => this.refresh())
  },

  onShow() {
    this.refresh()
  },

  refresh() {
    const store = storage.loadStore()
    const monthView = worktime.buildMonthView(store, this.data.currentMonthKey)
    const exportLines = worktime.buildExportLines(store, this.data.exportStart, this.data.exportEnd)
    const selectedPreset = worktime.getPresetById(store, this.data.selectedPresetId)

    this.setData({
      store,
      presets: store.settings.presets,
      presetOptions: view.buildPresetOptions(store.settings.presets),
      selectedPresetId: selectedPreset ? selectedPreset.id : '',
      selectedPresetIndex: Math.max(0, findPresetIndex(store.settings.presets, this.data.selectedPresetId)),
      selectedPresetLabel: selectedPreset ? worktime.formatPresetOption(selectedPreset) : (this.data.isAddingPreset ? '新增班次' : '选择班次'),
      monthLabel: monthView.monthLabel,
      monthRows: view.decorateRows(monthView.rows),
      ledger: monthView.ledger,
      exportLines,
      exportText: exportLines.join('\n'),
      exportDeltaText: worktime.buildDeltaExportText(store, this.data.exportStart, this.data.exportEnd),
      presetStartTimePickerValue: getPresetTimePickerValue(this.data.presetForm, 'start'),
      presetEndTimePickerValue: getPresetTimePickerValue(this.data.presetForm, 'end')
    })
  },

  applyManagedPreset(preset) {
    if (!preset) {
      return
    }
    this.setData({
      selectedPresetId: preset.id,
      selectedPresetIndex: Math.max(0, findPresetIndex(this.data.presets, preset.id)),
      selectedPresetLabel: worktime.formatPresetOption(preset),
      presetForm: Object.assign({}, preset),
      editingPresetId: preset.id,
      isPresetEditorVisible: false,
      isAddingPreset: false,
      presetStartTimePickerValue: getPresetTimePickerValue(preset, 'start'),
      presetEndTimePickerValue: getPresetTimePickerValue(preset, 'end')
    })
  },

  onManagedPresetPickerChange(event) {
    const index = Number(event.detail.value)
    this.applyManagedPreset(this.data.presets[index])
  },

  startAddPreset() {
    const form = createPresetForm()
    form.id = `preset-${Date.now()}`
    this.setData({
      selectedPresetId: '',
      selectedPresetLabel: '新增班次',
      presetForm: form,
      editingPresetId: '',
      isPresetEditorVisible: true,
      isAddingPreset: true,
      presetStartTimePickerValue: getPresetTimePickerValue(form, 'start'),
      presetEndTimePickerValue: getPresetTimePickerValue(form, 'end')
    })
  },

  editSelectedPreset() {
    if (!this.data.selectedPresetId) {
      return
    }
    this.setData({
      isPresetEditorVisible: true,
      isAddingPreset: false
    })
  },

  onPresetStartChange(event) {
    const start = worktime.getHalfHourTimeFromPickerValue(event.detail.value, this.data.presetForm.start)
    this.setData({
      'presetForm.start': start,
      presetStartTimePickerValue: getPresetTimePickerValue({ start }, 'start')
    })
  },

  onPresetEndChange(event) {
    const end = worktime.getHalfHourTimeFromPickerValue(event.detail.value, this.data.presetForm.end)
    this.setData({
      'presetForm.end': end,
      presetEndTimePickerValue: getPresetTimePickerValue({ end }, 'end')
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
    const nextStore = worktime.upsertPreset(this.data.store, form)
    const savedStore = storage.saveStore(nextStore)
    const savedPreset = worktime.getPresetById(savedStore, form.id)
    this.setData({
      store: savedStore,
      selectedPresetId: form.id,
      selectedPresetLabel: worktime.formatPresetOption(savedPreset || form),
      presetForm: Object.assign({}, savedPreset || form),
      editingPresetId: form.id,
      isPresetEditorVisible: false,
      isAddingPreset: false,
      presetStartTimePickerValue: getPresetTimePickerValue(savedPreset || form, 'start'),
      presetEndTimePickerValue: getPresetTimePickerValue(savedPreset || form, 'end')
    }, () => this.refresh())
    wx.showToast({
      title: '已保存'
    })
  },

  cancelPresetEdit() {
    this.setData({
      presetForm: createPresetForm(),
      editingPresetId: '',
      selectedPresetId: '',
      selectedPresetLabel: '选择班次',
      isPresetEditorVisible: false,
      isAddingPreset: false,
      presetStartTimePickerValue: getPresetTimePickerValue(createPresetForm(), 'start'),
      presetEndTimePickerValue: getPresetTimePickerValue(createPresetForm(), 'end')
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
      confirmColor: '#b13b2e',
      success: (result) => {
        if (!result.confirm) {
          return
        }
        const nextStore = worktime.deletePreset(this.data.store, presetId)
        storage.saveStore(nextStore)
        this.setData({
          presetForm: createPresetForm(),
          editingPresetId: '',
          selectedPresetId: '',
          selectedPresetLabel: '选择班次',
          isPresetEditorVisible: false,
          isAddingPreset: false,
          presetStartTimePickerValue: getPresetTimePickerValue(createPresetForm(), 'start'),
          presetEndTimePickerValue: getPresetTimePickerValue(createPresetForm(), 'end')
        }, () => this.refresh())
      }
    })
  },

  onExportStartChange(event) {
    this.setData({
      exportStart: event.detail.value
    }, () => this.refresh())
  },

  onExportEndChange(event) {
    this.setData({
      exportEnd: event.detail.value
    }, () => this.refresh())
  },

  useMonthExportRange() {
    const start = worktime.getDateKey(this.data.currentMonthKey, 1)
    const end = worktime.getDateKey(this.data.currentMonthKey, worktime.daysInMonth(this.data.currentMonthKey))
    this.setData({
      exportStart: start,
      exportEnd: end
    }, () => this.refresh())
  },

  useWeekExportRange() {
    const today = worktime.getTodayKey()
    const range = worktime.getWeekRange(today)
    this.setData({
      currentMonthKey: worktime.toMonthKey(today),
      exportStart: range.start,
      exportEnd: range.end
    }, () => this.refresh())
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
    this.copyToClipboard(this.data.exportText)
  },

  copyExportDeltaText() {
    this.copyToClipboard(this.data.exportDeltaText)
  },

  generateReportImage() {
    if (this.isGeneratingReport) {
      return
    }
    this.isGeneratingReport = true
    wx.showLoading({
      title: '正在生成',
      mask: true
    })
    const height = REPORT_TABLE_Y + (this.data.monthRows.length + 1) * REPORT_ROW_HEIGHT + 96
    this.setData({
      canvasHeight: height
    }, () => this.drawReportImage(height))
  },

  drawReportImage(height) {
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
        canvas.width = width * dpr
        canvas.height = height * dpr

        const ctx = canvas.getContext('2d')
        ctx.save()
        ctx.scale(dpr, dpr)
        this.drawReportCanvas(ctx, width, height)
        ctx.restore()

        wx.canvasToTempFilePath({
          canvas,
          x: 0,
          y: 0,
          width,
          height,
          destWidth: width * dpr,
          destHeight: height * dpr,
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

  finishReportGeneration(success) {
    this.isGeneratingReport = false
    wx.hideLoading()
    if (!success) {
      wx.showToast({
        title: '生成图片失败',
        icon: 'none'
      })
    }
  },

  drawReportCanvas(ctx, width, height) {
    const tableX = 32
    const tableY = REPORT_TABLE_Y
    const rowHeight = REPORT_ROW_HEIGHT
    const columns = [32, 202, 377, 928]
    const rows = this.data.monthRows
    const ledger = this.data.ledger

    ctx.clearRect(0, 0, width, height)
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, width, height)
    ctx.textBaseline = 'middle'

    ctx.fillStyle = '#17211d'
    ctx.font = '700 34px sans-serif'
    ctx.fillText(`${this.data.monthLabel}工时表`, tableX, 42)

    ctx.fillStyle = '#dfeee8'
    ctx.fillRect(tableX, tableY, columns[3] - tableX, rowHeight)
    this.drawTableGrid(ctx, columns, tableY, rowHeight, rows.length + 1)

    ctx.font = '600 22px sans-serif'
    ctx.fillStyle = '#52615c'
    ctx.fillText('日期', columns[0] + 12, tableY + rowHeight / 2)
    ctx.fillText('差额', columns[1] + 12, tableY + rowHeight / 2)
    ctx.fillText('备注', columns[2] + 12, tableY + rowHeight / 2)

    rows.forEach((row, index) => {
      const y = tableY + rowHeight * (index + 1)
      const calc = row.calc || {}
      const delta = row.hasEntry && calc.valid !== false ? worktime.formatHours(calc.diffMinutes, true) : ''
      const remark = getReportRemark(row)

      ctx.fillStyle = index % 2 === 0 ? '#ffffff' : '#f1f7f4'
      ctx.fillRect(tableX, y, columns[3] - tableX, rowHeight)
      ctx.fillStyle = '#17211d'
      ctx.font = '500 21px sans-serif'
      ctx.fillText(`${row.day}日`, columns[0] + 12, y + rowHeight / 2)
      ctx.fillText(delta, columns[1] + 12, y + rowHeight / 2)
      ctx.fillText(this.fitText(ctx, String(remark), columns[3] - columns[2] - 24), columns[2] + 12, y + rowHeight / 2)
    })

    const summaryY = tableY + rowHeight * (rows.length + 1) + 34
    ctx.fillStyle = '#17211d'
    ctx.font = '600 22px sans-serif'
    ctx.fillText(`上月结余：${worktime.formatHours(ledger.openingBalanceMinutes)}h`, tableX, summaryY)
    ctx.fillText(`本月结算：${worktime.formatHours(ledger.monthDeltaMinutes, true)}h`, tableX + 300, summaryY)
    ctx.fillText(`本月结余：${worktime.formatHours(ledger.closingBalanceMinutes)}h`, tableX + 600, summaryY)
  },

  drawTableGrid(ctx, columns, tableY, rowHeight, rowCount) {
    const bottom = tableY + rowHeight * rowCount
    ctx.strokeStyle = '#bfcec7'
    ctx.lineWidth = 1
    columns.forEach((x) => {
      ctx.beginPath()
      ctx.moveTo(x, tableY)
      ctx.lineTo(x, bottom)
      ctx.stroke()
    })
    for (let index = 0; index <= rowCount; index += 1) {
      const y = tableY + rowHeight * index
      ctx.beginPath()
      ctx.moveTo(columns[0], y)
      ctx.lineTo(columns[columns.length - 1], y)
      ctx.stroke()
    }
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

  exportBackupFile() {
    const fileName = storage.makeBackupFileName()
    const filePath = `${wx.env.USER_DATA_PATH}/${fileName}`
    wx.getFileSystemManager().writeFile({
      filePath,
      data: storage.serializeBackup(this.data.store),
      encoding: 'utf8',
      success: () => {
        this.setData({
          exportFilePath: ''
        })
        if (wx.shareFileMessage) {
          wx.shareFileMessage({
            filePath,
            fileName,
            success: () => {
              wx.showToast({
                title: '已发送'
              })
            },
            fail: () => {
              wx.showToast({
                title: '文件已生成',
                icon: 'none'
              })
            }
          })
          return
        }
        wx.showToast({
          title: '文件已生成',
          icon: 'none'
        })
      },
      fail: () => {
        wx.showToast({
          title: '导出失败',
          icon: 'none'
        })
      }
    })
  },

  chooseImportFile() {
    if (!wx.chooseMessageFile) {
      wx.showToast({
        title: '当前环境不支持文件选择',
        icon: 'none'
      })
      return
    }
    wx.chooseMessageFile({
      count: 1,
      type: 'file',
      extension: ['json'],
      success: (result) => {
        const file = result.tempFiles && result.tempFiles[0]
        if (!file || !file.path) {
          wx.showToast({
            title: '没有选择文件',
            icon: 'none'
          })
          return
        }
        this.readImportFile(file)
      }
    })
  },

  readImportFile(file) {
    wx.getFileSystemManager().readFile({
      filePath: file.path,
      encoding: 'utf8',
      success: (result) => {
        const parsed = storage.parseBackupText(result.data)
        if (!parsed.ok) {
          this.pendingImportStore = null
          this.setData({
            pendingImportPreview: null,
            pendingImportFileName: ''
          })
          wx.showToast({
            title: parsed.message,
            icon: 'none'
          })
          return
        }
        this.pendingImportStore = parsed.store
        this.setData({
          pendingImportPreview: parsed.preview,
          pendingImportFileName: file.name || '备份文件'
        })
      },
      fail: () => {
        wx.showToast({
          title: '读取文件失败',
          icon: 'none'
        })
      }
    })
  },

  confirmImport() {
    if (!this.pendingImportStore) {
      return
    }
    wx.showModal({
      title: '覆盖本地数据',
      content: '导入后会整体替换当前本地记录和班次。',
      confirmText: '覆盖',
      confirmColor: '#b13b2e',
      success: (result) => {
        if (!result.confirm) {
          return
        }
        storage.saveStore(this.pendingImportStore)
        this.pendingImportStore = null
        this.setData({
          pendingImportPreview: null,
          pendingImportFileName: ''
        }, () => this.refresh())
        wx.showToast({
          title: '导入完成'
        })
      }
    })
  },

  cancelImport() {
    this.pendingImportStore = null
    this.setData({
      pendingImportPreview: null,
      pendingImportFileName: ''
    })
  }
})
