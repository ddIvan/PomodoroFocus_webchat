/**
 * 专注记录的中文文案，首页与统计页共用，保持与 Android SessionAdapter 一致。
 */
const planDao = require('./plan')
const sessionDao = require('./session')
const time = require('../utils/time')

function describeSession(s) {
  const minutes = Math.max(0, Math.floor((s.actualSeconds || 0) / 60))
  const taskTag = s.monitorEnabled ? ' · ' + planDao.taskModeText(s.taskMode) : ''
  const row = {
    id: s.id,
    timeText: time.timeOfDay(s.startTime),
    nameText: s.planName || '自由专注',
    completed: s.status === sessionDao.STATUS_COMPLETED
  }
  if (s.status === sessionDao.STATUS_COMPLETED) {
    row.metaText = Math.floor((s.plannedSeconds || 0) / 60) + ' 分钟 · 完整完成' + taskTag
    row.badgeText = '番茄 +1'
  } else if (s.status === sessionDao.STATUS_INVALID) {
    row.metaText = minutes + ' 分钟 · 分心未通过' + taskTag
    row.badgeText = '未计入'
  } else {
    row.metaText = minutes + ' 分钟 · 手动结束' + taskTag
    row.badgeText = '未计入'
  }
  return row
}

module.exports = {
  describeSession
}
