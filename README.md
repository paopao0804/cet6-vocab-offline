# 六级单词记录离线版

离线版不需要账号或服务器，学习进度保存在当前设备的 IndexedDB 中。

## 运行

离线版需要通过 HTTP 或 HTTPS 打开，才能注册 Service Worker。可以部署到
GitHub Pages、静态网站托管服务，或者在项目根目录运行：

```powershell
node scripts/serve-offline.mjs
```

然后打开：

```text
http://localhost:8799
```

## 数据

- 单词和例句已内置，不需要网络。
- 每个设备独立保存学习进度。
- 设置页面支持导出和导入 JSON 备份。
- 手机浏览器可以“添加到主屏幕”后像 App 一样使用。
