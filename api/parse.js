const axios = require('axios');
const https = require('https');
const http = require('http');
const { execFile } = require('child_process');

const MOBILE_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1';
const PC_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const RATE_LIMIT_WINDOW_MS = Number(process.env.RATE_LIMIT_WINDOW_MS || 60_000);
const RATE_LIMIT_MAX = Number(process.env.RATE_LIMIT_MAX || 30);
const MAX_INPUT_LENGTH = Number(process.env.MAX_INPUT_LENGTH || 3000);
const FILE_SIZE_TIMEOUT_MS = 6000;
const YTDLP_BIN = process.env.YTDLP_BIN || 'yt-dlp';
const YTDLP_ARGS_PREFIX = (process.env.YTDLP_ARGS_PREFIX || '').split(/\s+/).filter(Boolean);
const YTDLP_TIMEOUT_MS = Number(process.env.YTDLP_TIMEOUT_MS || 45_000);
const YTDLP_MAX_FORMATS = Number(process.env.YTDLP_MAX_FORMATS || 8);
const rateLimitStore = globalThis.__videoParserRateLimitStore || new Map();
globalThis.__videoParserRateLimitStore = rateLimitStore;

class ApiError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.code = code;
    this.details = details;
  }
}

function getClientIp(req) {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.trim()) {
    return forwarded.split(',')[0].trim();
  }
  return req.socket?.remoteAddress || req.connection?.remoteAddress || 'unknown';
}

function checkAuth(req) {
  const token = process.env.API_TOKEN || process.env.VIDEO_PARSER_API_TOKEN;
  if (!token) return;
  const header = req.headers.authorization || '';
  const bearer = header.startsWith('Bearer ') ? header.slice(7) : '';
  const queryToken = req.query?.token;
  if (bearer !== token && queryToken !== token) {
    throw new ApiError('UNAUTHORIZED', 'API 鉴权失败，请检查访问令牌');
  }
}

function checkRateLimit(req) {
  const ip = getClientIp(req);
  const now = Date.now();
  const bucket = rateLimitStore.get(ip) || { count: 0, resetAt: now + RATE_LIMIT_WINDOW_MS };
  if (now > bucket.resetAt) {
    bucket.count = 0;
    bucket.resetAt = now + RATE_LIMIT_WINDOW_MS;
  }
  bucket.count += 1;
  rateLimitStore.set(ip, bucket);
  if (bucket.count > RATE_LIMIT_MAX) {
    throw new ApiError('RATE_LIMITED', `请求过于频繁，请 ${Math.ceil((bucket.resetAt - now) / 1000)} 秒后再试`, {
      limit: RATE_LIMIT_MAX,
      windowMs: RATE_LIMIT_WINDOW_MS,
      resetAt: bucket.resetAt,
    });
  }
}

function withStage(stage, fn) {
  return Promise.resolve()
    .then(fn)
    .catch(err => {
      if (err instanceof ApiError) throw err;
      throw new ApiError(stage, err.message, { cause: err.code || err.name || 'ERROR' });
    });
}

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

function getRefererForUrl(url) {
  if (url.includes('jimeng.com') || url.includes('dreamnia') || url.includes('dreamina') || url.includes('ixigua.com') || url.includes('vlabvod.com')) {
    return 'https://jimeng.jianying.com/';
  }
  return 'https://www.douyin.com/';
}

function getUserAgentForUrl(url) {
  return url.includes('jimeng') || url.includes('dreamnia') || url.includes('dreamina') || url.includes('ixigua.com') || url.includes('vlabvod.com')
    ? PC_UA
    : MOBILE_UA;
}

function dedupe(values) {
  return [...new Set(values.filter(Boolean))];
}

