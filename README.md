# 视频原始 CDN 链接解析工具

从抖音、即梦分享链接中提取可播放的视频 CDN 地址。前端可以直接粘贴完整分享文案，后端会自动提取其中的 URL、跟踪短链跳转、请求平台分享页或分享 API，并返回可复制、打开或代理下载的视频地址。

> 仅用于解析和下载你自己创作或有权使用的内容。CDN 地址由平台接口返回，通常有时效性，本项目不存储视频文件。

当前版本：`0.6.0`

## v0.6 更新

- 多 CDN 链路测速：对多个无水印候选地址做小片段测速，返回并优先展示最快链接。
- 即梦候选评分：按无水印特征、清晰度、码率、域名和水印参数综合排序。
- 推荐链接：API 返回 `recommendedUrl`，网页端显示“推荐最快链接”卡片。
- 解析历史：网页端使用 `localStorage` 保存最近 12 条；iOS 端使用 `UserDefaults` 保存最近解析。
- 移动端网页体验优化：结果卡片、按钮尺寸、最近解析和推荐下载更适合手机操作。
- API 保护：支持可选 Token 鉴权、解析限流、下载限流和最大输入长度限制。
- 错误诊断：失败响应返回 `diagnostics.code/details`，前端展示诊断码。

## 功能

- 支持粘贴完整分享文字，自动提取第一个 `http/https` 链接。
- 支持抖音分享链接解析。
- 支持即梦分享链接解析。
- 支持即梦无水印候选评分和最优链接排序。
- 支持多 CDN 链路测速，并默认推荐最快的无水印链接。
- 返回视频标题、作者、封面、尺寸、时长等元信息。
- 按类型展示视频地址，例如无水印播放流、带水印参考地址。
- 支持复制 CDN 链接。
- 支持后端代理下载和 Range 请求透传，避免部分 CDN 因跨域或 Referer 限制导致浏览器直接下载失败。
- 网页端支持本地解析历史记录。
- iOS App 支持本地解析历史记录、多任务下载和保存到相册。
- 支持可选 API 鉴权和内存限流。

## 技术栈

- Node.js
- Express
- Axios
- 原生 HTML/CSS/JavaScript 前端
- Vercel 部署配置

