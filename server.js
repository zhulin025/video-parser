const express = require('express');
const axios = require('axios');
const https = require('https');
const http = require('http');
const app = express();

app.use(express.json());
app.use(express.static('public'));

// 模拟移动端浏览器请求头
const MOBILE_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1';
const PC_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

// 手动跟踪重定向，返回最终 URL
function followRedirects(url, maxRedirects = 8) {
  return new Promise((resolve, reject) => {
    let count = 0;
    function request(currentUrl) {
      if (count++ > maxRedirects) return reject(new Error('重定向次数过多'));
      const isHttps = currentUrl.startsWith('https');
      const lib = isHttps ? https : http;
      const options = {
        headers: {
          'User-Agent': MOBILE_UA,
          'Accept': 'text/html,application/xhtml+xml,*/*',
        },
        timeout: 8000,
      };
      const req = lib.get(currentUrl, options, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          let next = res.headers.location;
          // 处理相对路径重定向
          if (next.startsWith('/')) {
            const u = new URL(currentUrl);
            next = u.origin + next;
          }
          res.resume();
          request(next);
        } else {
          res.resume();
          resolve(currentUrl);
        }
      });
      req.on('error', reject);
      req.on('timeout', () => { req.destroy(); reject(new Error('请求超时')); });
    }
    request(url);
  });
}

// 从 URL 中提取抖音 aweme_id
function extractDouyinId(url) {
  // 格式: /video/1234567890
  const m1 = url.match(/\/video\/(\d+)/);
  if (m1) return m1[1];
  // 格式: aweme_id=xxx in query
  try {
    const u = new URL(url);
    const id = u.searchParams.get('aweme_id');
    if (id) return id;
  } catch (_) {}
  return null;
}

