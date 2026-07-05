# 飞牛 NAS 便捷更新

推荐两种方式，按省事程度排序。

## 方式一：NAS 直接拉取代码

适合长期使用。以后每次更新只需要在飞牛终端进入项目目录执行：

```bash
git pull
sh scripts/update-on-nas.sh
```

第一次部署时：

```bash
cd /vol1/1000/docker
git clone 你的仓库地址 storage-assistant
cd storage-assistant
cp .env.example .env
vi .env
sh scripts/update-on-nas.sh
```

注意：`.env` 和 `data/` 不提交到仓库，更新代码不会覆盖你的配置和数据库。

## 方式二：本地打包，飞牛上传

适合暂时不想配置 Git 的情况。

在电脑本地项目目录执行：

```bash
sh scripts/make-release.sh
```

它会生成：

```text
release/storage-assistant-日期.tar.gz
```

把这个压缩包上传到飞牛项目目录，例如：

```text
/vol1/1000/docker/storage-assistant
```

然后在飞牛终端执行：

```bash
cd /vol1/1000/docker/storage-assistant
tar -xzf storage-assistant-*.tar.gz
sh scripts/update-on-nas.sh
```

这个压缩包不会包含 `.env`、`fnos.env`、`data/`、`node_modules`，所以不会覆盖你的密钥和数据库。

## 数据备份

更新前如果想稳一点，可以复制整个 `data` 文件夹：

```bash
cp -a data "data-backup-$(date +%Y%m%d-%H%M%S)"
```
