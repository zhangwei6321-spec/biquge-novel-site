## 🎤 协理员面试练习

> 浏览器端面试模拟工具 — 摄像头录制 / 计时器 / 语音实时转文字 / 文字稿导出。

🔗 在线访问：[zhangwei6321-spec.github.io/biquge-novel-site](https://zhangwei6321-spec.github.io/biquge-novel-site/)

---

## ✨ 功能

- 📹 **摄像头录制** — 浏览器调用摄像头，录制面试答题视频，支持暂停/继续/停止
- ⏱️ **计时器** — 画面实时显示录制时长
- 🗣 **语音转文字** — 基于 Web Speech API，录制中实时转写（推荐 Chrome / Edge）
- 📝 **文字稿导出** — 一键导出 `.txt` 文字稿，附带题目和日期
- 📋 **面试题库** — 内置 20 道协理员面试常见题，随机出题
- 📼 **录制记录** — 历史录制列表，支持回放和导出

---

## 🛠 技术栈

纯 HTML / CSS / JavaScript，无框架依赖

- MediaRecorder API — 视频录制
- Web Speech API — 语音实时转写
- GitHub Pages — 静态部署

---

## ⚠ 浏览器兼容

| 功能 | Chrome | Edge | Safari | Firefox |
|------|--------|------|--------|---------|
| 摄像头录制 | ✅ | ✅ | ✅ | ✅ |
| 计时器 | ✅ | ✅ | ✅ | ✅ |
| 语音转文字 | ✅ | ✅ | ❌ | ❌ |

语音转文字需 Chromium 内核浏览器。

---

## 📂 本地使用

```bash
git clone https://github.com/zhangwei6321-spec/biquge-novel-site.git
cd biquge-novel-site
open index.html
```


---

# 🧧 算得准

> 在线算命大全 — 综合八字、紫微、称骨、星座、生肖、塔罗等 16 种传统测算。

🔗 在线访问：[zhangwei6321-spec.github.io/biquge-novel-site/suandezhun/](https://zhangwei6321-spec.github.io/biquge-novel-site/suandezhun/)

## ✨ 功能

- 🏮 **16 大算命门类** — 八字命理 / 紫微斗数 / 称骨算命 / 五行测算 / 姓名解析 / 塔罗牌 / 求签占卜 / 周公解梦 / 六爻占卜 / 面相分析 / 手相解读 / 每日运势 / 星座运势 / 生肖运势 / 姻缘配对 / 财运预测 / 风水运势
- 📅 **农历支持** — 1900-2100 年农历转换，支持闰月选择
- 📍 **真太阳时** — 选择省市县自动修正出生时辰
- 💾 **个人资料一键共享** — 保存一次，所有模块自动填入并测算
- ⚖ **称骨算命** — 袁天罡称骨法，节气定月，含经典批语

## 🛠 技术栈

纯 HTML / CSS / JavaScript，单文件实现，无框架依赖。

## 📂 本地使用

```bash
cd suandezhun
python3 -m http.server 8910
open http://localhost:8910
```

---

# 📚 笔趣阁小说网站

> 本地小说阅读站：支持多书源搜索、自动切换书源、章节缓存与本地阅读。

🔗 GitHub 源码：[zhangwei6321-spec/biquge-novel-site](https://github.com/zhangwei6321-spec/biquge-novel-site)
🔗 在线访问：[https://biquge-novel-site.onrender.com](https://biquge-novel-site.onrender.com)
📂 项目目录：[biquge-novel-site/](biquge-novel-site/)

## ✨ 功能

- 🔍 **多书源搜索** — 笔趣阁321 / 笔趣阁网 / 速读谷 + GitHub 免费书源
- 🔄 **自动切换书源** — 遇到 HTTP 520、连接失败或坏章节时自动换源继续阅读
- 💾 **缓存全部章节** — 后台缓存整本书，阅读时自动预缓存接下来 5 章
- 🚫 **纯免费策略** — 过滤会员、付费、VIP、正版站点，只保留免费书源

## 🛠 技术栈

Node.js + cheerio + 原生 HTML / CSS / JavaScript

## 📂 本地使用

```bash
cd biquge-novel-site
npm install
npm start
```

浏览器打开 http://127.0.0.1:4321

在线完整使用需要 Node 后端，推荐用 Render 免费 Web Service 部署，详细步骤见 [`biquge-novel-site/README.md`](biquge-novel-site/README.md)。仓库已配置 GitHub Actions 每 10 分钟保活一次，尽量让免费实例不进入休眠。
