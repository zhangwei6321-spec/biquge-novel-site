# 笔趣阁小说网站

> 多免费书源小说阅读站（Node + Express）。**源码在 [`biquge-novel-site/`](./biquge-novel-site) 子目录**，部署在 Render。

🔗 **在线访问：<https://biquge-novel-site.onrender.com>**

## 仓库边界

这里只放小说站。原先混在本仓库的另外两个项目已拆成独立仓库：

| 项目 | 仓库 | 在线地址 |
|------|------|----------|
| 协理员面试练习 | [interview-practice](https://github.com/zhangwei6321-spec/interview-practice) | <https://zhangwei6321-spec.github.io/interview-practice/> |
| 算得准 · 在线算命 | [suandezhun](https://github.com/zhangwei6321-spec/suandezhun) | <https://zhangwei6321-spec.github.io/suandezhun/> |

## 目录

```
biquge-novel-site/    Node 应用：server.js / public/ / render.yaml
.github/workflows/    keep-alive：每 10 分钟 ping 一次 Render，防免费实例休眠
```

## 本地运行

```bash
cd biquge-novel-site
npm install
npm start
```

打开 <http://127.0.0.1:4321>。功能与书源说明见 [`biquge-novel-site/README.md`](./biquge-novel-site/README.md)。

## 部署

Render 上的 Web Service，根目录设为 `biquge-novel-site`（仓库内有 `render.yaml`）。GitHub Pages 已关闭——这是带后端的 Node 应用，静态托管跑不起来。