## 环境变量

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `API_TOKEN` | 空 | 设置后，解析和下载接口需要 `Authorization: Bearer <token>` 或 `?token=<token>`。 |
| `VIDEO_PARSER_API_TOKEN` | 空 | `API_TOKEN` 的备用名称。 |
| `RATE_LIMIT_WINDOW_MS` | `60000` | 限流窗口，单位毫秒。 |
| `RATE_LIMIT_MAX` | `30` | 每个 IP 每个窗口内的解析请求上限。 |
| `DOWNLOAD_RATE_LIMIT_MAX` | `60` | 每个 IP 每个窗口内的下载请求上限。 |
| `MAX_INPUT_LENGTH` | `3000` | 解析接口最大输入长度。 |

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
  "diagnostics": {
    "code": "OK",
    "stages": ["parse", "rank", "speed-test"]
  },
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
  },
  "recommendedUrl": "https://v26-default.ixigua.com/...",
  "cdnTests": [
    {
      "url": "https://v26-default.ixigua.com/...",
      "ok": true,
      "host": "v26-default.ixigua.com",
      "ttfbMs": 120,
      "bytes": 262144,
      "elapsedMs": 420,
      "speedBps": 624152
    }
  ],
  "urlDetails": [
    {
      "url": "https://v26-default.ixigua.com/...",
      "host": "v26-default.ixigua.com",
      "source": "get_item_info.transcoded.origin",
      "quality": "origin",
      "bitrate": 6272,
      "hasWatermark": false,
      "isCleanHint": true,
      "score": 1700
    }
  ]
}
```

失败响应示例：

```json
{
  "success": false,
  "error": "未找到即梦无水印原始视频地址",
  "diagnostics": {
    "code": "NO_CLEAN_URL",
    "details": {
      "candidateCount": 2
    }
  }
}
```

常见诊断码：

- `UNAUTHORIZED`：开启了 Token 鉴权，但请求未携带有效 Token。
- `RATE_LIMITED`：请求过于频繁。
- `INPUT_TOO_LONG`：输入内容超过最大长度。
- `DOUYIN_PARSE_FAILED`：抖音解析阶段失败。
- `JIMENG_PARSE_FAILED`：即梦解析阶段失败。
- `NO_CLEAN_URL`：没有找到可判断为无水印的地址。
- `CDN_SPEED_TEST_FAILED`：CDN 测速阶段失败。

### 代理下载

```http
GET /api/download?url=<encoded_video_url>&title=<filename>&disposition=attachment
```

后端会校验视频 URL 域名白名单，并带上合适的 `User-Agent` 和 `Referer` 请求 CDN，然后把视频流转发给浏览器。

参数：

- `url`：必填，已编码的视频 CDN 地址。
- `title`：可选，下载文件名。
- `disposition`：可选，`attachment` 或 `inline`。iOS 网页端使用 `inline` 打开视频预览，方便用户通过系统分享保存到照片。
- `token`：可选，开启 `API_TOKEN` 后可用 query token 鉴权。

下载代理会透传 `Range`、`Content-Range`、`Accept-Ranges`，提升 iOS Safari 视频预览和断点请求兼容性。

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

这些字段可以作为水印版本参考，但不要把它们当成最终无水印地址，也不要靠字符串替换猜 URL。

### 5. 请求作品详情接口获取当前作品原始流

当前分享作品的高码率无水印流，应优先通过 mweb 作品详情接口获取：

```text
POST https://jimeng.jianying.com/mweb/v1/get_item_info?uid=0&aid=581595&app_name=dreamina&duanwai_huiliu_page=1
```

请求 body：

```json
{
  "published_item_id": "7646971490071645464",
  "pack_item_opt": {
    "need_follow_info": true
  }
}
```

这里的 `published_item_id` 就是分享落地页 query 里的 `id`。

响应里的优先字段是：

```text
data.video.transcoded_video.origin.video_url
```

这个字段通常是最高码率版本，例如新样例《老太乘碟赴三体》返回的对象路径是：

```text
tos-cn-v-148450/oYoAEl4o9SGrDgf6hgC4JATDLExQIhgKQ18hOs/
```

它和其它网站提取到的 `v26-default.ixigua.com/.../oYoAEl4o9SGrDgf6hgC4JATDLExQIhgKQ18hOs/...` 是同一个视频对象。CDN 域名可能被实时调度到 `v*-artist.vlabvod.com`、`v26-default.ixigua.com` 等，但路径对象、码率和无水印参数才是关键。

当前项目按下面顺序返回无水印候选：

```js
const candidates = [
  transcoded.origin?.video_url,
  transcoded['1080p']?.video_url,
  transcoded['720p']?.video_url,
  transcoded['480p']?.video_url,
  transcoded['360p']?.video_url,
  video.origin_video?.video_url,
];
```

### 6. 落地页候选作为兜底

有些分享页还会在落地页 API 的列表字段里返回无水印播放流：

```text
data.page_info.collection_info.collection_list[*].creation_info.metadata.video_url
data.page_info.creation_list[*].metadata.video_url
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

域名和签名段会随时间、CDN 调度和请求环境变化，但判断标准不是固定域名，而是 API 字段路径和水印参数。

### 7. 匹配当前分享作品

`collection_list` 或 `creation_list` 里可能包含多条作品，所以项目会优先找：

```js
metadata.video_id === videoId
```

也就是合集条目的 `video_id` 等于分享落地页 query 中的 `id`。匹配成功后取它的 `metadata.video_url`。

如果有多个干净候选，会去重后返回；如果没有匹配项，则回退到其它无 `lr=display_watermark` 的 `metadata.video_url`。

