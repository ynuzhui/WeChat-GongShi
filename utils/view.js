const worktime = require('./worktime')

function addHourSuffix(value) {
  return `${value}小时`
}

function getEntryMainText(row) {
  if (!row.hasEntry) {
    return '未记录'
  }
  if (row.entry.type === worktime.DAY_TYPES.WORK) {
    return row.displayTime || row.calc.label
  }
  return row.displayType
}

function decorateRows(rows, selectedDate) {
  return rows.map((row) => {
    const isWork = row.entry && row.entry.type === worktime.DAY_TYPES.WORK
    const isRest = row.entry && row.entry.type === worktime.DAY_TYPES.REST
    const isLeave = row.entry && row.entry.type === worktime.DAY_TYPES.LEAVE
    const deltaMinutes = row.calc.diffMinutes
    const canDisplayCalc = row.calc.valid !== false

    return Object.assign({}, row, {
      isSelected: row.dateKey === selectedDate,
      displayMain: getEntryMainText(row),
      displaySub: row.hasEntry && isWork && canDisplayCalc && row.calc.diffMinutes === 0 ? '无' : '',
      displayDeltaText: row.displayDelta || '-',
      displayBalanceText: row.displayBalance || '-',
      deltaClass: canDisplayCalc && deltaMinutes > 0 ? 'is-plus' : (canDisplayCalc && deltaMinutes < 0 ? 'is-minus' : ''),
      typeClass: isRest ? 'is-rest' : (isLeave ? 'is-leave' : '')
    })
  })
}

function buildEntrySummary(calc) {
  if (!calc.valid) {
    return '时间需要补全后才能计算'
  }
  const diff = addHourSuffix(worktime.formatHours(calc.diffMinutes, true))
  if (calc.type === worktime.DAY_TYPES.WORK) {
    const worked = addHourSuffix(worktime.formatHours(calc.workedMinutes))
    const breakText = calc.breakDeducted ? `，已扣休${addHourSuffix(worktime.formatHours(calc.breakDeducted))}` : '，未扣休'
    return `当日差额 ${diff}，实计 ${worked}${breakText}`
  }
  if (calc.type === worktime.DAY_TYPES.LEAVE) {
    return `当日差额 ${diff}，按调休一天计算`
  }
  if (calc.type === worktime.DAY_TYPES.REST) {
    return `当日差额 ${diff}，本休不影响结余`
  }
  return `当日差额 ${diff}`
}

function buildPresetOptions(presets) {
  return presets.map((preset) => worktime.formatPresetOption(preset))
}

function buildSaveStateLabel(hasRecord, isDirty) {
  if (isDirty) {
    return '未保存'
  }
  return hasRecord ? '已记' : '草稿'
}

function buildDateStatus(row) {
  if (!row || !row.hasEntry) {
    return {
      time: '未记录',
      diff: '-'
    }
  }
  if (!row.calc.valid) {
    return {
      time: row.displayTime || row.calc.label,
      diff: '待算'
    }
  }
  if (row.entry.type === worktime.DAY_TYPES.WORK) {
    return {
      time: row.displayTime || row.calc.label,
      diff: row.calc.diffMinutes === 0 ? '无' : `${worktime.formatHours(row.calc.diffMinutes, true)}h`
    }
  }
  return {
    time: row.displayType,
    diff: `${worktime.formatHours(row.calc.diffMinutes, true)}h`
  }
}

module.exports = {
  addHourSuffix,
  decorateRows,
  buildEntrySummary,
  buildPresetOptions,
  buildSaveStateLabel,
  buildDateStatus
}
