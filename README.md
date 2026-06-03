# 视频原始 CDN 链接解析工具

从抖音、即梦分享链接中提取可播放的视频 CDN 地址。前端可以直接粘贴完整分享文案，后端会自动提取其中的 URL、跟踪短链跳转、请求平台分享页或分享 API，并返回可复制、打开或代理下载的视频地址。

> 仅用于解析和下载你自己创作或有权使用的内容。CDN 地址由平台接口返回，通常有时效性，本项目不存储视频文件。

## 功能

- 支持粘贴完整分享文字，自动提取第一个 `http/https` 链接。
- 支持抖音分享链接解析。
- 支持即梦分享链接解析。
- 返回视频标题、作者、封面、尺寸、时长等元信息。
- 按类型展示视频地址，例如无水印播放流、带水印参考地址。
- 支持复制 CDN 链接。
- 支持后端代理下载，避免部分 CDN 因跨域或 Referer 限制导致浏览器直接下载失败。

## 技术栈

- Node.js
- Express
- Axios
- 原生 HTML/CSS/JavaScript 前端
- Vercel 部署配置

## 本地运行

```bash
npm install
npm start
```

启动后访问：

```text
http://localhost:3399
```

开发时也可以使用：

```bash
npm run dev
```

## API

### 解析视频

```http
POST /api/parse
Content-Type: application/json
```

请求体：

```json
{
  "url": "快来看 茉茉 创作的故事《水牛踢飞转场》！ https://jimeng.jianying.com/s/oTl5w36W0UM/?t=210 CA2486，来【即梦】录入分身，一起出镜吧！"
}
```

响应示例：

```json
{
  "success": true,
  "platform": "jimeng",
  "videoId": "7645872201647885592",
  "title": "即梦视频 7645872201647885592",
  "author": "茉茉",
  "cover": "https://...",
  "duration": 0,
  "videoUrls": {
    "无水印原始播放流": [
      "https://v3-dreamina-de.jianying.com/..."
    ],
    "片尾水印版": [
      "https://v3-dreamnia.jimeng.com/..."
    ],
    "Logo水印版": [
      "https://v3-dreamnia.jimeng.com/..."
    ]
  }
}
```

### 代理下载

```http
GET /api/download?url=<encoded_video_url>&title=<filename>
```

后端会校验视频 URL 域名白名单，并带上合适的 `User-Agent` 和 `Referer` 请求 CDN，然后把视频流转发给浏览器。

## 抖音解析原理

抖音的解析流程在 `parseDouyin` 中：

1. 从用户输入中提取分享 URL。
2. 跟踪短链重定向，拿到包含视频 ID 的最终 URL。
3. 从最终 URL 中提取 `aweme_id`，常见格式是 `/video/<aweme_id>` 或 query 中的 `aweme_id`。
4. 请求：

   ```text
   https://www.iesdouyin.com/share/video/<aweme_id>/
   ```

5. 从 HTML 中提取 `window._ROUTER_DATA`。
6. 在 `loaderData` 中找到带 `videoInfoRes` 的页面数据。
7. 读取 `item_list[0].video.play_addr.url_list`。
8. 抖音返回的 `play_addr` 通常是带水印的 `playwm` 地址，项目会把路径中的 `/playwm/` 替换成 `/play/`，得到无水印播放流。

核心判断：

```js
const rawPlayUrls = video.play_addr?.url_list || [];
const playUrls = rawPlayUrls.map(u => u.replace('/playwm/', '/play/'));
```

## 即梦无水印解析原理

即梦的关键点是：同一个分享接口里会返回多层视频地址，但不是每个字段都是无水印原始流。

以这个分享文案为例：

```text
快来看 茉茉 创作的故事《水牛踢飞转场》！ https://jimeng.jianying.com/s/oTl5w36W0UM/?t=210 CA2486，来【即梦】录入分身，一起出镜吧！
```

### 1. 提取分享短链

先从完整文案中提取 URL：

