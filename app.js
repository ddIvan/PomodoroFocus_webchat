const storage = require('./core/storage')
const account = require('./core/account')
const prefs = require('./core/prefs')

App({
  globalData: {
    /** 从专注页回到首页时携带的「本次收获番茄」，用于播入账动效 */
    tomatoGained: false,
    /** 跨页传递的计划选择结果 */
    pendingPlanId: 0
  },

  onLaunch() {
    // 首次运行标记，幂等；本地账户改由微信登录创建
    storage.ensureSeed()
    // 跨天自动清理历史明细，每天都清理一次（与 Android 一致）
    account.autoClearIfNeeded()
  },

  /** 是否有未消费的入账标记 */
  takeTomatoGained() {
    const v = this.globalData.tomatoGained
    this.globalData.tomatoGained = false
    return v
  },

  /** 主动标记，供专注页结束时调用 */
  markTomatoGained() {
    this.globalData.tomatoGained = true
  }
})
