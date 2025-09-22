// Blaze-Cors: Node.js CORS Proxy with URL Rewriting - Single File Version
// Usage: node fetch.js
// Then: GET /q?url=https://example.com

const express = require('express');
let fetch = require('node-fetch');
if (fetch.default) fetch = fetch.default;
const cheerio = require('cheerio');
const url = require('url');

const app = express();
const PORT = process.env.PORT || 3000;
const PROXY_ENDPOINT = '/q';

// Allow CORS for all origins + remove CSP
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS,PATCH');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With, X-YouTube-Client-Name, X-YouTube-Client-Version');
  res.header('Access-Control-Allow-Credentials', 'true');
  
  // Remove security headers that break proxied content
  res.removeHeader('X-Frame-Options');
  res.removeHeader('Content-Security-Policy');
  res.removeHeader('Content-Security-Policy-Report-Only');
  
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  next();
});

// Enhanced API proxy for POST/PUT requests (YouTube, Spotify APIs)
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Handle POST requests to the main proxy
app.post(PROXY_ENDPOINT, async (req, res) => {
  const targetUrl = req.query.url;
  if (!targetUrl) {
    return res.status(400).send('Missing url parameter');
  }
  
  console.log(`POST proxy request: ${targetUrl}`);
  
  try {
    const response = await fetch(targetUrl, {
      method: 'POST',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Content-Type': req.headers['content-type'] || 'application/json',
        'Accept': req.headers.accept || 'application/json, text/plain, */*',
        'Accept-Language': 'en-US,en;q=0.9',
        'Referer': new url.URL(targetUrl).origin,
        // Forward YouTube-specific headers
        ...Object.fromEntries(
          Object.entries(req.headers).filter(([key]) => 
            key.toLowerCase().startsWith('x-youtube') || 
            key.toLowerCase().startsWith('x-goog') ||
            key === 'authorization'
          )
        )
      },
      body: req.body ? JSON.stringify(req.body) : undefined
    });
    
    const contentType = response.headers.get('content-type') || '';
    
    // Copy response headers
    const headers = {};
    for (const [header, value] of response.headers.entries()) {
      if (!['connection', 'keep-alive', 'transfer-encoding'].includes(header.toLowerCase())) {
        headers[header] = value;
      }
    }
    
    // Remove CSP and frame options
    delete headers['content-security-policy'];
    delete headers['content-security-policy-report-only'];
    delete headers['x-frame-options'];
    delete headers['content-encoding'];
    headers['Access-Control-Allow-Origin'] = '*';
    
    const responseText = await response.text();
    res.set(headers);
    res.status(response.status).send(responseText);
    
  } catch (err) {
    console.error('POST proxy error:', err);
    res.status(500).json({ error: 'Proxy error', message: err.message });
  }
});
app.use((req, res, next) => {
  console.log(`\n=== REQUEST ===`);
  console.log(`${req.method} ${req.url}`);
  
  // Special logging for SVG files
  if (req.url.includes('check3.db67d31e.svg') || req.url.includes('.svg')) {
    console.log(`🎯 SVG REQUEST DETECTED: ${req.url}`);
  }
  
  next();
});

// Special SVG proxy endpoint
app.get('/svg-proxy', async (req, res) => {
  const targetUrl = req.query.url;
  if (!targetUrl) return res.status(400).send('Missing url parameter');
  
  console.log(`SVG Proxy: ${targetUrl}`);
  
  try {
    const response = await fetch(targetUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'image/svg+xml,image/*,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        'Cache-Control': 'no-cache'
      }
    });
    
    if (!response.ok) {
      console.log(`SVG fetch failed: ${response.status} ${response.statusText}`);
      return res.status(response.status).send('Failed to fetch SVG');
    }
    
    const svgContent = await response.text();
    console.log(`SVG content length: ${svgContent.length}`);
    
    // Force correct headers for SVG
    res.set('Content-Type', 'image/svg+xml');
    res.set('Access-Control-Allow-Origin', '*');
    res.set('Cache-Control', 'public, max-age=3600');
    
    res.send(svgContent);
  } catch (err) {
    console.error('SVG proxy error:', err);
    res.status(500).send('Error fetching SVG: ' + err.message);
  }
});