function inferUrlMeta(url, source = '', quality = '') {
  let host = '';
  let br = 0;
  let bt = 0;
  try {
    const u = new URL(url);
    host = u.host;
    br = Number(u.searchParams.get('br') || 0);
    bt = Number(u.searchParams.get('bt') || 0);
  } catch (_) {}
  return {
    url,
    host,
    source,
    quality,
    bitrate: Math.max(br, bt),
    hasWatermark: /playwm|watermark|display_watermark|lr=/.test(url),
    isCleanHint: url.includes('cd=0%7C0%7C0%7C3') || (!url.includes('playwm') && !url.includes('display_watermark')),
  };
}

function scoreVideoCandidate(candidate) {
  const url = candidate.url || '';
  const host = candidate.host || '';
  let score = 0;
  if (!candidate.hasWatermark) score += 1000;
  if (candidate.isCleanHint) score += 220;
  if (url.includes('cd=0%7C0%7C0%7C3')) score += 180;
  if (host.includes('ixigua.com')) score += 80;
  if (host.includes('vlabvod.com')) score += 60;
  if (host.includes('dreamnia.jimeng.com')) score -= 120;
  if (url.includes('display_watermark')) score -= 700;
  if (url.includes('watermark')) score -= 350;
  if (candidate.quality === 'origin') score += 160;
  if (candidate.quality === '1080p') score += 120;
  if (candidate.quality === '720p') score += 70;
  if (candidate.quality === '480p') score += 30;
  score += Math.min(candidate.bitrate || 0, 9000) / 20;
  return Math.round(score);
}

function sortCandidates(candidates) {
  const byUrl = new Map();
  for (const candidate of candidates) {
    if (!candidate?.url) continue;
    const enriched = {
      ...inferUrlMeta(candidate.url, candidate.source, candidate.quality),
      ...candidate,
    };
    enriched.score = scoreVideoCandidate(enriched);
    const current = byUrl.get(enriched.url);
    if (!current || enriched.score > current.score) {
      byUrl.set(enriched.url, enriched);
    }
  }
  return [...byUrl.values()].sort((a, b) => b.score - a.score);
}

function parseTotalSize(headers) {
  const contentRange = headers['content-range'];
  if (contentRange) {
    const match = String(contentRange).match(/\/(\d+)$/);
    if (match) return Number(match[1]);
  }
  const contentLength = headers['content-length'];
  return contentLength ? Number(contentLength) : 0;
}

