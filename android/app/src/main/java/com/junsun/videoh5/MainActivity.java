package com.junsun.videoh5;

import android.content.pm.ActivityInfo;
import android.os.Bundle;
import android.webkit.CookieManager;
import android.webkit.JavascriptInterface;
import android.webkit.WebSettings;
import androidx.activity.OnBackPressedCallback;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    private final OnBackPressedCallback landscapeBack = new OnBackPressedCallback(false) {
        @Override
        public void handleOnBackPressed() {
            exitLandscapePlayback();
            if (bridge != null && bridge.getWebView() != null) {
                bridge.getWebView().evaluateJavascript(
                    "window.dispatchEvent(new Event('app-exit-fullscreen'))",
                    null
                );
            }
        }
    };

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        getOnBackPressedDispatcher().addCallback(this, landscapeBack);
        if (bridge == null || bridge.getWebView() == null) return;
        WebSettings settings = bridge.getWebView().getSettings();
        settings.setMediaPlaybackRequiresUserGesture(false);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_ALWAYS_ALLOW);
        CookieManager cookies = CookieManager.getInstance();
        cookies.setAcceptCookie(true);
        cookies.setAcceptThirdPartyCookies(bridge.getWebView(), true);
        bridge.getWebView().addJavascriptInterface(new OrientationBridge(), "VideoOrientation");
        bridge.setWebViewClient(new ProxyWebViewClient(bridge));
    }

    private void enterLandscapePlayback() {
        landscapeBack.setEnabled(true);
        setRequestedOrientation(ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE);
        WindowCompat.setDecorFitsSystemWindows(getWindow(), false);
        WindowInsetsControllerCompat controller = WindowCompat.getInsetsController(getWindow(), getWindow().getDecorView());
        controller.setSystemBarsBehavior(WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
        controller.hide(WindowInsetsCompat.Type.systemBars());
    }

    private void exitLandscapePlayback() {
        landscapeBack.setEnabled(false);
        setRequestedOrientation(ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED);
        WindowInsetsControllerCompat controller = WindowCompat.getInsetsController(getWindow(), getWindow().getDecorView());
        controller.show(WindowInsetsCompat.Type.systemBars());
        WindowCompat.setDecorFitsSystemWindows(getWindow(), true);
    }

    private final class OrientationBridge {
        @JavascriptInterface
        public void lockLandscape() {
            runOnUiThread(MainActivity.this::enterLandscapePlayback);
        }

        @JavascriptInterface
        public void unlock() {
            runOnUiThread(MainActivity.this::exitLandscapePlayback);
        }
    }
}