// Proxy endpoint for CSS files
app.get('/css-proxy', async (req, res) => {
  const targetUrl = req.query.url;
  if (!targetUrl) return res.status(400).send('Missing url parameter');
  
  console.log(`CSS Proxy: ${targetUrl}`);
  
  try {
    const response = await fetch(targetUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/css,*/*;q=0.1',
        'Accept-Language': 'en-US,en;q=0.9',
        'Cache-Control': 'no-cache',
        'Pragma': 'no-cache'
      }
    });
    
    if (!response.ok) {
      console.log(`CSS fetch failed: ${response.status} ${response.statusText}`);
      return res.status(response.status).send('Failed to fetch CSS');
    }
    
    let css = await response.text();
    const baseUrl = new url.URL(targetUrl);
    
    // Enhanced CSS proxy with better URL handling
    css = css.replace(/url\s*\(\s*(['"]?)([^'"\)]+?)\1\s*\)/gi, (match, quote, urlPath) => {
      // Skip data URLs and already processed URLs
      if (urlPath.startsWith('data:') || urlPath.includes(req.get('host'))) return match;
      
      console.log(`CSS Proxy rewriting: ${urlPath}`);
      
      let absUrl;
      try {
        absUrl = new url.URL(urlPath, baseUrl).toString();
      } catch {
        console.log(`Failed to resolve CSS URL: ${urlPath}`);
        return match;
      }
      
      const proto = req.headers['x-forwarded-proto'] || req.protocol;
      const host = req.headers['x-forwarded-host'] || req.get('host');
      const rewritten = `${proto}://${host}${PROXY_ENDPOINT}?url=${encodeURIComponent(absUrl)}`;
      
      console.log(`CSS URL rewritten: ${urlPath} -> ${rewritten}`);
      return `url(${quote}${rewritten}${quote})`;
    });
    
    res.set('Content-Type', 'text/css');
    res.set('Cache-Control', 'public, max-age=3600');
    res.send(css);
  } catch (err) {
    console.error('CSS proxy error:', err);
    res.status(500).send('Error fetching CSS: ' + err.message);
  }
});

// Universal resource proxy - handles all other paths
app.get(/^\/(?!q$|css-proxy$|svg-proxy$)(.*)/, async (req, res) => {
  const requestedPath = req.params[0];
  console.log(`Universal proxy request: ${requestedPath}`);
  
  // Try to get the original site from query param or referer
  let origin = req.query.origin;
  
  if (!origin && req.headers.referer) {
    console.log(`Checking referer: ${req.headers.referer}`);
    const refMatch = req.headers.referer.match(/[?&]url=([^&]+)/);
    if (refMatch) {
      try {
        const decodedUrl = decodeURIComponent(refMatch[1]);
        const originUrl = new url.URL(decodedUrl);
        origin = originUrl.origin;
        console.log(`Extracted origin from referer: ${origin}`);
      } catch (e) {
        console.log('Failed to extract origin from referer:', e.message);
      }
    }
  }
  
  if (!origin) {
    console.log('No origin found, returning 400');
    return res.status(400).send(`Missing origin parameter. Path: ${requestedPath}`);
  }
  
  // Construct the target URL
  const targetPath = requestedPath.startsWith('/') ? requestedPath : '/' + requestedPath;
  let targetUrl = origin.replace(/\/$/, '') + targetPath;
  
  // Add query parameters (except origin)
  if (req.url.includes('?')) {
    const urlObj = new URL(req.url, `http://${req.headers.host}`);
    urlObj.searchParams.delete('origin');
    if (urlObj.search) {
      targetUrl += urlObj.search;
    }
  }
  
  console.log(`Fetching resource: ${targetUrl}`);
  
  try {
    const response = await fetch(targetUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': req.headers.accept || '*/*',
        'Accept-Language': 'en-US,en;q=0.9',
        'Accept-Encoding': 'gzip, deflate, br',
        'Cache-Control': 'no-cache',
        'Pragma': 'no-cache',
        'Referer': origin
      }
    });
    
    if (!response.ok) {
      console.log(`Resource fetch failed: ${response.status} ${response.statusText}`);
      return res.status(response.status).send(`Failed to fetch: ${response.status} ${response.statusText}`);
    }
    
    // Copy response headers (excluding hop-by-hop headers)
    const hopByHop = ['connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization', 'te', 'trailer', 'transfer-encoding', 'upgrade'];
    const headers = {};
    
    for (const [header, value] of response.headers.entries()) {
      if (!hopByHop.includes(header.toLowerCase())) {
        headers[header] = value;
      }
    }
    
    // Handle content encoding
    delete headers['content-encoding'];
    
    // Set CORS headers
    headers['Access-Control-Allow-Origin'] = '*';
    
    console.log(`Successfully fetched resource: ${targetUrl} (${response.status})`);
    res.writeHead(response.status, headers);
    response.body.pipe(res);
    
  } catch (err) {
    console.error('Resource proxy error:', err);
    res.status(500).send('Error fetching resource: ' + err.message);
  }
});