// 从文本中提取第一个 http/https URL
function extractUrl(text) {
  const m = text.match(/https?:\/\/[^\s"'<>]+/);
  return m ? m[0] : null;
}

// ──────────────────────────────────────────────
// 抖音解析：从分享页 HTML 提取内嵌数据
// ──────────────────────────────────────────────
async function parseDouyin(rawUrl) {
  // 1. 跟踪短链，得到含 aweme_id 的中间 URL（iesdouyin.com/share/video/xxx）
  const finalUrl = await followRedirects(rawUrl);
  const awemeId = extractDouyinId(finalUrl);
  if (!awemeId) {
    throw new Error(`无法从 URL 提取视频ID: ${finalUrl}`);
  }

  // 2. 请求 iesdouyin 分享页 HTML，页面内嵌 window._ROUTER_DATA 含完整视频信息
  const sharePageUrl = `https://www.iesdouyin.com/share/video/${awemeId}/`;
  const resp = await axios.get(sharePageUrl, {
    headers: {
      'User-Agent': MOBILE_UA,
      'Referer': 'https://www.douyin.com/',
      'Accept': 'text/html,*/*',
    },
    timeout: 12000,
  });

  const html = resp.data;
  const match = html.match(/window\._ROUTER_DATA\s*=\s*(.+?)\s*<\/script>/s);
  if (!match) {
    throw new Error('页面结构异常，未找到视频数据（_ROUTER_DATA）');
  }

  let routerData;
  try {
    routerData = JSON.parse(match[1]);
  } catch (e) {
    throw new Error('视频数据解析失败：' + e.message);
  }

  // 3. 取出 item_list
  // loaderData 中有 video_layout(null) 和 video_(id)/page 两个 key，需要找有数据的那个
  const loaderData = routerData?.loaderData;
  const pageKey = Object.keys(loaderData || {}).find(k => {
    const v = loaderData[k];
    return v && typeof v === 'object' && v.videoInfoRes;
  });
  const itemList = loaderData?.[pageKey]?.videoInfoRes?.item_list;
  if (!itemList || itemList.length === 0) {
    throw new Error('未获取到视频信息，视频可能已删除或为私密');
  }

  const item = itemList[0];
  const video = item.video || {};

  // 4. play_addr 里的 URL 含 "playwm"（带水印），替换为 "play" 即无水印版本
  const rawPlayUrls = video.play_addr?.url_list || [];
  const playUrls = rawPlayUrls.map(u => u.replace('/playwm/', '/play/'));

  // 带水印的原始地址（供对比参考）
  const wmUrls = rawPlayUrls;

  const coverUrls = video.cover?.url_list || [];
  const dynamicCoverUrls = video.dynamic_cover?.url_list || [];

  return {
    platform: 'douyin',
    awemeId,
    title: item.desc || '(无标题)',
    author: item.author?.nickname || '',
    cover: coverUrls[0] || '',
    dynamicCover: dynamicCoverUrls[0] || '',
    duration: video.duration || 0,
    width: video.width || 0,
    height: video.height || 0,
    videoUrls: {
      '无水印播放流（play）': playUrls,
      '带水印原始地址（playwm，供参考）': wmUrls,
    },
  };
}

// ──────────────────────────────────────────────
// 即梦解析（Jimeng / jianying.com）
// ──────────────────────────────────────────────
async function parseJimeng(rawUrl) {
  // 1. 跟踪短链，得到含完整参数的最终 URL
  const finalUrl = await followRedirects(rawUrl);

  // 2. 提取所有 query 参数
  let params = {};
  let videoId = null;
  try {
    const u = new URL(finalUrl);
    u.searchParams.forEach((value, key) => { params[key] = value; });
    videoId = params.id;
  } catch (_) {}

  if (!videoId) {
    throw new Error(`无法从即梦链接提取视频ID，请确认链接格式正确: ${finalUrl}`);
  }

  // 3. 调用即梦分享落地页 API（从浏览器抓包得到）
  const apiUrl = 'https://jimeng.jianying.com/luckycat/cn/jianying/campaign/v1/dreamina/share/landing_page?uid=0&aid=581595&app_name=dreamina&duanwai_huiliu_page=1';
  const resp = await axios.post(apiUrl, {
    query_params: params,
    item_id: videoId,
  }, {
    headers: {
      'Content-Type': 'application/json',
      'User-Agent': PC_UA,
      'Referer': finalUrl,
      'Accept': 'application/json, text/plain, */*',
      'appid': '581595',
      'sign-ver': '1',
    },
    timeout: 20000,
  });

  const data = resp.data;
  if (data.err_no !== 0) {
    throw new Error(`即梦 API 返回错误: ${data.err_tips || data.err_no}`);
  }

  const creation = data.data?.page_info?.creation;
  const metadata = creation?.metadata;
  if (!metadata) {
    throw new Error('即梦 API 返回结构异常，请检查链接是否有效');
  }

  const downloadInfo = metadata.download_info || {};
  const coverUrl = metadata.cover_url || '';
  const creator = creation?.creator_info?.creator;

  const videoUrls = {};

  // 尝试通过参数变换获取干净版本（CDN 按参数选文件，不校验签名）
  if (downloadInfo.url) {
    const cleanUrl = downloadInfo.url
      .replace(/[?&]lr=[^&]+/g, '')          // 去掉 lr 参数
      .replace(/cd=0%7C0%7C1%7C3/g, 'cd=0%7C0%7C0%7C3');  // cd 水印位改为 0
    videoUrls['尝试去水印版（实验性）'] = [cleanUrl];
  }

  // watermark_ending_url：视频主体+片尾均带水印
  if (downloadInfo.watermark_ending_url) {
    videoUrls['片尾水印版'] = [downloadInfo.watermark_ending_url];
  }
  // download_info.url：整段视频带 Logo 水印（无片尾）
  if (downloadInfo.url) {
    videoUrls['Logo水印版'] = [downloadInfo.url];
  }

  return {
    platform: 'jimeng',
    videoId,
    title: `即梦视频 ${videoId}`,
    author: creator?.user_name || '',
    cover: coverUrl,
    duration: 0,
    videoUrls,
  };
}

// ──────────────────────────────────────────────
// API 入口
// ──────────────────────────────────────────────
app.post('/api/parse', async (req, res) => {
  try {
    const { url: rawInput } = req.body;
    if (!rawInput || !rawInput.trim()) {
      return res.json({ success: false, error: '请输入链接' });
    }

    const url = extractUrl(rawInput.trim());
    if (!url) {
      return res.json({ success: false, error: '未识别到有效链接，请粘贴完整的分享链接或文字' });
    }

    let result;
    if (url.includes('douyin.com') || url.includes('iesdouyin.com') || url.includes('v.douyin.com')) {
      result = await parseDouyin(url);
    } else if (url.includes('jimeng.jianying.com') || url.includes('jianying.com')) {
      result = await parseJimeng(url);
    } else {
      return res.json({ success: false, error: '暂不支持该平台，目前支持：抖音、即梦' });
    }

    res.json({ success: true, ...result });
  } catch (err) {
    res.json({ success: false, error: err.message });
  }
});

// 下载代理：流式转发视频（避免跨域问题）
const downloadHandler = require('./api/download');
app.get('/api/download', (req, res) => downloadHandler(req, res));

const PORT = 3399;
app.listen(PORT, () => {
  console.log(`\n视频解析工具已启动: http://localhost:${PORT}\n`);
});
