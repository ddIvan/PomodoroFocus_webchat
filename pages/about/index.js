const statusbar = require('../../utils/statusbar')

/** 关于页，对应 Android AboutActivity */
Page({
  data: {
    statusBarHeight: 20,
    appName: '番茄专注管理',
    version: '开发版'
  },

  onLoad() {
    let version = ''
    try {
      const info = wx.getAccountInfoSync()
      version = (info && info.miniProgram && info.miniProgram.version) || ''
    } catch (e) {
      version = ''
    }
    this.setData({
      statusBarHeight: statusbar.height(),
      version: version ? '版本 ' + version : '开发版'
    })
  },

  openPrivacy() {
    wx.navigateTo({ url: '/pages/privacy/index?from=about' })
  },

  onBack() {
    const pages = getCurrentPages()
    if (pages.length > 1) wx.navigateBack({ delta: 1 })
    else wx.switchTab({ url: '/pages/focus/index' })
  }
})
