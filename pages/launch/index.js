const account = require('../../core/account')

Page({
  data: {
    tip: '正在准备…'
  },

  onLoad() {
    // 隐私政策未同意：交给登录页弹窗
    if (!account.isPrivacyAgreed()) {
      wx.reLaunch({ url: '/pages/login/index' })
      return
    }

    // 本地 token 仍有效：不打扰用户，直接进首页（断网也能用）
    if (account.restore()) {
      wx.switchTab({ url: '/pages/focus/index' })
      return
    }

    // token 缺失或已过期：静默用 wx.login 换新 token，失败才回登录页
    this.setData({ tip: '正在登录…' })
    account.ensureLogin().then((result) => {
      if (result.ok) {
        wx.switchTab({ url: '/pages/focus/index' })
        return
      }
      wx.reLaunch({ url: '/pages/login/index' })
    })
  }
})
