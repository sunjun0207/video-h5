package com.junsun.videoh5;

import android.net.Uri;
import android.util.Log;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.CookieManager;
import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.FilterInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.security.GeneralSecurityException;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.security.cert.X509Certificate;
import java.util.HashMap;
import java.util.Locale;
import java.util.Map;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import javax.net.ssl.HostnameVerifier;
import javax.net.ssl.HttpsURLConnection;
import javax.net.ssl.SSLContext;
import javax.net.ssl.SSLSocketFactory;
import javax.net.ssl.TrustManager;
import javax.net.ssl.X509TrustManager;

/**
 * 网站上的 /api-video-pomelo7-server 由 nginx 转发。安装包里没有 nginx，
 * 这里按同一组规则把 WebView 的同源请求转到片源。
 * 图片源站证书对不上主机名，与开发代理的 secure:false 一样，只在这条转发里跳过校验。
 */
public final class ApiProxy {

    private static final String TAG = "VideoH5Proxy";
    private static final String PREFIX = "/api-video-pomelo7-server";
    private static final String VOD_TARGET = "https://www.dushe05.com";
    private static final String IMG_TARGET = "https://vres.wkcyvs.cn";
    private static final String IMG_A_TARGET = "https://103.39.111.180:51050";
    private static final String IMG_B_TARGET = "https://103.39.111.184:51050";
    private static final String REFERER = "https://www.dushe05.com/";
    private static final String USER_AGENT =
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
    private static final Pattern PLAY = Pattern.compile("^/api-video-pomelo7-server/play/(https?)/([^/]+)/(\\d+)(/.*)$");
    private static final Pattern CHALLENGE = Pattern.compile("'([0-9A-F]{40})'");
    /** 片库校验题算出的 Cookie。WebView 里算完的那份带不上下一次请求，所以由这里记住并附上。 */
    private static volatile String vodCookie;

    private static final SSLSocketFactory SSL_SOCKET_FACTORY = trustAllFactory();
    private static final HostnameVerifier TRUST_HOST = new HostnameVerifier() {
        @Override
        public boolean verify(String hostname, javax.net.ssl.SSLSession session) {
            return true;
        }
    };

    private ApiProxy() {}

    public static WebResourceResponse intercept(WebResourceRequest request) {
        if (request == null || request.getUrl() == null) return null;
        Uri uri = request.getUrl();
        String host = uri.getHost();
        if (host == null || !isAppHost(host)) return null;
        String path = uri.getEncodedPath();
        if (path == null || !path.startsWith(PREFIX + "/")) return null;
        try {
            return forward(request, path, uri.getEncodedQuery());
        } catch (Exception ex) {
            Log.w(TAG, "proxy failed " + path, ex);
            return text(502, "Bad Gateway", "upstream failed");
        }
    }

    private static boolean isAppHost(String host) {
        return "localhost".equalsIgnoreCase(host) || "127.0.0.1".equals(host);
    }

    private static WebResourceResponse forward(WebResourceRequest request, String path, String query) throws IOException {
        String method = request.getMethod() == null ? "GET" : request.getMethod().toUpperCase(Locale.US);
        if (!"GET".equals(method) && !"HEAD".equals(method)) return text(405, "Method Not Allowed", "method not allowed");

        Target target = resolve(path, query);
        if (target == null) return text(404, "Not Found", "unknown proxy path");
        if (target.blocked) return text(403, "Forbidden", "blocked host");

        return execute(request, target, method, vodRequestCookie(request, target), true);
    }

    private static WebResourceResponse execute(WebResourceRequest request, Target target, String method, String cookie, boolean allowRetry) throws IOException {
        HttpURLConnection conn = open(target, method, request, cookie);
        try {
            int code = conn.getResponseCode();
            if (!target.forwardCookie) {
                return streamResponse(conn, code, target);
            }
            byte[] body = readFully(streamOf(conn));
            String contentType = conn.getContentType();
            if (allowRetry && isChallenge(code, contentType, body)) {
                String solved = rememberChallenge(new String(body, StandardCharsets.UTF_8));
                if (solved != null) {
                    conn.disconnect();
                    return execute(request, target, method, "cdndefend_js_cookie=" + solved, false);
                }
            }
            WebResourceResponse response = bytesResponse(conn, code, body, target);
            conn.disconnect();
            return response;
        } catch (IOException ex) {
            conn.disconnect();
            throw ex;
        }
    }