核心逻辑：

```js
const cleanCandidates = collectionList
  .map(item => item?.creation_info?.metadata)
  .concat((pageInfo?.creation_list || []).map(item => item?.metadata))
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

### 8. 保留带水印地址作参考

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
- 多 CDN 测速由服务端发起，因此测速结果反映的是服务端所在地区到 CDN 的速度。如果部署在 Vercel，测速可能偏海外；面向国内用户建议部署到国内或香港节点。
- 即梦的无水印地址不要靠字符串替换猜测，应优先从 `/mweb/v1/get_item_info` 的 `data.video.transcoded_video.origin.video_url` 获取。
- `collection_info.collection_list[*].creation_info.metadata.video_url` 和 `creation_list[*].metadata.video_url` 只作为落地页兜底候选。
- 即梦 CDN 域名可能变化，下载代理白名单需要按实际返回域名维护。
- 部分 CDN 需要正确的 `Referer` 和桌面端 `User-Agent`，否则可能返回空白、403 或无法下载。
- 如果平台接口结构变化，优先打印并检查完整响应中的 `video.transcoded_video`、`metadata`、`download_info`、`collection_info`、`creation_list`。
- 公开部署建议设置 `API_TOKEN`，并根据访问量调整 `RATE_LIMIT_MAX` 和 `DOWNLOAD_RATE_LIMIT_MAX`。

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

## 手动抓取和验证方法

实际排查即梦无水印链接时，主要使用的是本地命令行工具和 Node.js 临时脚本，不需要浏览器插件。

### 用到的工具

- `curl`：请求网页、接口、检查 CDN 是否可访问。
- `node`：写临时脚本，跟踪跳转、请求 API、遍历 JSON 字段。
- `rg`：搜索项目代码和下载下来的网页 JS。
- `sed`：查看文件片段。
- `lsof`：检查或关闭本地端口服务。

### 手动复现流程

1. 先从分享文案里提取短链。

   例如：

   ```text
   https://jimeng.jianying.com/s/6ROkuEln2KQ/?t=210
   ```

2. 跟踪短链跳转，拿到最终落地页 URL。

   最终 URL 里会包含关键参数：

   ```text
   id=7646971490071645464
   ```

   这个 `id` 就是作品 ID。

3. 请求即梦分享页 API。

   ```text
   POST https://jimeng.jianying.com/luckycat/cn/jianying/campaign/v1/dreamina/share/landing_page?uid=0&aid=581595&app_name=dreamina&duanwai_huiliu_page=1
   ```

   这个接口会返回水印版地址、作者、封面、推荐作品、合集信息等。部分分享页也会在 `collection_info` 或 `creation_list` 中返回无水印候选，但不要只依赖它。

4. 请求即梦 mweb 作品详情接口。

   ```bash
   curl -sS 'https://jimeng.jianying.com/mweb/v1/get_item_info?uid=0&aid=581595&app_name=dreamina&duanwai_huiliu_page=1' \
     -H 'Content-Type: application/json' \
     -H 'User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36' \
     -H 'Referer: https://jimeng.jianying.com/' \
     -H 'appid: 581595' \
     -H 'sign-ver: 1' \
     --data '{"published_item_id":"7646971490071645464","pack_item_opt":{"need_follow_info":true}}'
   ```

5. 从响应里读取高码率无水印字段。

   优先读取：

   ```text
   data.video.transcoded_video.origin.video_url
   ```

   其次可以读取：

   ```text
   data.video.transcoded_video.1080p.video_url
   data.video.transcoded_video.720p.video_url
   data.video.transcoded_video.480p.video_url
   data.video.transcoded_video.360p.video_url
   data.video.origin_video.video_url
   ```

### 判断是否为无水印

带水印 URL 通常会有：

```text
lr=display_watermark...
cd=0%7C0%7C1%7C3
```

无水印详情接口返回的高码率源通常没有 `lr=display_watermark`。例如《老太乘碟赴三体》样例中，无水印原始流的对象路径是：

```text
tos-cn-v-148450/oYoAEl4o9SGrDgf6hgC4JATDLExQIhgKQ18hOs/
```

并且码率参数是：

```text
br=6272
ds=12
```

其它网站拿到的链接可能是 `v26-default.ixigua.com`，本地请求可能返回 `v9-artist.vlabvod.com` 或 `v3-artist.vlabvod.com`。CDN 域名会动态调度，不应把域名当作唯一判断标准；更可靠的是看对象路径、码率和是否存在水印参数。

### 检查视频 URL 是否可访问

拿到视频 URL 后，用 `curl -I` 检查：

```bash
curl -I -L \
  -H 'Referer: https://jimeng.jianying.com/' \
  -H 'User-Agent: Mozilla/5.0' \
  '<视频URL>'
