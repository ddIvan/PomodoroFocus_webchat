/**
 * 自定义导航栏页面的顶部尺寸计算。
 *
 * 微信右上角的胶囊按钮（··· 和 ○）是悬浮在页面之上的原生控件，
 * navigationStyle: custom 时页面内容会顶到状态栏下方，右上角区域会被胶囊遮挡。
 * 因此自定义导航栏页面必须按胶囊实际位置让出安全区：
 *   · 纵向：内容从胶囊底部之下开始（safeTop）
 *   · 横向：靠右的元素左边界不得超过胶囊左边界（rightGap）
 *
 * 低版本基础库没有 getWindowInfo / getMenuButtonBoundingClientRect 时逐级回退。
 */

let cachedCapsule = null
let cachedWindow = null

/** 窗口信息，取不到时返回空对象 */
function windowInfo() {
  if (cachedWindow) return cachedWindow
  try {
    if (typeof wx.getWindowInfo === 'function') {
      const info = wx.getWindowInfo()
      if (info && info.windowWidth) {
        cachedWindow = info
        return cachedWindow
      }
    }
  } catch (e) {
    /* ignore */
  }
  try {
    const info = wx.getSystemInfoSync()
    if (info && info.windowWidth) {
      cachedWindow = info
      return cachedWindow
    }
  } catch (e) {
    /* ignore */
  }
  return cachedWindow || {}
}

/** 状态栏高度（刘海/挖孔屏各不相同） */
function height() {
  const info = windowInfo()
  if (info.statusBarHeight) return info.statusBarHeight
  return 20
}

/** 胶囊按钮位置 { top, bottom, left, right, width, height }，取不到返回 null */
function capsule() {
  if (cachedCapsule) return cachedCapsule
  try {
    if (typeof wx.getMenuButtonBoundingClientRect === 'function') {
      const rect = wx.getMenuButtonBoundingClientRect()
      // 部分机型首帧会返回全 0，此时不缓存，等下次再取
      if (rect && rect.bottom > 0 && rect.top > 0) {
        cachedCapsule = rect
        return cachedCapsule
      }
    }
  } catch (e) {
    /* ignore */
  }
  return null
}

/**
 * 页面内容应开始的 y 坐标：胶囊底部 + 间距。
 * @param {number} [gap] 胶囊底部之下的额外留白，默认 8px
 */
function safeTop(gap) {
  const extra = typeof gap === 'number' ? gap : 8
  const rect = capsule()
  if (rect) return Math.round(rect.bottom + extra)
  // 兜底：状态栏 + 一行导航栏高度（胶囊通常垂直居中于这一行）
  return Math.round(height() + 44 + extra)
}

/**
 * 右侧需要让出的宽度（px）：从屏幕右边缘到胶囊左边界，再加间距。
 * 用于自定义标题栏右侧放置按钮/文字时避免被胶囊压住。
 * @param {number} [gap] 与胶囊左边界之间的额外留白，默认 8px
 */
function rightGap(gap) {
  const extra = typeof gap === 'number' ? gap : 8
  const rect = capsule()
  if (!rect) return 0
  const width = windowInfo().windowWidth || 375
  const value = width - rect.left + extra
  return value > 0 ? Math.round(value) : 0
}

/** 胶囊整体宽度，兜底 96px */
function capsuleWidth() {
  const rect = capsule()
  return rect ? Math.round(rect.width) : 96
}

module.exports = {
  height,
  capsule,
  safeTop,
  rightGap,
  capsuleWidth
}