    private static HttpURLConnection open(Target target, String method, WebResourceRequest request, String cookie) throws IOException {
        HttpURLConnection conn = (HttpURLConnection) new URL(target.url).openConnection();
        if (conn instanceof HttpsURLConnection && relaxSsl(target)) {
            HttpsURLConnection https = (HttpsURLConnection) conn;
            https.setSSLSocketFactory(SSL_SOCKET_FACTORY);
            https.setHostnameVerifier(TRUST_HOST);
        }
        conn.setRequestMethod(method);
        conn.setInstanceFollowRedirects(false);
        conn.setUseCaches(false);
        conn.setConnectTimeout(15_000);
        conn.setReadTimeout(target.play ? 300_000 : 60_000);
        conn.setRequestProperty("User-Agent", USER_AGENT);
        conn.setRequestProperty("Referer", REFERER);
        conn.setRequestProperty("Accept-Encoding", "identity");
        String accept = header(request, "Accept");
        if (accept != null) conn.setRequestProperty("Accept", accept);
        String language = header(request, "Accept-Language");
        if (language != null) conn.setRequestProperty("Accept-Language", language);
        String range = header(request, "Range");
        if (range != null) conn.setRequestProperty("Range", range);
        if (cookie != null && !cookie.isEmpty()) conn.setRequestProperty("Cookie", cookie);
        return conn;
    }

    /** 证书和主机名对不上的源（图片 IP、播放地址）才跳过校验。片库用系统证书。 */
    private static boolean relaxSsl(Target target) {
        if (target.play) return true;
        try {
            String host = new URL(target.url).getHost();
            return host != null && host.matches("\\d+(?:\\.\\d+){3}");
        } catch (IOException ex) {
            return false;
        }
    }

    private static String vodRequestCookie(WebResourceRequest request, Target target) {
        if (!target.forwardCookie) return null;
        if (vodCookie != null && !vodCookie.isEmpty()) return vodCookie;
        String fromView = null;
        try {
            fromView = CookieManager.getInstance().getCookie(request.getUrl().toString());
        } catch (RuntimeException ignored) {
            // CookieManager 还没起来时，用请求头里的
        }
        if (fromView != null && fromView.contains("cdndefend_js_cookie=")) return fromView;
        return header(request, "Cookie");
    }

    private static boolean isChallenge(int code, String contentType, byte[] body) {
        if (code == 850 || code < 100 || code > 599) return true;
        if (contentType != null && !contentType.toLowerCase(Locale.US).contains("html") && code == 200) return false;
        String html = new String(body, StandardCharsets.UTF_8);
        return html.contains("cdndefend_js_cookie");
    }

    private static String rememberChallenge(String html) {
        synchronized (ApiProxy.class) {
            Matcher matcher = CHALLENGE.matcher(html);
            if (!matcher.find()) return cookieValue(vodCookie);
            String prefix = matcher.group(1);
            if (vodCookie != null && vodCookie.contains(prefix)) return cookieValue(vodCookie);
            int index = Character.digit(prefix.charAt(0), 16);
            if (index < 0 || index > 18) return cookieValue(vodCookie);
            try {
                MessageDigest digest = MessageDigest.getInstance("SHA-1");
                for (int i = 0; i < 5_000_000; i += 1) {
                    digest.reset();
                    byte[] bytes = digest.digest((prefix + i).getBytes(StandardCharsets.US_ASCII));
                    if ((bytes[index] & 0xff) == 0xb0 && (bytes[index + 1] & 0xff) == 0x0b) {
                        vodCookie = "cdndefend_js_cookie=" + prefix + i;
                        return prefix + i;
                    }
                }
            } catch (GeneralSecurityException ex) {
                Log.w(TAG, "challenge", ex);
            }
            return cookieValue(vodCookie);
        }
    }

    private static String cookieValue(String header) {
        if (header == null) return null;
        int mark = header.indexOf("cdndefend_js_cookie=");
        if (mark < 0) return null;
        String value = header.substring(mark + "cdndefend_js_cookie=".length());
        int end = value.indexOf(';');
        return end < 0 ? value : value.substring(0, end);
    }

    private static WebResourceResponse bytesResponse(HttpURLConnection conn, int code, byte[] body, Target target) {
        int status = code >= 100 && code <= 599 ? code : 200;
        Map<String, String> headers = responseHeaders(conn, status == code ? code : 200, target);
        headers.put("Content-Length", Integer.toString(body.length));
        String mime = mimeOf(conn);
        return new WebResourceResponse(mime, encodingOf(mime), status, reason(status), headers, new ByteArrayInputStream(body));
    }

    private static WebResourceResponse streamResponse(HttpURLConnection conn, int code, Target target) {
        int status = code >= 100 && code <= 599 ? code : 200;
        Map<String, String> headers = responseHeaders(conn, code, target);
        String mime = mimeOf(conn);
        InputStream body = detach(conn, streamOf(conn));
        return new WebResourceResponse(mime, encodingOf(mime), status, reason(status), headers, body);
    }

