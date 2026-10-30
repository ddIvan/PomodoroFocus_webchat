# 番茄专注管理 · 微信小程序（PomodoroFocus Webchat）

一个微信小程序端的番茄钟：多计划管理 + 专注计时 + 摄像头专注监控 + 统计，编译产物无框架依赖、无构建步骤。

**专注数据全部保存在手机本地**（`wx.setStorage`），服务端只承担微信登录与 token 签发，不上传番茄记录、计划内容与摄像头画面。

- 类型：原生小程序（ES6，无 npm 依赖、无打包）
- 后端：[Zhuanzhu WebApi](https://github.com/ddIvan/PomodoroFocus_web)
- 默认后端地址：`https://api.tainylong.cn:8443/zhuanzhu`
- 许可证：Apache License 2.0

---

## 一、功能

| 页面 | 路径 | 职责 |
| --- | --- | --- |
| 启动页 | `pages/launch` | 品牌展示，恢复登录态后跳转 |
| 登录页 | `pages/login` | 微信一键登录；底部提供后端地址临时修改入口 |
| 隐私政策 | `pages/privacy` | 摄像头用途、数据存储方式说明 |
| 专注首页 | `pages/focus` | 今日番茄数/目标进度、今日专注分钟、当前计划、今日记录、监控开关、获得番茄动画 |
| 计划 | `pages/plans` | 计划列表，进入编辑或开始专注 |
| 计划编辑 | `pages/plan-edit` | 名称、时长 5~120 分钟、每日目标番茄数、执行频率、任务类型（盯屏/纸面） |
| 专注会话 | `pages/session` | 倒计时环、暂停/继续、结束、摄像头实时预览、分心次数与累计秒数、作废与提醒提示 |
| 统计 | `pages/stats` | 本月番茄、历史累计、连续打卡天数、月历、按日明细 |
| 监控参数 | `pages/monitor-settings` | 监控严格度、判定阈值、视角等参数调整与恢复默认 |
| 关于 | `pages/about` | 版本信息与开源许可说明 |

底部 tabBar 三项：专注 / 计划 / 统计。

---

## 二、目录结构

```
webchat/
├── app.js / app.json / app.wxss     全局入口、页面与 tabBar、全局样式
├── config.js                        后端地址默认值
├── project.config.json              开发者工具项目配置
├── sitemap.json
├── components/
│   ├── confirm-dialog/              二次确认弹窗
│   ├── form-dialog/                 表单弹窗（新建计划、修改参数等）
│   └── privacy-dialog/              隐私授权弹窗
├── core/
│   ├── api.js                       后端请求封装（统一 401 / 网络错误处理）
│   ├── account.js                   登录态与用户信息
│   ├── plan.js                      计划增删改查
│   ├── storage.js                   本地存储读写封装
│   ├── prefs.js                     偏好设置、token、地址覆盖
│   ├── runner.js                    计时器（前后台切换的补偿计时）
│   ├── session.js                   专注会话状态机（开始/暂停/结束/作废）
│   ├── monitor.js                   摄像头帧分析（8×8 网格运动/肤色占比判定）
│   ├── monitor-profile.js           监控参数（严格度、阈值）
│   ├── gain.js                      番茄获得动画与提示
│   └── labels.js                    枚举与文案
├── pages/                           10 个页面，见上表
└── utils/
    ├── statusbar.js                 状态栏高度与右上角胶囊安全区计算
    ├── sha256.js                    本地口令哈希（微信本地账户）
    └── time.js                      时间工具
```

---

## 三、运行

1. 微信开发者工具 → 导入项目 → 选择 `webchat` 目录，AppID 填 `wx48ef2793601fcff0`（或你自己的测试号）。
2. 详情 → 本地设置 → 勾选「不校验合法域名、web-view（业务域名）、TLS 版本以及 HTTPS 证书」。
3. 编译，登录页点「微信一键登录」。

后端地址的取值优先级：

| 优先级 | 来源 | 说明 |
| --- | --- | --- |
| 高 | 登录页底部「服务器」填写 | 写入本地 `api_base_override`，仅本机生效 |
| 低 | `config.js` 的 `DEFAULT_API_BASE` | 默认值，改动后需重新编译 |

如果真机报「不在以下 request 合法域名列表中」，先确认小程序后台「开发管理 → 开发设置 → 服务器域名」的 request 合法域名已填 `https://api.tainylong.cn:8443`（**不带路径**），再确认 `config.js` 的协议、域名、端口与之逐字一致。

---

## 四、摄像头监控

小程序拿不到人脸关键点，`core/monitor.js` 通过 `CameraContext.onCameraFrame` 取原始像素，按 8×8 网格统计两个指标：

- `motionRatio`：灰度变化明显的格子占比 → 判断手/笔是否在动
- `faceRatio`：中央区域肤色像素占比 → 判断人在不在镜头前

判定沿用 Android 端语义：

| 场景 | 判据 |
| --- | --- |
| 前置 · 盯屏 | 长时间看不见人 → 分心（作废级） |
| 前置 · 纸面 | 看不见人是常态，超长仅提醒，不计入 |
| 俯拍 · 纸面 | 画面长时间静止 → 先提醒，超阈值作废 |
| 俯拍 · 盯屏 | 先提醒，后作废 |

帧数据只在内存中参与当次计算，**不落盘、不上传、不经过后端**。

---

## 五、发布

1. 开发者工具「上传」，填版本号与备注。
2. 小程序后台 → 版本管理 → 提交审核。审核前需在小程序后台填写隐私协议，说明摄像头用于专注状态检测、画面仅本地处理。
3. 正式版同样受合法域名校验约束，`config.js` 的地址必须是后台配置过的 https 地址。

---

## 六、许可证

本项目基于 [Apache License 2.0](LICENSE) 发布，版权声明见 [NOTICE](NOTICE)。

Copyright 2026 ddIvan