```text
https://jimeng.jianying.com/s/oTl5w36W0UM/?t=210
```

### 2. 跟踪短链跳转

请求短链后，即梦会 302 跳转到落地页，例如：

```text
https://jimeng.jianying.com/activities/reflux/mproject?...&id=7645872201647885592&itemType=210&...
```

这里最重要的是 query 参数：

- `id`：作品 ID，也就是后续 API 的 `item_id`
- `itemType`
- `share_token`
- `author_id`
- `collection_id`
- 其它分享上下文参数

代码会把最终落地页 URL 的全部 query 参数收集到 `params`，并把 `params.id` 作为 `videoId`。

### 3. 请求即梦分享落地页 API

即梦分享页会使用这个接口返回页面数据：

```text
https://jimeng.jianying.com/luckycat/cn/jianying/campaign/v1/dreamina/share/landing_page?uid=0&aid=581595&app_name=dreamina&duanwai_huiliu_page=1
```

请求方式是 `POST`，body：

```json
{
  "query_params": {
    "...": "最终落地页 URL 中的所有 query 参数"
  },
  "item_id": "7645872201647885592"
}
```

请求头里需要模拟浏览器环境，项目使用：

```text
Content-Type: application/json
User-Agent: PC Chrome UA
Referer: 最终落地页 URL
Accept: application/json, text/plain, */*
appid: 581595
sign-ver: 1
```

### 4. 区分带水印字段和无水印字段

API 返回后，容易误用的字段是：

```text
data.page_info.creation.metadata.download_info.url
data.page_info.creation.metadata.download_info.watermark_ending_url
data.page_info.creation.metadata.video_url
```

这些字段在这个样例中通常带有水印参数，例如：

```text
lr=display_watermark_dm_creation
cd=0%7C0%7C1%7C3
```

其中 `lr=display_watermark...` 表示展示水印版本，`cd=0|0|1|3` 中间的 `1` 也对应水印版本。旧实现尝试删除 `lr` 或把 `cd=0|0|1|3` 改成 `cd=0|0|0|3`，但这是猜 URL，不稳定。

真正应该优先读取的是合集列表里的原始播放流：

```text
data.page_info.collection_info.collection_list[*].creation_info.metadata.video_url
```

这些 URL 的特征是：

```text
没有 lr=display_watermark...
cd=0%7C0%7C0%7C3
```

域名可能是：

```text
v3-dreamina-de.jianying.com
v26-dreamina-de.jianying.com
v26-default.ixigua.com
```

你看到其它网站提取出的 `v26-default.ixigua.com/...` 就属于这一类。域名和签名段会随时间、CDN 调度和请求环境变化，但判断标准不是固定域名，而是 API 字段路径和水印参数。

### 5. 匹配当前分享作品

`collection_list` 里可能包含多条作品，所以项目会优先找：

```js
metadata.video_id === videoId
```

也就是合集条目的 `video_id` 等于分享落地页 query 中的 `id`。匹配成功后取它的 `metadata.video_url`。

如果有多个干净候选，会去重后返回；如果没有匹配项，则回退到其它无 `lr=display_watermark` 的 `metadata.video_url`。

核心逻辑：

```js
const cleanCandidates = collectionList
  .map(item => item?.creation_info?.metadata)
  .filter(item => item?.video_url)
  .sort((a, b) => {
    if (a.video_id === videoId) return -1;
    if (b.video_id === videoId) return 1;
    return 0;
  })
  .map(item => item.video_url)
  .filter(url => !url.includes('lr=display_watermark') && url.includes('cd=0%7C0%7C0%7C3'));
```

最终返回：

```js
videoUrls['无水印原始播放流'] = [...new Set(cleanCandidates)];
```

### 6. 保留带水印地址作参考

项目仍然会返回：

- `片尾水印版`：`download_info.watermark_ending_url`
- `Logo水印版`：`download_info.url`

这样前端可以对比不同版本，也便于后续排查平台字段变化。

