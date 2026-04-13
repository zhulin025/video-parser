const https = require('https');
const http = require('http');

const MOBILE_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1';
const PC_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

function getRefererForUrl(url) {
  if (url.includes('jimeng.com') || url.includes('dreamnia')) {
    return 'https://jimeng.jianying.com/';
  }
  return 'https://www.douyin.com/';
}

// 跟随重定向，返回最终请求（用于流式传输）
function streamFromUrl(url, destRes, redirectCount = 0) {
  if (redirectCount > 8) {
    destRes.status(500).end('重定向过多');
    return;
  }
  const isHttps = url.startsWith('https');
  const lib = isHttps ? https : http;
  const req = lib.get(url, {
    headers: {
      'User-Agent': url.includes('jimeng') || url.includes('dreamnia') ? PC_UA : MOBILE_UA,
      'Referer': getRefererForUrl(url),
    },
    timeout: 30000,
  }, (res) => {
    if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
      let next = res.headers.location;
      if (next.startsWith('/')) {
        const u = new URL(url);
        next = u.origin + next;
      }
      res.resume();
      streamFromUrl(next, destRes, redirectCount + 1);
      return;
    }

    // 透传 Content-Length 供浏览器显示进度
    if (res.headers['content-length']) {
      destRes.setHeader('Content-Length', res.headers['content-length']);
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
  const videoUrl = req.query.url;
  const title = (req.query.title || 'douyin_video')
    .replace(/[\\/:*?"<>|#]/g, '')
    .trim()
    .substring(0, 60);

  const ALLOWED_DOMAINS = ['aweme.snssdk.com', 'v3-dreamnia.jimeng.com', 'v3-dreamina-de.jianying.com'];
  const isAllowed = videoUrl && ALLOWED_DOMAINS.some(d => videoUrl.includes(d));
  if (!isAllowed) {
    return res.status(400).end('无效的视频地址');
  }

  res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(title)}.mp4`);
  res.setHeader('Access-Control-Allow-Origin', '*');

  streamFromUrl(videoUrl, res);
};
