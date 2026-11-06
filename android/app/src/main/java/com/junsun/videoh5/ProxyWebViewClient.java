package com.junsun.videoh5;

import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebView;
import com.getcapacitor.Bridge;
import com.getcapacitor.BridgeWebViewClient;

/** 本地页面照常由 Capacitor 提供，片源前缀交给 ApiProxy。 */
public class ProxyWebViewClient extends BridgeWebViewClient {

    public ProxyWebViewClient(Bridge bridge) {
        super(bridge);
    }

    @Override
    public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
        WebResourceResponse proxied = ApiProxy.intercept(request);
        if (proxied != null) return proxied;
        return super.shouldInterceptRequest(view, request);
    }
}
