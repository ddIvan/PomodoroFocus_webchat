const prefs = require('../../core/prefs')
const sessionDao = require('../../core/session')
const labels = require('../../core/labels')
const time = require('../../utils/time')

const WEEK_LABELS = ['日', '一', '二', '三', '四', '五', '六']

Page({
  data: {
    monthTitle: '',
    canNext: false,
    weekLabels: WEEK_LABELS,
    cells: [],

    monthTomatoes: 0,
    monthMinutes: 0,
    totalTomatoes: 0,

    selectedTitle: '',
    selectedSummary: '',
    dayRows: [],
    emptyDay: true,
    emptyDayText: '这一天没有专注记录'
  },

  onLoad() {
    const now = new Date()
    this._year = now.getFullYear()
    this._month = now.getMonth() + 1
    this._selected = time.todayKey()
  },

  onShow() {
    this.render()
  },

  render() {
    const accountId = prefs.currentAccountId()
    const y = this._year
    const m = this._month
    const days = time.daysInMonth(y, m)
    const fromKey = time.dateKey(new Date(y, m - 1, 1))
    const toKey = time.dateKey(new Date(y, m - 1, days))
    const stats = sessionDao.dailyStats(fromKey, toKey, accountId)
    const today = time.todayKey()
    const now = new Date()

    // 首行按周对齐，周日开头
    const cells = []
    const lead = time.firstWeekday(y, m)
    for (let i = 0; i < lead; i++) cells.push({ key: 'blank-' + i, blank: true })

    let monthTomatoes = 0
    let monthSeconds = 0
    for (let d = 1; d <= days; d++) {
      const key = time.dateKey(new Date(y, m - 1, d))
      const row = stats[key]
      const count = row ? row.count : 0
      monthTomatoes += count
      monthSeconds += row ? row.seconds : 0
      cells.push({
        key,
        blank: false,
        day: d,
        count,
        selected: key === this._selected,
        isToday: key === today
      })
    }

    // 选中日期不在本月时（如跨月切换）回落到 1 号
    if (String(this._selected).slice(0, 7) !== y + '-' + (m < 10 ? '0' + m : m)) {
      this._selected = fromKey
      cells.forEach((c) => {
        if (!c.blank) c.selected = c.key === this._selected
      })
    }

    const selectedKey = this._selected
    const rows = sessionDao.sessionsOfDay(selectedKey, accountId)
    const dayTomatoes = sessionDao.dayTomatoes(selectedKey, accountId)
    const daySeconds = sessionDao.daySeconds(selectedKey, accountId)

    let summary = ''
    if (dayTomatoes > 0) {
      summary = dayTomatoes + ' 个番茄 · ' + Math.floor(daySeconds / 60) + ' 分钟'
    } else if (rows.length > 0) {
      summary = '没有完成的番茄 · 记录 ' + rows.length + ' 条'
    }

    this.setData({
      monthTitle: time.monthTitle(y, m),
      canNext: !(y === now.getFullYear() && m === now.getMonth() + 1),
      cells,
      monthTomatoes,
      monthMinutes: Math.floor(monthSeconds / 60),
      totalTomatoes: sessionDao.totalTomatoes(accountId),
      selectedTitle: selectedKey === today ? '今天' : time.dayTitle(time.parseDateKey(selectedKey)),
      selectedSummary: summary,
      dayRows: rows.map(labels.describeSession),
      emptyDay: rows.length === 0,
      emptyDayText: dayTomatoes > 0
        ? '明细已清空\n番茄数已计入统计'
        : '这一天没有专注记录\n完成一个完整时段即可收获一枚番茄'
    })
  },

  onSelectDay(e) {
    const key = e.currentTarget.dataset.key
    if (!key || String(key).indexOf('blank-') === 0 || this._selected === key) return
    this._selected = key
    this.render()
  },

  onPrevMonth() {
    this._month -= 1
    if (this._month < 1) {
      this._month = 12
      this._year -= 1
    }
    this._selected = time.dateKey(new Date(this._year, this._month - 1, 1))
    this.render()
  },

  onNextMonth() {
    if (!this.data.canNext) return
    this._month += 1
    if (this._month > 12) {
      this._month = 1
      this._year += 1
    }
    this._selected = time.dateKey(new Date(this._year, this._month - 1, 1))
    this.render()
  }
})
