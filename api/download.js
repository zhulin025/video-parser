const https = require('https');
const http = require('http');

const MOBILE_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1';
const PC_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const RATE_LIMIT_WINDOW_MS = Number(process.env.RATE_LIMIT_WINDOW_MS || 60_000);
const DOWNLOAD_RATE_LIMIT_MAX = Number(process.env.DOWNLOAD_RATE_LIMIT_MAX || 60);
const rateLimitStore = globalThis.__videoParserDownloadRateLimitStore || new Map();
globalThis.__videoParserDownloadRateLimitStore = rateLimitStore;

function getClientIp(req) {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.trim()) {
    return forwarded.split(',')[0].trim();
  }
  return req.socket?.remoteAddress || req.connection?.remoteAddress || 'unknown';
}

function checkAuth(req) {
  const token = process.env.API_TOKEN || process.env.VIDEO_PARSER_API_TOKEN;
  if (!token) return true;
  const header = req.headers.authorization || '';
  const bearer = header.startsWith('Bearer ') ? header.slice(7) : '';
  return bearer === token || req.query.token === token;
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
  return bucket.count <= DOWNLOAD_RATE_LIMIT_MAX;
}

function getRefererForUrl(url) {
  if (url.includes('finder.video.qq.com') || url.includes('channels.weixin.qq.com') || url.includes('weixin.qq.com')) {
    return 'https://channels.weixin.qq.com/';
  }
  if (url.includes('jimeng.com') || url.includes('dreamnia') || url.includes('dreamina') || url.includes('ixigua.com') || url.includes('vlabvod.com')) {
    return 'https://jimeng.jianying.com/';
  }
  return 'https://www.douyin.com/';
}

// 跟随重定向，返回最终请求（用于流式传输）
function streamFromUrl(url, destRes, redirectCount = 0, rangeHeader = '') {
  if (redirectCount > 8) {
    destRes.status(500).end('重定向过多');
    return;
  }
  const isHttps = url.startsWith('https');
  const lib = isHttps ? https : http;
  const headers = {
    'User-Agent': url.includes('jimeng') || url.includes('dreamnia') || url.includes('dreamina') || url.includes('ixigua.com') || url.includes('vlabvod.com') || url.includes('finder.video.qq.com') ? PC_UA : MOBILE_UA,
    'Referer': getRefererForUrl(url),
  };
  if (rangeHeader) {
    headers.Range = rangeHeader;
  }

  const req = lib.get(url, {
    headers,
    timeout: 30000,
  }, (res) => {
    if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
      let next = res.headers.location;
      if (next.startsWith('/')) {
        const u = new URL(url);
        next = u.origin + next;
      }
      res.resume();
      streamFromUrl(next, destRes, redirectCount + 1, rangeHeader);
      return;
    }

    destRes.statusCode = res.statusCode || 200;
    // 透传 Content-Length 供浏览器显示进度
    if (res.headers['content-length']) {
      destRes.setHeader('Content-Length', res.headers['content-length']);
    }
    if (res.headers['content-range']) {
      destRes.setHeader('Content-Range', res.headers['content-range']);
    }
    if (res.headers['accept-ranges']) {
      destRes.setHeader('Accept-Ranges', res.headers['accept-ranges']);
    }
    destRes.setHeader('Content-Type', 'video/mp4');
    res.pipe(destRes);
  });

  req.on('error', (err) => {
    if (!destRes.headersSent) {
      destRes.status(502).end('下载失败: ' + err.message);
    }
  });
  req.on('timeout', () => {
    req.destroy();
    if (!destRes.headersSent) {
      destRes.status(504).end('请求超时');
    }
  });
}

module.exports = function handler(req, res) {
  if (!checkAuth(req)) {
    return res.status(401).end('API 鉴权失败');
  }
  if (!checkRateLimit(req)) {
    return res.status(429).end('请求过于频繁，请稍后再试');
  }

  const videoUrl = req.query.url;
  const disposition = req.query.disposition === 'inline' ? 'inline' : 'attachment';
  const title = (req.query.title || 'douyin_video')
    .replace(/[\\/:*?"<>|#]/g, '')
    .trim()
    .substring(0, 60);

  const ALLOWED_DOMAINS = [
    'aweme.snssdk.com',
    'dreamnia.jimeng.com',
    'dreamina-de.jianying.com',
    'ixigua.com',
    'vlabvod.com',
    'finder.video.qq.com',
  ];
  const isAllowed = videoUrl && ALLOWED_DOMAINS.some(d => videoUrl.includes(d));
  if (!isAllowed) {
    return res.status(400).end('无效的视频地址');
  }

  res.setHeader('Content-Disposition', `${disposition}; filename*=UTF-8''${encodeURIComponent(title)}.mp4`);
  res.setHeader('Access-Control-Allow-Origin', '*');

  streamFromUrl(videoUrl, res, 0, req.headers.range || '');
};