```

正常情况下会返回：

```text
HTTP/2 200
content-type: video/mp4
```

这说明链接是可播放的视频文件。

## iOS App

项目内包含一个独立的 SwiftUI iOS 客户端：

```text
ios/VideoParser/VideoParser.xcodeproj
```

### 功能

- 白色底色、卡片式结果区、圆角控件，整体接近 Apple 原生视觉。
- 支持粘贴完整分享文案或分享链接。
- 调用现有后端 `POST /api/parse`。
- 展示视频封面、平台、作者、尺寸、时长和分组后的 CDN 链接。
- 支持复制、Safari 打开、系统分享链接。
- 支持最近解析历史记录，便于重新解析和下载。
- 支持多任务下载、逐条取消、进度显示和保存到系统相册。
- 包含解析步骤进度动画、按钮反馈、结果卡片弹性转场、复制成功状态动画。
- App 内可配置解析服务地址，默认是：

  ```text
  http://127.0.0.1:3399
  ```

### 本地运行

先启动 Node 后端：

```bash
cd /Users/zhulin/Desktop/VibeCoding/video-parser
npm start
```

然后打开 iOS 工程：

```bash
open ios/VideoParser/VideoParser.xcodeproj
```

在 Xcode 中选择 `VideoParser` scheme 和一个 iPhone Simulator，点击 Run。

### 连接线上服务

点击 App 右上角设置按钮，把解析服务地址改成你的线上域名，例如：

```text
https://your-domain.com
```

App 会请求：

```text
https://your-domain.com/api/parse
```

如果服务部署在 Vercel，解析请求仍然由 Vercel 服务器发起，CDN 调度可能偏海外。想拿到更适合国内下载的 CDN，建议后端部署到国内、香港或用户本机。

### 编译验证

已用下面命令验证模拟器 Debug 构建：

```bash
xcodebuild -project ios/VideoParser/VideoParser.xcodeproj \
  -scheme VideoParser \
  -configuration Debug \
  -sdk iphonesimulator \
  -destination 'generic/platform=iOS Simulator' \
  build
```

## 网页端体验

网页端使用原生 HTML/CSS/JavaScript，无需前端构建步骤。

### 桌面端

- 粘贴分享文案后直接解析。
- 展示推荐最快链接、测速结果和全部候选地址。
- 点击“下载”会走 `/api/download` 代理流式下载。
- 点击 URL 文本或“复制”按钮可复制 CDN 地址。

### 移动端

- 输入卡片在顶部吸附，解析后结果区按钮更大，适合单手操作。
- 最近解析会保存在浏览器 `localStorage` 中，最多保留 12 条。
- iPhone/iPad 浏览器不能让网页直接写入系统“照片”App；网页端会用 `inline` 方式打开视频预览，并提示用户通过系统分享按钮选择“存储视频/保存视频”。

### localStorage 数据

历史记录 key：

```text
video-parser-history-v1
```

保存内容包括标题、平台、封面、解析时间、推荐链接和完整解析结果。清空历史只会删除浏览器本地记录，不影响服务端。