    private static Map<String, String> responseHeaders(HttpURLConnection conn, int code, Target target) {
        Map<String, String> headers = new HashMap<>();
        String contentType = conn.getContentType();
        if (contentType != null && !contentType.isEmpty()) headers.put("Content-Type", contentType);
        copyHeader(conn, headers, "Content-Range");
        copyHeader(conn, headers, "Accept-Ranges");
        copyHeader(conn, headers, "Cache-Control");
        copyHeader(conn, headers, "ETag");
        if (!headers.containsKey("Cache-Control")) headers.put("Cache-Control", "no-store");
        if (code >= 300 && code < 400) {
            String location = conn.getHeaderField("Location");
            if (location != null) headers.put("Location", rewriteLocation(location, target));
        }
        return headers;
    }

    private static String mimeOf(HttpURLConnection conn) {
        String contentType = conn.getContentType();
        if (contentType == null || contentType.isEmpty()) return "application/octet-stream";
        return contentType.split(";", 2)[0].trim().toLowerCase(Locale.US);
    }

    private static String encodingOf(String mime) {
        return isText(mime) ? "utf-8" : null;
    }

    private static byte[] readFully(InputStream input) throws IOException {
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        byte[] buf = new byte[8192];
        int n;
        while ((n = input.read(buf)) != -1) out.write(buf, 0, n);
        return out.toByteArray();
    }

    private static Target resolve(String path, String query) {
        if (path.startsWith(PREFIX + "/vod")) {
            String rest = path.substring((PREFIX + "/vod").length());
            if (rest.isEmpty()) rest = "/";
            return Target.open(join(VOD_TARGET, rest, query), true, false);
        }
        if (path.startsWith(PREFIX + "/img-a/")) {
            return Target.open(join(IMG_A_TARGET, path.substring((PREFIX + "/img-a").length()), query), false, false);
        }
        if (path.startsWith(PREFIX + "/img-b/")) {
            return Target.open(join(IMG_B_TARGET, path.substring((PREFIX + "/img-b").length()), query), false, false);
        }
        if (path.startsWith(PREFIX + "/img/")) {
            return Target.open(join(IMG_TARGET, path.substring((PREFIX + "/img").length()), query), false, false);
        }
        Matcher matcher = PLAY.matcher(path);
        if (!matcher.matches()) return null;
        String scheme = matcher.group(1);
        String host = matcher.group(2);
        int port;
        try {
            port = Integer.parseInt(matcher.group(3));
        } catch (NumberFormatException ex) {
            return Target.blocked();
        }
        if (port < 1 || port > 65535 || blockedHost(host)) return Target.blocked();
        String rest = matcher.group(4);
        String url = scheme + "://" + host + ":" + port + rest + (query == null ? "" : "?" + query);
        return Target.play(url, scheme, host, port);
    }

    private static String join(String origin, String rest, String query) {
        if (!rest.startsWith("/")) rest = "/" + rest;
        return origin + rest + (query == null ? "" : "?" + query);
    }

    private static boolean blockedHost(String host) {
        String name = host.toLowerCase(Locale.US);
        if (name.equals("localhost") || name.endsWith(".local") || name.endsWith(".internal")) return true;
        if (name.startsWith("127.") || name.startsWith("10.") || name.startsWith("0.") || name.startsWith("192.168.") || name.startsWith("169.254.")) {
            return true;
        }
        if (name.matches("172\\.(1[6-9]|2[0-9]|3[0-1])\\..*")) return true;
        return !name.matches("[a-z0-9._-]+");
    }

    private static String rewriteLocation(String location, Target target) {
        if (location.startsWith("/")) return target.proxyForPath(location, null);
        try {
            Uri loc = Uri.parse(location);
            if (loc.getScheme() == null || loc.getHost() == null) return location;
            String scheme = loc.getScheme();
            int port = loc.getPort();
            if (port < 0) port = "https".equalsIgnoreCase(scheme) ? 443 : 80;
            String path = loc.getEncodedPath() == null ? "/" : loc.getEncodedPath();
            if (target.play) return playProxy(scheme, loc.getHost(), port, path, loc.getEncodedQuery());
            if (sameSite(loc.getHost(), VOD_TARGET)) return PREFIX + "/vod" + (path.startsWith("/") ? path : "/" + path) + queryOf(loc.getEncodedQuery());
            return location;
        } catch (RuntimeException ex) {
            return location;
        }
    }

    private static boolean sameSite(String host, String origin) {
        Uri base = Uri.parse(origin);
        return host.equalsIgnoreCase(base.getHost());
    }

