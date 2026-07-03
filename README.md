# NAS AI Storage Assistant

本项目是一个运行在 NAS Docker 里的家庭收纳记忆系统。日常入口是 iPhone 快捷指令：你用语音描述物品和位置，服务端调用 DeepSeek/OpenAI 兼容 API 分析，确认后长期保存到 NAS 本地 SQLite 数据库。

## 本地运行

```bash
pnpm install
cp .env.example .env
pnpm test
pnpm start
```

打开：

```text
http://localhost:3000/admin.html
```

## Docker 部署

```bash
cp .env.example .env
docker compose up -d --build
```

数据保存在：

```text
./data/storage.db
./data/photos
./data/exports
```

备份时复制整个 `data` 目录。

## iPhone 快捷指令：收纳记录

1. 添加“听写文本”动作。
2. 添加“获取 URL 内容”动作。
3. URL 设置为 `http://你的NAS地址:3000/api/analyze`。
4. 方法选择 `POST`。
5. 请求正文选择 JSON：`{"text":"听写文本变量"}`。
6. 请求头添加 `X-Storage-Token`，值为 `.env` 里的 `SHORTCUT_TOKEN`。
7. 显示返回的 `summary` 和 `items`。
8. 如果确认保存，再请求 `POST /api/confirm`，正文为 `{"draftId":"上一步返回的 draftId"}`。

## iPhone 快捷指令：查找物品

1. 添加“听写文本”动作。
2. 请求 `POST http://你的NAS地址:3000/api/search`。
3. 请求正文 JSON：`{"query":"听写文本变量"}`。
4. 请求头添加 `X-Storage-Token`。
5. 显示返回的 `answer`。

## 常用接口

- `GET /api/health`
- `GET /api/version`
- `POST /api/analyze`
- `POST /api/confirm`
- `POST /api/search`
- `POST /api/recommend-location`
- `GET /api/items`
- `GET /api/export.csv`