## 项目结构

```text
.
├── api
│   ├── download.js      # 下载代理处理器
│   └── parse.js         # 独立 serverless 解析入口备用实现
├── public
│   └── index.html       # 前端页面
├── server.js            # Express 主入口，当前本地和 Vercel 配置都使用它
├── package.json
└── vercel.json
```

当前 `vercel.json` 把所有请求转发给 `server.js`：

```json
{
  "version": 2,
  "builds": [
    {
      "src": "server.js",
      "use": "@vercel/node"
    }
  ],
  "routes": [
    {
      "src": "/(.*)",
      "dest": "server.js"
    }
  ]
}
```

因此线上部署时实际入口是 `server.js`。`api/parse.js` 保留为独立 serverless 函数版本，方便以后改成 Vercel `/api` 原生函数结构。

## 主要实现说明

### `server.js`

负责：

- 启动 Express 服务。
- 托管 `public/index.html`。
- 提供 `POST /api/parse`。
- 根据 URL 判断平台：
  - 抖音：`douyin.com`、`iesdouyin.com`、`v.douyin.com`
  - 即梦：`jimeng.jianying.com`、`jianying.com`
- 调用 `parseDouyin` 或 `parseJimeng`。
- 挂载 `GET /api/download` 下载代理。

### `api/download.js`

负责代理下载视频：

1. 校验目标 URL 是否在允许域名内。
2. 根据 CDN 类型设置 `User-Agent` 和 `Referer`。
3. 跟踪 CDN 重定向。
4. 设置 `Content-Disposition`，让浏览器下载为 `.mp4`。
5. 流式转发视频内容，不把文件完整读入内存。

允许的域名包括：

```text
aweme.snssdk.com
dreamnia.jimeng.com
dreamina-de.jianying.com
ixigua.com
```

### `public/index.html`

负责：

- 输入分享链接或完整分享文案。
- 调用 `/api/parse`。
- 展示解析结果。
- 复制链接。
- 通过 `/api/download` 触发代理下载。

## 部署到 Vercel

### 方式一：使用 Vercel CLI

安装 Vercel CLI：

```bash
npm install -g vercel
```

登录：

```bash
vercel login
```

预览部署：

```bash
vercel
```

生产部署：

```bash
vercel --prod
```

### 方式二：GitHub 连接 Vercel

1. 把项目推送到 GitHub。
2. 在 Vercel 新建项目，选择该仓库。
3. Framework Preset 选择 `Other` 或保持默认。
4. Build Command 可以留空。
5. Output Directory 可以留空。
6. 部署即可。

Vercel 会根据 `vercel.json` 使用 `server.js` 作为 Node 函数入口。

## 部署注意事项

- CDN 视频地址有时效性，解析后应尽快下载。
- 即梦的无水印地址不要靠字符串替换猜测，应从 `collection_info.collection_list[*].creation_info.metadata.video_url` 获取。
- 即梦 CDN 域名可能变化，下载代理白名单需要按实际返回域名维护。
- 部分 CDN 需要正确的 `Referer` 和桌面端 `User-Agent`，否则可能返回空白、403 或无法下载。
- 如果平台接口结构变化，优先打印并检查完整响应中的 `metadata`、`download_info`、`collection_info`。

## 调试命令

检查语法：

```bash
node --check server.js
node --check api/parse.js
node --check api/download.js
```

本地测试解析：

```bash
curl -sS -X POST http://localhost:3399/api/parse \
  -H 'Content-Type: application/json' \
  --data '{"url":"https://jimeng.jianying.com/s/oTl5w36W0UM/?t=210"}'
```

检查返回的无水印 CDN 是否可访问：

```bash
curl -I -L \
  -H 'Referer: https://jimeng.jianying.com/' \
  -H 'User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36' \
  '<无水印 CDN URL>'
```

正常情况下应返回：

```text
HTTP/2 200
content-type: video/mp4
```
