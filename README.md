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
7. 显示返回的 `summary`、`correctedText`、`locationMatchStatus` 和 `items`。
8. 如果确认保存，请求 `GET /api/confirm-text?draftId=上一步返回的draftId`。这个方式最适合 iPhone 快捷指令，因为不需要再拼复杂请求体。

服务端会长期保存原始语音文本和 AI 修正后的文本。比如语音识别成“客厅臭屉”，AI 判断应该是“客厅抽屉”时，会把修正结果写入 `correctedText`。

如果 AI 返回多个位置候选，可以让快捷指令显示候选列表，再把选中的位置 ID 传给保存接口：

```text
GET http://你的NAS地址:3000/api/confirm-text?draftId=...&selectedLocationId=loc_xxx
```

如果 AI 没找到合适的已有位置，但建议了一个新位置，并且你确认创建：

```text
GET http://你的NAS地址:3000/api/confirm-text?draftId=...&createSuggestedLocation=true
```

老的保存方式仍然可用：

```text
POST /api/confirm
{"draftId":"上一步返回的 draftId"}
```

## 后台：常用位置

打开 `/admin.html` 后，可以先在“常用位置”里创建房间、柜子、抽屉、收纳箱等位置。

建议按层级创建：

```text
客厅
客厅 / 电视柜
客厅 / 电视柜 / 左侧抽屉
书房
书房 / 白色收纳盒
```

每个位置可以填写别名，例如 `左抽,客厅抽屉`。之后语音录入时，AI 会优先从这些已有位置里匹配，减少把同类物品放散的概率。

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
- `GET /api/confirm-text`
- `POST /api/search`
- `POST /api/recommend-location`
- `GET /api/locations`
- `POST /api/locations`
- `GET /api/items`
- `GET /api/export.csv`
