/**
 * 专注记录与统计。
 * 口径与 Android 的 FocusSessionDao 完全一致：
 * 只有 status === 0（完整完成）才计为一个番茄；统计不筛选 cleared。
 */
const storage = require('./storage')

const STATUS_COMPLETED = 0
const STATUS_ABANDONED = 1
const STATUS_INVALID = 2

function mine(accountId) {
  return storage.getAllSessions().filter((s) => s.accountId === accountId)
}

function statusText(session) {
  if (session.status === STATUS_COMPLETED) return '已完成'
  if (session.status === STATUS_ABANDONED) return '已放弃'
  return '未通过'
}

function add(session, accountId) {
  const all = storage.getAllSessions()
  const row = Object.assign(
    {
      planId: 0,
      planName: '',
      startTime: 0,
      endTime: 0,
      plannedSeconds: 0,
      actualSeconds: 0,
      dateKey: '',
      status: STATUS_COMPLETED,
      monitorEnabled: 0,
      strictness: 1,
      taskMode: 0,
      distractionCount: 0,
      distractedSeconds: 0,
      invalidReason: '',
      cleared: 0
    },
    session,
    { id: storage.nextId('session'), accountId }
  )
  all.push(row)
  storage.saveAllSessions(all)
  return row
}

function deleteSession(id, accountId) {
  storage.saveAllSessions(
    storage.getAllSessions().filter((s) => !(s.id === id && s.accountId === accountId))
  )
}

// ------------------------------------------------------------ 单日

function dayTomatoes(dateKey, accountId) {
  return mine(accountId).filter((s) => s.status === STATUS_COMPLETED && s.dateKey === dateKey).length
}

function daySeconds(dateKey, accountId) {
  return mine(accountId)
    .filter((s) => s.status === STATUS_COMPLETED && s.dateKey === dateKey)
    .reduce((sum, s) => sum + (s.actualSeconds || 0), 0)
}

/** 某天全部记录（含未通过，已清空明细不展示） */
function sessionsOfDay(dateKey, accountId) {
  return mine(accountId)
    .filter((s) => s.dateKey === dateKey && !s.cleared)
    .sort((a, b) => b.startTime - a.startTime)
}

function recent(accountId, limit) {
  return mine(accountId)
    .filter((s) => !s.cleared)
    .sort((a, b) => b.startTime - a.startTime)
    .slice(0, limit || 30)
}

// ------------------------------------------------------------ 区间统计

/** 日期区间内每日番茄数与秒数，返回 { 'yyyy-MM-dd': {count, seconds} } */
function dailyStats(fromKey, toKey, accountId) {
  const map = {}
  mine(accountId).forEach((s) => {
    if (s.status !== STATUS_COMPLETED) return
    if (!s.dateKey || s.dateKey < fromKey || s.dateKey > toKey) return
    if (!map[s.dateKey]) map[s.dateKey] = { count: 0, seconds: 0 }
    map[s.dateKey].count += 1
    map[s.dateKey].seconds += s.actualSeconds || 0
  })
  return map
}

function totalTomatoes(accountId) {
  return mine(accountId).filter((s) => s.status === STATUS_COMPLETED).length
}

function totalSeconds(accountId) {
  return mine(accountId)
    .filter((s) => s.status === STATUS_COMPLETED)
    .reduce((sum, s) => sum + (s.actualSeconds || 0), 0)
}

/** 完成过专注的全部日期，倒序 */
function completedDates(accountId) {
  const set = {}
  mine(accountId).forEach((s) => {
    if (s.status === STATUS_COMPLETED && s.dateKey) set[s.dateKey] = true
  })
  return Object.keys(set).sort().reverse()
}

function countPlanOnDay(planId, dateKey, accountId) {
  return mine(accountId).filter(
    (s) => s.status === STATUS_COMPLETED && s.planId === planId && s.dateKey === dateKey
  ).length
}

// ------------------------------------------------------------ 明细清理

/** 清空某天明细，统计不变；返回清除条数 */
function clearDay(dateKey, accountId) {
  const all = storage.getAllSessions()
  let n = 0
  all.forEach((s) => {
    if (s.accountId === accountId && s.dateKey === dateKey && !s.cleared) {
      s.cleared = 1
      n++
    }
  })
  if (n) storage.saveAllSessions(all)
  return n
}

/** 清空某天之前的明细，统计不变；返回清除条数 */
function clearBefore(dateKey, accountId) {
  const all = storage.getAllSessions()
  let n = 0
  all.forEach((s) => {
    if (s.accountId === accountId && s.dateKey < dateKey && !s.cleared) {
      s.cleared = 1
      n++
    }
  })
  if (n) storage.saveAllSessions(all)
  return n
}

// ------------------------------------------------------------ 管理端（跨账户）

function countCompletedOf(accountId) {
  return mine(accountId).filter((s) => s.status === STATUS_COMPLETED).length
}

function sumSecondsOf(accountId) {
  return mine(accountId)
    .filter((s) => s.status === STATUS_COMPLETED)
    .reduce((sum, s) => sum + (s.actualSeconds || 0), 0)
}

function completedOf(accountId) {
  return mine(accountId)
    .filter((s) => s.status === STATUS_COMPLETED)
    .sort((a, b) => b.startTime - a.startTime)
}

function deleteOneOf(id, accountId) {
  const all = storage.getAllSessions()
  const next = all.filter((s) => !(s.id === id && s.accountId === accountId))
  if (next.length === all.length) return 0
  storage.saveAllSessions(next)
  return all.length - next.length
}

function deleteByAccount(accountId) {
  const all = storage.getAllSessions()
  const next = all.filter((s) => s.accountId !== accountId)
  if (next.length === all.length) return 0
  storage.saveAllSessions(next)
  return all.length - next.length
}

/**
 * 某账户全部番茄，按日期倒序分组，日期内按开始时间正序。
 * 与 Android AdminRepository.tomatoesByDay 一致，管理员页按"第几个"定位用正序。
 */
function tomatoesByDay(accountId) {
  const days = {}
  completedOf(accountId).forEach((s) => {
    if (!days[s.dateKey]) days[s.dateKey] = []
    days[s.dateKey].push(s)
  })
  return Object.keys(days)
    .sort((a, b) => (a < b ? 1 : -1))
    .map((dateKey) => {
      const sessions = days[dateKey].sort((a, b) => a.startTime - b.startTime)
      return {
        dateKey,
        sessions,
        count: sessions.length,
        minutes: Math.floor(sessions.reduce((sum, s) => sum + (s.actualSeconds || 0), 0) / 60)
      }
    })
}

module.exports = {
  STATUS_COMPLETED,
  STATUS_ABANDONED,
  STATUS_INVALID,
  statusText,
  add,
  deleteSession,
  dayTomatoes,
  daySeconds,
  sessionsOfDay,
  recent,
  dailyStats,
  totalTomatoes,
  totalSeconds,
  completedDates,
  countPlanOnDay,
  clearDay,
  clearBefore,
  countCompletedOf,
  sumSecondsOf,
  completedOf,
  tomatoesByDay,
  deleteOneOf,
  deleteByAccount
}