// Main proxy endpoint
app.get(PROXY_ENDPOINT, async (req, res) => {
  const targetUrl = req.query.url;
  if (!targetUrl) {
    return res.status(400).send('Missing url parameter');
  }
  
  console.log(`Main proxy request: ${targetUrl}`);
  
  try {
    // Determine the appropriate Accept header based on file extension
    let acceptHeader = 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,image/apng,*/*;q=0.8';
    
    if (targetUrl.match(/\.(png|jpg|jpeg|gif|webp|ico)(\?|$)/i)) {
      acceptHeader = 'image/webp,image/apng,image/*,*/*;q=0.8';
    } else if (targetUrl.match(/\.svg(\?|$)/i)) {
      acceptHeader = 'image/svg+xml,image/*,*/*;q=0.8';
    } else if (targetUrl.match(/\.(css)(\?|$)/i)) {
      acceptHeader = 'text/css,*/*;q=0.1';
    } else if (targetUrl.match(/\.(js)(\?|$)/i)) {
      acceptHeader = 'application/javascript,text/javascript,*/*;q=0.1';
    }

    const response = await fetch(targetUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': acceptHeader,
        'Accept-Language': 'en-US,en;q=0.9',
        'Accept-Encoding': 'gzip, deflate, br',
        'Cache-Control': 'no-cache',
        'Pragma': 'no-cache',
        'Upgrade-Insecure-Requests': '1',
        'Sec-Fetch-Dest': targetUrl.match(/\.(png|jpg|jpeg|gif|webp|ico|svg)(\?|$)/i) ? 'image' : 'document',
        'Sec-Fetch-Mode': 'no-cors',
        'Sec-Fetch-Site': 'cross-site',
        // YouTube-specific headers
        'X-YouTube-Client-Name': '1',
        'X-YouTube-Client-Version': '2.20231219.01.00'
      }
    });
    
    console.log(`Fetched ${targetUrl}: ${response.status} ${response.statusText}, Content-Type: ${response.headers.get('content-type')}`);
    
    // Special debugging for SVG files
    if (targetUrl.includes('.svg')) {
      console.log(`🎯 SVG RESPONSE DEBUG:`);
      console.log(`  URL: ${targetUrl}`);
      console.log(`  Status: ${response.status} ${response.statusText}`);
      console.log(`  Content-Type: ${response.headers.get('content-type')}`);
      console.log(`  Content-Length: ${response.headers.get('content-length')}`);
    }
    
    const contentType = response.headers.get('content-type') || '';
    
    // For non-HTML content, stream directly
    if (!contentType.includes('text/html')) {
      const hopByHop = ['connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization', 'te', 'trailer', 'transfer-encoding', 'upgrade'];
      const headers = {};
      
      for (const [header, value] of response.headers.entries()) {
        if (!hopByHop.includes(header.toLowerCase())) {
          headers[header] = value;
        }
      }
      
      delete headers['content-encoding'];
      
      // Remove security headers that break embedded content
      delete headers['content-security-policy'];
      delete headers['content-security-policy-report-only'];
      delete headers['x-frame-options'];
      delete headers['x-content-type-options'];
      delete headers['strict-transport-security'];
      
      headers['Access-Control-Allow-Origin'] = '*';
      
      // Ensure SVG files have the correct content type
      if (targetUrl.match(/\.svg(\?|$)/i) && !contentType.includes('svg')) {
        headers['content-type'] = 'image/svg+xml';
        console.log(`🔧 Fixed SVG content-type from '${contentType}' to 'image/svg+xml'`);
      }
      
      // Ensure PNG/JPG files have correct content types
      if (targetUrl.match(/\.png(\?|$)/i) && !contentType.includes('png')) {
        headers['content-type'] = 'image/png';
      }
      if (targetUrl.match(/\.jpe?g(\?|$)/i) && !contentType.includes('jpeg')) {
        headers['content-type'] = 'image/jpeg';
      }
      
      console.log(`Serving ${targetUrl} as ${headers['content-type'] || contentType}`);
      
      // Special handling for SVG files
      if (targetUrl.includes('.svg')) {
        console.log(`🎯 SERVING SVG FILE:`);
        console.log(`  Final headers:`, headers);
        console.log(`  Response status: ${response.status}`);
      }
      
      res.writeHead(response.status, headers);
      response.body.pipe(res);
      return;
    }
    
    // Handle HTML content
    const html = await response.text();
    const $ = cheerio.load(html, { decodeEntities: false });
    const baseUrl = new url.URL(targetUrl);
    
    const proto = req.headers['x-forwarded-proto'] || req.protocol;
    const host = req.headers['x-forwarded-host'] || req.get('host');
    const proxyBase = `${proto}://${host}`;
    
    // Helper to rewrite URLs with SVG special handling
    function rewriteUrl(originalUrl) {
      if (!originalUrl) return originalUrl;
      
      // Skip certain URL types
      if (/^(data:|javascript:|mailto:|tel:|#)/i.test(originalUrl)) {
        return originalUrl;
      }
      
      // Skip already processed URLs
      if (originalUrl.includes(proxyBase)) {
        return originalUrl;
      }
      
      // Handle websockets
      if (/^wss?:\/\//i.test(originalUrl)) {
        const wsProto = proto === 'https' ? 'wss:' : 'ws:';
        return originalUrl.replace(/^wss?:/, wsProto).replace(/\/\/[^\/]+/, `//${host}`);
      }
      
      // Convert to absolute URL
      let absUrl;
      try {
        absUrl = new url.URL(originalUrl, baseUrl).toString();
      } catch (e) {
        console.log(`Failed to resolve URL: ${originalUrl} (${e.message})`);
        return originalUrl;
      }
      
      // Special handling for SVG files - use SVG proxy
      if (/\.svg(\?|$)/i.test(absUrl)) {
        console.log(`Using SVG proxy for: ${originalUrl} -> ${absUrl}`);
        return `${proxyBase}/svg-proxy?url=${encodeURIComponent(absUrl)}`;
      }
      
      // Log other image URLs for debugging
      if (/\.(png|jpg|jpeg|gif|webp|ico)(\?|$)/i.test(absUrl)) {
        console.log(`Rewriting image URL: ${originalUrl} -> ${absUrl}`);
      }
      
      // Everything else goes through main proxy
      const rewritten = `${proxyBase}${PROXY_ENDPOINT}?url=${encodeURIComponent(absUrl)}`;
      return rewritten;
    }
    
    // Rewrite various attributes
    const selectors = [
      { sel: 'a[href]', attr: 'href' },
      { sel: 'img[src]', attr: 'src' },
      { sel: 'script[src]', attr: 'src' },
      { sel: 'iframe[src]', attr: 'src' },
      { sel: 'frame[src]', attr: 'src' },
      { sel: 'embed[src]', attr: 'src' },
      { sel: 'object[data]', attr: 'data' },
      { sel: 'video[src]', attr: 'src' },
      { sel: 'video[poster]', attr: 'poster' },
      { sel: 'audio[src]', attr: 'src' },
      { sel: 'source[src]', attr: 'src' },
      { sel: 'input[type="image"][src]', attr: 'src' },
      { sel: 'form[action]', attr: 'action' },
      { sel: 'link[rel="icon"][href]', attr: 'href' },
      { sel: 'link[rel="shortcut icon"][href]', attr: 'href' },
      { sel: 'link[rel="apple-touch-icon"][href]', attr: 'href' },
      { sel: 'area[href]', attr: 'href' },
      { sel: 'base[href]', attr: 'href' }
    ];
    
    selectors.forEach(({ sel, attr }) => {
      $(sel).each((_, el) => {
        const val = $(el).attr(attr);
        if (val) {
          $(el).attr(attr, rewriteUrl(val));
        }
      });
    });
    
    // Handle srcset attributes
    $('[srcset]').each((_, el) => {
      const srcset = $(el).attr('srcset');
      if (srcset) {
        const rewritten = srcset.split(',').map(item => {
          const parts = item.trim().split(/\s+/);
          if (parts.length > 0) {
            parts[0] = rewriteUrl(parts[0]);
          }
          return parts.join(' ');
        }).join(', ');
        $(el).attr('srcset', rewritten);
      }
    });
    
    // Handle CSS files specially
    $('link[rel="stylesheet"]').each((_, el) => {
      const href = $(el).attr('href');
      if (href) {
        let absUrl;
        try {
          absUrl = new url.URL(href, baseUrl).toString();
        } catch {
          absUrl = href;
        }
        $(el).attr('href', `${proxyBase}/css-proxy?url=${encodeURIComponent(absUrl)}`);
      }
    });
    
    // Handle meta refresh
    $('meta[http-equiv="refresh"]').each((_, el) => {
      const content = $(el).attr('content');
      if (content) {
        const match = content.match(/^(\d+;\s*url=)(.*)$/i);
        if (match) {
          $(el).attr('content', match[1] + rewriteUrl(match[2]));
        }
      }
    });
    
    // Enhanced CSS rewriting function
    function rewriteCss(css) {
      // Handle url() with various quote styles and whitespace
      return css.replace(/url\s*\(\s*(['"]?)([^'"\)]+?)\1\s*\)/gi, (match, quote, urlPath) => {
        // Skip data URLs and already processed URLs
        if (urlPath.startsWith('data:') || urlPath.includes(proxyBase)) return match;
        
        console.log(`Rewriting CSS URL: ${urlPath}`);
        const rewritten = rewriteUrl(urlPath);
        console.log(`Rewritten to: ${rewritten}`);
        
        return `url(${quote}${rewritten}${quote})`;
      });
    }
    
    // Process inline style tags
    $('style').each((_, el) => {
      const style = $(el).html();
      if (style) {
        const rewritten = rewriteCss(style);
        $(el).html(rewritten);
        if (style !== rewritten) {
          console.log('Rewrote CSS in <style> tag');
        }
      }
    });
    
    // Process inline style attributes
    $('[style]').each((_, el) => {
      const style = $(el).attr('style');
      if (style) {
        const rewritten = rewriteCss(style);
        $(el).attr('style', rewritten);
        if (style !== rewritten) {
          console.log(`Rewrote inline style: ${style} -> ${rewritten}`);
        }
      }
    });
    
    // Enhanced JavaScript URL rewriting
    $('script').each((_, el) => {
      let script = $(el).html();
      if (script) {
        const originalScript = script;
        
        // Rewrite websocket URLs
        script = script.replace(/(["'`])(wss?:\/\/[^"'`]+)\1/gi, (match, quote, wsUrl) => {
          const wsProto = proto === 'https' ? 'wss:' : 'ws:';
          const rewritten = wsUrl.replace(/^wss?:/, wsProto).replace(/\/\/[^\/]+/, `//${host}`);
          return quote + rewritten + quote;
        });
        
        // Rewrite HTTP URLs in JavaScript strings (more comprehensive)
        script = script.replace(/(["'`])(https?:\/\/[^"'`]+)\1/gi, (match, quote, httpUrl) => {
          try {
            // Skip already proxied URLs
            if (httpUrl.includes(host)) return match;
            const rewritten = `${proxyBase}${PROXY_ENDPOINT}?url=${encodeURIComponent(httpUrl)}`;
            return quote + rewritten + quote;
          } catch {
            return match;
          }
        });
        
        // Rewrite API endpoints commonly used by YouTube/Spotify
        script = script.replace(/(["'`])(\/api\/[^"'`]+)\1/gi, (match, quote, apiPath) => {
          try {
            const absUrl = new url.URL(apiPath, baseUrl).toString();
            const rewritten = `${proxyBase}${PROXY_ENDPOINT}?url=${encodeURIComponent(absUrl)}`;
            console.log(`Rewrote API URL: ${apiPath} -> ${rewritten}`);
            return quote + rewritten + quote;
          } catch {
            return match;
          }
        });
        
        // Rewrite YouTube-specific endpoints
        script = script.replace(/(["'`])(\/youtubei\/[^"'`]+)\1/gi, (match, quote, ytPath) => {
          try {
            const absUrl = new url.URL(ytPath, baseUrl).toString();
            const rewritten = `${proxyBase}${PROXY_ENDPOINT}?url=${encodeURIComponent(absUrl)}`;
            console.log(`Rewrote YouTube API: ${ytPath} -> ${rewritten}`);
            return quote + rewritten + quote;
          } catch {
            return match;
          }
        });
        
        // Replace fetch() calls to go through proxy
        script = script.replace(/fetch\s*\(\s*(['"`])([^'"`]+)\1/gi, (match, quote, fetchUrl) => {
          try {
            // Skip data URLs and already proxied URLs
            if (fetchUrl.startsWith('data:') || fetchUrl.includes(host)) return match;
            
            let absUrl;
            if (fetchUrl.startsWith('http')) {
              absUrl = fetchUrl;
            } else {
              absUrl = new url.URL(fetchUrl, baseUrl).toString();
            }
            
            const rewritten = `${proxyBase}${PROXY_ENDPOINT}?url=${encodeURIComponent(absUrl)}`;
            console.log(`Rewrote fetch() URL: ${fetchUrl} -> ${rewritten}`);
            return `fetch(${quote}${rewritten}${quote}`;
          } catch {
            return match;
          }
        });
        
        // Handle relative URLs in JavaScript (common pattern: '/images/something.png')
        script = script.replace(/(["'`])(\/[^"'`\s]+\.(?:png|jpg|jpeg|gif|svg|webp|ico))\1/gi, (match, quote, relPath) => {
          try {
            const absUrl = new url.URL(relPath, baseUrl).toString();
            const rewritten = `${proxyBase}${PROXY_ENDPOINT}?url=${encodeURIComponent(absUrl)}`;
            console.log(`Rewrote JS image URL: ${relPath} -> ${rewritten}`);
            return quote + rewritten + quote;
          } catch {
            return match;
          }
        });
        
        // Handle CSS background-image patterns in JavaScript
        script = script.replace(/(['"`])url\s*\(\s*(['"]?)([^'"`\)]+?)\2\s*\)\1/gi, (match, outerQuote, innerQuote, urlPath) => {
          if (urlPath.startsWith('data:') || urlPath.includes(proxyBase)) return match;
          const rewritten = rewriteUrl(urlPath);
          console.log(`Rewrote JS CSS URL: ${urlPath} -> ${rewritten}`);
          return `${outerQuote}url(${innerQuote}${rewritten}${innerQuote})${outerQuote}`;
        });
        
        if (originalScript !== script) {
          console.log('Rewrote JavaScript URLs');
          $(el).html(script);
        }
      }
    });
    
    // Add base tag to help with relative URLs
    if (!$('base').length) {
      $('head').prepend(`<base href="${baseUrl.origin}/">`);
    }
    
    // Set response headers
    let htmlType = 'text/html';
    const charsetMatch = contentType.match(/charset=([^;]+)/i);
    if (charsetMatch) {
      htmlType += `; charset=${charsetMatch[1]}`;
    }
    
    res.set('Content-Type', htmlType);
    res.set('Access-Control-Allow-Origin', '*');
    
    // Add some debugging info in a comment
    const debugInfo = `
<!-- Blaze-Cors Proxy Debug Info:
Original URL: ${targetUrl}
Base URL: ${baseUrl.toString()}
Proxy Base: ${proxyBase}
-->`;
    
    res.send(debugInfo + $.html());
    
  } catch (err) {
    console.error('Main proxy error:', err);
    res.status(500).send('Error fetching target: ' + err.message);
  }
});

// Start the server
app.listen(PORT, () => {
  console.log(`🚀 Blaze-Cors proxy running on port ${PORT}`);
  console.log(`📝 Usage: GET ${PROXY_ENDPOINT}?url=https://example.com`);
  console.log(`🎯 SVG Proxy: GET /svg-proxy?url=https://example.com/image.svg`);
  console.log(`🎨 CSS Proxy: GET /css-proxy?url=https://example.com/style.css`);
});