function formatFileSize(bytes) {
  if (!bytes) return '';
  if (bytes >= 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} B`;
}

function getUrlFileInfo(url) {
  return new Promise(resolve => {
    let settled = false;

    function done(extra = {}) {
      if (settled) return;
      settled = true;
      const sizeBytes = Number(extra.sizeBytes || 0);
      resolve({
        url,
        ok: !extra.error && sizeBytes > 0,
        host: (() => { try { return new URL(url).host; } catch (_) { return ''; } })(),
        sizeBytes,
        sizeText: formatFileSize(sizeBytes),
        ...extra,
      });
    }

    function request(currentUrl, redirectCount = 0) {
      let parsed;
      try {
        parsed = new URL(currentUrl);
      } catch (err) {
        done({ error: 'URL 无效' });
        return;
      }

      const lib = parsed.protocol === 'https:' ? https : http;
      const req = lib.get(currentUrl, {
        headers: {
          'User-Agent': getUserAgentForUrl(currentUrl),
          'Referer': getRefererForUrl(currentUrl),
          'Range': 'bytes=0-0',
        },
        timeout: FILE_SIZE_TIMEOUT_MS,
      }, res => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          res.resume();
          if (redirectCount >= 5) {
            done({ error: '文件大小探测重定向次数过多' });
            return;
          }
          const nextUrl = new URL(res.headers.location, currentUrl).toString();
          request(nextUrl, redirectCount + 1);
          return;
        }
        const sizeBytes = parseTotalSize(res.headers);
        res.resume();
        done({ sizeBytes, finalUrl: currentUrl });
      });
      req.on('timeout', () => {
        req.destroy();
        done({ error: '文件大小探测超时' });
      });
      req.on('error', err => {
        if (settled && err.code === 'ECONNRESET') return;
        done({ error: err.message });
      });
    }

    request(url);
  });
}

async function enrichWithFileSizes(result) {
  const candidateUrls = dedupe(Object.values(result.videoUrls || {}).flatMap(urls => urls || [])).slice(0, 12);
  if (candidateUrls.length === 0) return result;

  const fileInfos = await Promise.all(candidateUrls.map(getUrlFileInfo));

  return {
    ...result,
    fileInfos,
  };
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
  if (playUrls.length === 0) {
    throw new ApiError('NO_CLEAN_URL', '未找到抖音无水印播放地址');
  }
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
  const itemInfo = await fetchJimengItemInfo(videoId, finalUrl);
  const candidateDetails = [
    ...collectJimengItemInfoVideoCandidates(itemInfo),
    ...collectJimengLandingCandidates(pageInfo, videoId),
    { url: metadata.video_url, source: 'landing_current', quality: 'landing' },
    { url: downloadInfo.watermark_ending_url, source: 'watermark_ending', quality: 'watermark' },
    { url: downloadInfo.url, source: 'download_info', quality: 'watermark' },
  ];
  const scoredCandidates = sortCandidates(candidateDetails);
  const cleanUrls = scoredCandidates
    .filter(item => !item.hasWatermark && item.isCleanHint)
    .map(item => item.url);

  const videoUrls = {};
  if (cleanUrls.length > 0) {
    videoUrls['无水印原始播放流'] = cleanUrls;
  }

  if (!videoUrls['无水印原始播放流'] && metadata.video_url && !metadata.video_url.includes('lr=display_watermark')) {
    videoUrls['无水印原始播放流'] = [metadata.video_url];
  }
  if (downloadInfo.watermark_ending_url) {
    videoUrls['片尾水印版'] = [downloadInfo.watermark_ending_url];
  }
  if (downloadInfo.url) {
    videoUrls['Logo水印版'] = [downloadInfo.url];
  }

  if (!videoUrls['无水印原始播放流'] || videoUrls['无水印原始播放流'].length === 0) {
    throw new ApiError('NO_CLEAN_URL', '未找到即梦无水印原始视频地址', {
      candidateCount: scoredCandidates.length,
      topCandidates: scoredCandidates.slice(0, 3).map(item => ({
        host: item.host,
        score: item.score,
        source: item.source,
        quality: item.quality,
        hasWatermark: item.hasWatermark,
      })),
    });
  }

  return {
    platform: 'jimeng',
    videoId,
    title: `即梦视频 ${videoId}`,
    author: creation?.creator_info?.creator?.user_name || '',
    cover: metadata.cover_url || '',
    duration: 0,
    videoUrls,
    urlDetails: scoredCandidates,
  };
}

async function fetchJimengItemInfo(videoId, referer) {
  const url = 'https://jimeng.jianying.com/mweb/v1/get_item_info?uid=0&aid=581595&app_name=dreamina&duanwai_huiliu_page=1';
  try {
    const resp = await axios.post(url, {
      published_item_id: videoId,
      pack_item_opt: {
        need_follow_info: true,
      },
    }, {
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': PC_UA,
        'Referer': referer,
        'Accept': 'application/json, text/plain, */*',
        'appid': '581595',
        'sign-ver': '1',
      },
      timeout: 20000,
    });
    if (resp.data?.ret !== '0' && resp.data?.ret !== 0) {
      return null;
    }
    return resp.data?.data || null;
  } catch (_) {
    return null;
  }
}

function collectJimengItemInfoVideoCandidates(itemInfo) {
  const video = itemInfo?.video || {};
  const transcoded = video.transcoded_video || {};
  return [
    { url: transcoded.origin?.video_url, quality: 'origin', source: 'get_item_info.transcoded.origin' },
    { url: transcoded['1080p']?.video_url, quality: '1080p', source: 'get_item_info.transcoded.1080p' },
    { url: transcoded['720p']?.video_url, quality: '720p', source: 'get_item_info.transcoded.720p' },
    { url: transcoded['480p']?.video_url, quality: '480p', source: 'get_item_info.transcoded.480p' },
    { url: transcoded['360p']?.video_url, quality: '360p', source: 'get_item_info.transcoded.360p' },
    { url: video.origin_video?.video_url, quality: 'origin', source: 'get_item_info.origin_video' },
  ].filter(item => item.url);
}

function collectJimengLandingCandidates(pageInfo, videoId) {
  const collectionList = pageInfo?.collection_info?.collection_list || [];
  const currentMetadata = pageInfo?.creation?.metadata;
  const metadataItems = [
    currentMetadata,
    ...collectionList.map(item => item?.creation_info?.metadata),
    ...(pageInfo?.creation_list || []).map(item => item?.metadata),
  ];
  return metadataItems
    .filter(item => item?.video_url && isJimengCurrentVideoMetadata(item, videoId))
    .map(item => ({ url: item.video_url, quality: 'landing', source: 'landing.current' }));
}

function isJimengCurrentVideoMetadata(metadata, videoId) {
  if (!metadata || !videoId) return false;
  const knownIds = [
    metadata.video_id,
    metadata.id,
    metadata.item_id,
    metadata.creation_id,
    metadata.published_item_id,
  ].filter(Boolean).map(String);
  return knownIds.includes(String(videoId));
}

async function parseWithYtDlp(rawUrl) {
  const info = await runYtDlpJson(rawUrl);
  const candidates = collectYtDlpCandidates(info);
  if (candidates.length === 0) {
    throw new ApiError('YTDLP_NO_URL', 'yt-dlp 未返回可直接访问的视频地址', {
      extractor: info.extractor_key || info.extractor || '',
      title: info.title || '',
    });
  }

  return {
    platform: 'ytdlp',
    videoId: info.id || rawUrl,
    title: info.title || `通用视频 ${info.id || ''}`.trim(),
    author: info.uploader || info.channel || info.creator || '',
    cover: info.thumbnail || '',
    duration: info.duration ? Number(info.duration) * 1000 : 0,
    width: Number(info.width || 0),
    height: Number(info.height || 0),
    videoUrls: {
      '通用下载直链（yt-dlp）': candidates.map(item => item.url),
    },
    urlDetails: candidates.map(item => ({
      url: item.url,
      host: item.host,
      source: item.source,
      quality: item.quality,
      bitrate: item.bitrate,
      hasWatermark: false,
      isCleanHint: true,
      score: item.score,
      ext: item.ext,
      protocol: item.protocol,
    })),
    extractor: info.extractor_key || info.extractor || '',
  };
}

function runYtDlpJson(url) {
  return new Promise((resolve, reject) => {
    execFile(YTDLP_BIN, [
      ...YTDLP_ARGS_PREFIX,
      '--ignore-config',
      '--dump-single-json',
      '--no-playlist',
      '--no-warnings',
      '--skip-download',
      url,
    ], {
      timeout: YTDLP_TIMEOUT_MS,
      maxBuffer: 12 * 1024 * 1024,
    }, (error, stdout, stderr) => {
      if (error) {
        const reason = stderr?.trim() || error.message;
        reject(new ApiError('YTDLP_FAILED', `yt-dlp 解析失败: ${reason}`, {
          bin: YTDLP_BIN,
          argsPrefix: YTDLP_ARGS_PREFIX,
          timeoutMs: YTDLP_TIMEOUT_MS,
        }));
        return;
      }
      try {
        resolve(JSON.parse(stdout));
      } catch (err) {
        reject(new ApiError('YTDLP_JSON_FAILED', 'yt-dlp 输出 JSON 解析失败', {
          cause: err.message,
        }));
      }
    });
  });
}

function collectYtDlpCandidates(info) {
  const seen = new Set();
  const candidates = [];

  function push(format, source) {
    const url = format?.url;
    if (!url || seen.has(url) || !/^https?:\/\//.test(url)) return;
    seen.add(url);
    let host = '';
    try { host = new URL(url).host; } catch (_) {}
    const height = Number(format.height || 0);
    const bitrate = Number(format.tbr || format.vbr || format.abr || 0);
    const ext = format.ext || info.ext || '';
    const protocol = format.protocol || '';
    candidates.push({
      url,
      host,
      source,
      quality: height ? `${height}p` : format.format_note || format.format_id || '',
      bitrate,
      ext,
      protocol,
      score: scoreYtDlpFormat({ height, bitrate, ext, protocol, hasVideo: format.vcodec !== 'none', hasAudio: format.acodec !== 'none' }),
    });
  }

  push(info, 'yt-dlp.primary');
  for (const format of info.requested_downloads || []) push(format, 'yt-dlp.requested_downloads');
  for (const format of info.requested_formats || []) push(format, 'yt-dlp.requested_formats');
  for (const format of info.formats || []) push(format, 'yt-dlp.formats');

  return candidates
    .filter(item => !/mhtml|storyboard|images/i.test(item.ext))
    .sort((a, b) => b.score - a.score)
    .slice(0, YTDLP_MAX_FORMATS);
}

function scoreYtDlpFormat(format) {
  let score = 0;
  if (format.hasVideo) score += 800;
  if (format.hasAudio) score += 250;
  if (format.ext === 'mp4') score += 180;
  if (format.protocol === 'https') score += 80;
  if (String(format.protocol).includes('m3u8')) score -= 120;
  score += Math.min(format.height || 0, 2160) / 2;
  score += Math.min(format.bitrate || 0, 12000) / 20;
  return Math.round(score);
}

// Vercel serverless function 入口
module.exports = async function handler(req, res) {
  // 允许跨域（以防从其他域访问）
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ success: false, error: 'Method not allowed' });

  try {
    checkAuth(req);
    checkRateLimit(req);

    const rawInput = req.body?.url?.trim();
    if (!rawInput) return res.json({ success: false, error: '请输入链接' });
    if (rawInput.length > MAX_INPUT_LENGTH) {
      throw new ApiError('INPUT_TOO_LONG', `输入内容过长，请控制在 ${MAX_INPUT_LENGTH} 字以内`);
    }

    const url = extractUrl(rawInput);
    if (!url) return res.json({ success: false, error: '未识别到有效链接' });

    let result;
    if (url.includes('douyin.com') || url.includes('iesdouyin.com') || url.includes('v.douyin.com')) {
      result = await withStage('DOUYIN_PARSE_FAILED', () => parseDouyin(url));
    } else if (url.includes('jimeng.jianying.com') || url.includes('jianying.com')) {
      result = await withStage('JIMENG_PARSE_FAILED', () => parseJimeng(url));
    } else if (process.env.YTDLP_ENABLED === '1') {
      result = await withStage('YTDLP_PARSE_FAILED', () => parseWithYtDlp(url));
    } else {
      return res.json({ success: false, error: '暂不支持该平台，目前支持：抖音、即梦；通用 yt-dlp 解析需设置 YTDLP_ENABLED=1 后启用' });
    }

    result = await withStage('FILE_SIZE_LOOKUP_FAILED', () => enrichWithFileSizes(result));

    res.json({ success: true, diagnostics: { code: 'OK', stages: ['parse', 'rank', 'file-size'] }, ...result });
  } catch (err) {
    const status = err.code === 'UNAUTHORIZED' ? 401 : err.code === 'RATE_LIMITED' ? 429 : 200;
    res.status(status).json({
      success: false,
      error: err.message,
      diagnostics: {
        code: err.code || 'UNKNOWN_ERROR',
        details: err.details || {},
      },
    });
  }
};
