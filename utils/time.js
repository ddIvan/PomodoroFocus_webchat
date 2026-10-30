/** 时间与文案格式化，与 Android 版 TimeUtils 保持一致 */

const WEEK_NAMES = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六']

function pad2(n) {
  return (n < 10 ? '0' : '') + n
}

/** 秒 -> mm:ss（超过一小时则 h:mm:ss） */
function clock(totalSeconds) {
  const s = Math.max(0, Math.floor(totalSeconds || 0))
  const hours = Math.floor(s / 3600)
  const minutes = Math.floor((s % 3600) / 60)
  const seconds = s % 60
  if (hours > 0) return hours + ':' + pad2(minutes) + ':' + pad2(seconds)
  return pad2(minutes) + ':' + pad2(seconds)
}

/** 秒 -> "25 分钟" / "1 小时 10 分钟" */
function durationText(totalSeconds) {
  const minutes = Math.floor((totalSeconds || 0) / 60)
  if (minutes < 60) return minutes + ' 分钟'
  if (minutes % 60 === 0) return minutes / 60 + ' 小时'
  return Math.floor(minutes / 60) + ' 小时 ' + (minutes % 60) + ' 分钟'
}

/** Date -> "yyyy-MM-dd" */
function dateKey(date) {
  const d = date || new Date()
  return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate())
}

function todayKey() {
  return dateKey(new Date())
}

/** "yyyy-MM-dd" -> Date（零点） */
function parseDateKey(key) {
  if (!key) return null
  const parts = String(key).split('-')
  if (parts.length !== 3) return null
  return new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]))
}

/** "10月27日 星期二" */
function dayTitle(date) {
  const d = date || new Date()
  return d.getMonth() + 1 + '月' + d.getDate() + '日 ' + WEEK_NAMES[d.getDay()]
}

/** "2026年10月" */
function monthTitle(year, month) {
  // month 为 1-12
  return year + '年' + month + '月'
}

/** 时间戳 -> "HH:mm" */
function timeOfDay(millis) {
  const d = new Date(millis)
  return pad2(d.getHours()) + ':' + pad2(d.getMinutes())
}

function toastTimeRange(start, end) {
  return timeOfDay(start) + ' - ' + timeOfDay(end)
}

/** 某月天数 */
function daysInMonth(year, month) {
  return new Date(year, month, 0).getDate()
}

/** 某月 1 号是星期几（0=周日） */
function firstWeekday(year, month) {
  return new Date(year, month - 1, 1).getDay()
}

/** 两个 dateKey 相差天数 */
function daysBetween(fromKey, toKey) {
  const a = parseDateKey(fromKey)
  const b = parseDateKey(toKey)
  if (!a || !b) return 0
  return Math.round((b - a) / 86400000)
}

function addDays(date, n) {
  const d = new Date(date.getTime())
  d.setDate(d.getDate() + n)
  return d
}

module.exports = {
  pad2,
  clock,
  durationText,
  dateKey,
  todayKey,
  parseDateKey,
  dayTitle,
  monthTitle,
  timeOfDay,
  toastTimeRange,
  daysInMonth,
  firstWeekday,
  daysBetween,
  addDays
}