    private static String playProxy(String scheme, String host, int port, String path, String query) {
        if (!path.startsWith("/")) path = "/" + path;
        return PREFIX + "/play/" + scheme + "/" + host + "/" + port + path + queryOf(query);
    }

    private static String queryOf(String query) {
        return query == null || query.isEmpty() ? "" : "?" + query;
    }

    private static String header(WebResourceRequest request, String name) {
        Map<String, String> headers = request.getRequestHeaders();
        if (headers == null) return null;
        for (Map.Entry<String, String> entry : headers.entrySet()) {
            if (name.equalsIgnoreCase(entry.getKey()) && entry.getValue() != null && !entry.getValue().isEmpty()) {
                return entry.getValue();
            }
        }
        return null;
    }

    private static void copyHeader(HttpURLConnection conn, Map<String, String> headers, String name) {
        String value = conn.getHeaderField(name);
        if (value != null && !value.isEmpty()) headers.put(name, value);
    }

    private static boolean isText(String mime) {
        return mime.startsWith("text/") || mime.contains("json") || mime.contains("javascript") || mime.contains("xml") || mime.contains("mpegurl") || mime.contains("html");
    }

    private static InputStream streamOf(HttpURLConnection conn) {
        try {
            InputStream input = conn.getInputStream();
            if (input != null) return input;
        } catch (IOException ignored) {
            // 4xx / 5xx，以及片库的 850，正文在 error stream
        }
        InputStream error = conn.getErrorStream();
        if (error != null) return error;
        return new ByteArrayInputStream(new byte[0]);
    }

    private static InputStream detach(final HttpURLConnection conn, InputStream raw) {
        return new FilterInputStream(raw) {
            @Override
            public void close() throws IOException {
                try {
                    super.close();
                } finally {
                    conn.disconnect();
                }
            }
        };
    }

    private static WebResourceResponse text(int status, String reason, String body) {
        byte[] bytes = body.getBytes(StandardCharsets.UTF_8);
        Map<String, String> headers = new HashMap<>();
        headers.put("Content-Type", "text/plain; charset=utf-8");
        headers.put("Cache-Control", "no-store");
        return new WebResourceResponse("text/plain", "utf-8", status, reason, headers, new ByteArrayInputStream(bytes));
    }

    private static String reason(int code) {
        switch (code) {
            case 200:
                return "OK";
            case 206:
                return "Partial Content";
            case 301:
                return "Moved Permanently";
            case 302:
                return "Found";
            case 303:
                return "See Other";
            case 304:
                return "Not Modified";
            case 307:
                return "Temporary Redirect";
            case 308:
                return "Permanent Redirect";
            case 400:
                return "Bad Request";
            case 403:
                return "Forbidden";
            case 404:
                return "Not Found";
            case 500:
                return "Internal Server Error";
            case 502:
                return "Bad Gateway";
            case 850:
                return "Challenge";
            default:
                return "HTTP";
        }
    }

    private static SSLSocketFactory trustAllFactory() {
        try {
            TrustManager[] trustAll = new TrustManager[] {
                new X509TrustManager() {
                    @Override
                    public void checkClientTrusted(X509Certificate[] chain, String authType) {}

                    @Override
                    public void checkServerTrusted(X509Certificate[] chain, String authType) {}

                    @Override
                    public X509Certificate[] getAcceptedIssuers() {
                        return new X509Certificate[0];
                    }
                },
            };
            SSLContext context = SSLContext.getInstance("TLS");
            context.init(null, trustAll, new SecureRandom());
            return context.getSocketFactory();
        } catch (GeneralSecurityException ex) {
            throw new ExceptionInInitializerError(ex);
        }
    }

    private static final class Target {
        final String url;
        final boolean forwardCookie;
        final boolean play;
        final boolean blocked;
        final String scheme;
        final String host;
        final int port;

        private Target(String url, boolean forwardCookie, boolean play, boolean blocked, String scheme, String host, int port) {
            this.url = url;
            this.forwardCookie = forwardCookie;
            this.play = play;
            this.blocked = blocked;
            this.scheme = scheme;
            this.host = host;
            this.port = port;
        }

        static Target open(String url, boolean forwardCookie, boolean play) {
            return new Target(url, forwardCookie, play, false, null, null, -1);
        }

        static Target play(String url, String scheme, String host, int port) {
            return new Target(url, false, true, false, scheme, host, port);
        }

        static Target blocked() {
            return new Target("", false, false, true, null, null, -1);
        }

        String proxyForPath(String path, String query) {
            if (play) return playProxy(scheme, host, port, path, query);
            return PREFIX + "/vod" + (path.startsWith("/") ? path : "/" + path) + queryOf(query);
        }
    }
}
