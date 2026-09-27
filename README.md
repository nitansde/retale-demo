# ReTale Showcase · 戏说功能预览

这是 ReTale 的静态展示站，使用纯 HTML / CSS / JavaScript 构建，所有内容都是可公开展示的 dummy 数据，不连接 ReTale 后端，也不会读取任何本地书库或 API key。

## 本地预览

```bash
python3 -m http.server 3000 --directory .
```

然后打开 <http://localhost:3000>。

## GitHub Pages

仓库包含 `.github/workflows/deploy-pages.yml`。推送到 `main` 后，GitHub Actions 会把仓库根目录发布到 GitHub Pages。首次使用时，请在仓库设置的 **Pages → Build and deployment** 中选择 **GitHub Actions**。
