const axios = require('axios');
const https = require('https');
const http = require('http');

const MOBILE_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1';
const PC_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

function followRedirects(url, maxRedirects = 8) {
  return new Promise((resolve, reject) => {
    let count = 0;
    function request(currentUrl) {
      if (count++ > maxRedirects) return reject(new Error('重定向次数过多'));
      const isHttps = currentUrl.startsWith('https');
      const lib = isHttps ? https : http;
      const req = lib.get(currentUrl, {
        headers: { 'User-Agent': MOBILE_UA, 'Accept': 'text/html,*/*' },
        timeout: 8000,
      }, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          let next = res.headers.location;
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

function extractDouyinId(url) {
  const m = url.match(/\/video\/(\d+)/);
  if (m) return m[1];
  try {
    return new URL(url).searchParams.get('aweme_id');
  } catch (_) {}
  return null;
}

function extractUrl(text) {
  const m = text.match(/https?:\/\/[^\s"'<>]+/);
  return m ? m[0] : null;
}

async function parseDouyin(rawUrl) {
  const finalUrl = await followRedirects(rawUrl);
  const awemeId = extractDouyinId(finalUrl);
  if (!awemeId) throw new Error(`无法从 URL 提取视频ID: ${finalUrl}`);

  const sharePageUrl = `https://www.iesdouyin.com/share/video/${awemeId}/`;
  const resp = await axios.get(sharePageUrl, {
    headers: { 'User-Agent': MOBILE_UA, 'Referer': 'https://www.douyin.com/', 'Accept': 'text/html,*/*' },
    timeout: 12000,
  });

  const html = resp.data;
  const match = html.match(/window\._ROUTER_DATA\s*=\s*(.+?)\s*<\/script>/s);
  if (!match) throw new Error('页面结构异常，未找到视频数据');

  const routerData = JSON.parse(match[1]);
  const loaderData = routerData?.loaderData;
  const pageKey = Object.keys(loaderData || {}).find(k => {
    const v = loaderData[k];
    return v && typeof v === 'object' && v.videoInfoRes;
  });
  const itemList = loaderData?.[pageKey]?.videoInfoRes?.item_list;
  if (!itemList || itemList.length === 0) throw new Error('未获取到视频信息，视频可能已删除或为私密');

  const item = itemList[0];
  const video = item.video || {};
  const rawPlayUrls = video.play_addr?.url_list || [];
  const playUrls = rawPlayUrls.map(u => u.replace('/playwm/', '/play/'));
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
      '带水印原始地址（playwm，供参考）': rawPlayUrls,
    },
  };
}

async function parseJimeng(rawUrl) {
  const finalUrl = await followRedirects(rawUrl);

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

  const pageInfo = data.data?.page_info;
  const creation = pageInfo?.creation;
  const metadata = creation?.metadata;
  if (!metadata) {
    throw new Error('即梦 API 返回结构异常，请检查链接是否有效');
  }

  const downloadInfo = metadata.download_info || {};
  const collectionList = pageInfo?.collection_info?.collection_list || [];
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

  const videoUrls = {};
  if (cleanCandidates.length > 0) {
    videoUrls['无水印原始播放流'] = [...new Set(cleanCandidates)];
  } else if (metadata.video_url && !metadata.video_url.includes('lr=display_watermark')) {
    videoUrls['无水印原始播放流'] = [metadata.video_url];
  }
  if (downloadInfo.watermark_ending_url) {
    videoUrls['片尾水印版'] = [downloadInfo.watermark_ending_url];
  }
  if (downloadInfo.url) {
    videoUrls['Logo水印版'] = [downloadInfo.url];
  }

  return {
    platform: 'jimeng',
    videoId,
    title: `即梦视频 ${videoId}`,
    author: creation?.creator_info?.creator?.user_name || '',
    cover: metadata.cover_url || '',
    duration: 0,
    videoUrls,
  };
}

// Vercel serverless function 入口
module.exports = async function handler(req, res) {
  // 允许跨域（以防从其他域访问）
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ success: false, error: 'Method not allowed' });

  try {
    const rawInput = req.body?.url?.trim();
    if (!rawInput) return res.json({ success: false, error: '请输入链接' });

    const url = extractUrl(rawInput);
    if (!url) return res.json({ success: false, error: '未识别到有效链接' });

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
};
