package com.junsun.videoh5;

import android.Manifest;
import android.content.Intent;
import android.content.pm.ActivityInfo;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.graphics.drawable.ColorDrawable;
import android.os.Build;
import android.os.Bundle;
import android.view.View;
import android.view.ViewGroup;
import android.view.WindowManager;
import android.webkit.CookieManager;
import android.webkit.JavascriptInterface;
import android.webkit.WebSettings;
import androidx.activity.OnBackPressedCallback;
import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    private PlaybackNotifier playback;
    private volatile boolean pendingOpen;
    private boolean keeping;
    private boolean pumping;
    private boolean askedNotification;

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
        Intent incoming = getIntent();
        if (incoming != null && incoming.getBooleanExtra("openPlayback", false)) {
            pendingOpen = true;
            incoming.removeExtra("openPlayback");
        }
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
        bridge.getWebView().addJavascriptInterface(new PlaybackBridge(), "PlaybackNotice");
        bridge.setWebViewClient(new ProxyWebViewClient(bridge));
        playback = new PlaybackNotifier(this);
        playback.start();
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        if (intent != null && intent.getBooleanExtra("openPlayback", false)) {
            intent.removeExtra("openPlayback");
            openPlaying();
        }
    }

    @Override
    public void onResume() {
        super.onResume();
        getWindow().getDecorView().post(this::askNotificationPermission);
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        if (hasFocus) askNotificationPermission();
    }

    @Override
    public void onPause() {
        super.onPause();
        pumpPlayback();
    }

    @Override
    public void onStop() {
        super.onStop();
        pumpPlayback();
    }

    @Override
    public void onDestroy() {
        keeping = false;
        if (playback != null) playback.stop();
        super.onDestroy();
    }

    /** 通知卡片点进来：回到这一集的播放页。页面还没起来时先记下，等页面来取。 */
    void openPlaying() {
        pendingOpen = true;
        dispatchJs("window.dispatchEvent(new Event('app-open-playback'))");
    }

    boolean takeOpenPlayback() {
        if (!pendingOpen) return false;
        pendingOpen = false;
        return true;
    }

    /** 一进应用就问通知权限，不等到视频播起来。 */
    private void askNotificationPermission() {
        if (askedNotification || Build.VERSION.SDK_INT < 33) return;
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED) {
            askedNotification = true;
            return;
        }
        if (!hasWindowFocus()) return;
        askedNotification = true;
        ActivityCompat.requestPermissions(this, new String[] {Manifest.permission.POST_NOTIFICATIONS}, 41);
    }

    /** 下拉通知或切出应用时，系统会暂停网页。播放没关就立刻把画面拉起来。 */
    void keepPlaybackAlive() {
        if (keeping) return;
        keeping = true;
        pumpPlayback();
    }

    void releasePlaybackKeep() {
        keeping = false;
    }

    private void pumpPlayback() {
        if (!keeping || bridge == null || bridge.getWebView() == null) return;
        bridge.getWebView().onResume();
        bridge.getWebView().resumeTimers();
        if (pumping) return;
        pumping = true;
        bridge.getWebView().postDelayed(() -> {
            pumping = false;
            if (keeping) pumpPlayback();
        }, 1000);
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        if (playback != null) playback.onPermissionResult();
    }

    void dispatchJs(String script) {
        if (bridge == null || bridge.getWebView() == null) return;
        bridge.getWebView().post(() -> {
            if (bridge.getWebView() == null) return;
            bridge.getWebView().onResume();
            bridge.getWebView().resumeTimers();
            bridge.getWebView().evaluateJavascript(script, null);
        });
    }

    private void enterLandscapePlayback() {
        landscapeBack.setEnabled(true);
        setRequestedOrientation(ActivityInfo.SCREEN_ORIENTATION_SENSOR_LANDSCAPE);
        paintPlaybackFrame(Color.BLACK);
        WindowCompat.setDecorFitsSystemWindows(getWindow(), false);
        WindowInsetsControllerCompat controller = WindowCompat.getInsetsController(getWindow(), getWindow().getDecorView());
        controller.setSystemBarsBehavior(WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
        controller.hide(WindowInsetsCompat.Type.systemBars());
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            WindowManager.LayoutParams attrs = getWindow().getAttributes();
            attrs.layoutInDisplayCutoutMode = WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES;
            getWindow().setAttributes(attrs);
        }
        relayoutAfterRotate();
    }

    /** 全屏时去掉 WebView 自己的边距，让页面跟屏幕一样大。 */
    private void expandToScreen(View view) {
        view.setPadding(0, 0, 0, 0);
        ViewGroup.LayoutParams lp = view.getLayoutParams();
        if (lp == null) return;
        lp.width = ViewGroup.LayoutParams.MATCH_PARENT;
        lp.height = ViewGroup.LayoutParams.MATCH_PARENT;
        if (lp instanceof ViewGroup.MarginLayoutParams) {
            ((ViewGroup.MarginLayoutParams) lp).setMargins(0, 0, 0, 0);
        }
        view.setLayoutParams(lp);
    }

    /** 转横屏后 WebView 的可视区域会晚一拍才变，补几次布局和 resize，画面才能按新尺寸铺满。 */
    private void relayoutAfterRotate() {
        if (bridge == null || bridge.getWebView() == null) return;
        android.webkit.WebView web = bridge.getWebView();
        expandToScreen(web);
        web.requestLayout();
        View parent = (View) web.getParent();
        if (parent != null) {
            expandToScreen(parent);
            parent.requestLayout();
        }
        Runnable ping = () -> dispatchJs("window.dispatchEvent(new Event('resize'))");
        web.post(ping);
        web.postDelayed(ping, 250);
        web.postDelayed(ping, 700);
    }

    private void exitLandscapePlayback() {
        landscapeBack.setEnabled(false);
        setRequestedOrientation(ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED);
        paintPlaybackFrame(Color.WHITE);
        WindowInsetsControllerCompat controller = WindowCompat.getInsetsController(getWindow(), getWindow().getDecorView());
        controller.show(WindowInsetsCompat.Type.systemBars());
        WindowCompat.setDecorFitsSystemWindows(getWindow(), true);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            WindowManager.LayoutParams attrs = getWindow().getAttributes();
            attrs.layoutInDisplayCutoutMode = WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_DEFAULT;
            getWindow().setAttributes(attrs);
        }
        if (bridge != null && bridge.getWebView() != null) {
            android.webkit.WebView web = bridge.getWebView();
            web.requestApplyInsets();
            web.requestLayout();
            web.post(() -> dispatchJs("window.dispatchEvent(new Event('resize'))"));
        }
    }

    /** 全屏时窗口和 WebView 的底色跟着画面走，避免四周露出白边。 */
    private void paintPlaybackFrame(int color) {
        getWindow().setBackgroundDrawable(new ColorDrawable(color));
        getWindow().setStatusBarColor(color);
        getWindow().setNavigationBarColor(color);
        View decor = getWindow().getDecorView();
        decor.setBackgroundColor(color);
        if (bridge != null && bridge.getWebView() != null) {
            bridge.getWebView().setBackgroundColor(color);
            View parent = (View) bridge.getWebView().getParent();
            if (parent != null) parent.setBackgroundColor(color);
        }
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

    private final class PlaybackBridge {
        @JavascriptInterface
        public void update(String json) {
            if (playback == null) return;
            runOnUiThread(() -> playback.update(json));
        }

        @JavascriptInterface
        public void progress(int positionMs, int durationMs, boolean playing) {
            if (playback == null) return;
            runOnUiThread(() -> playback.progress(positionMs, durationMs, playing));
        }

        @JavascriptInterface
        public void frame(String dataUrl) {
            if (playback == null) return;
            runOnUiThread(() -> playback.frame(dataUrl));
        }

        @JavascriptInterface
        public void clear() {
            if (playback == null) return;
            runOnUiThread(() -> playback.clear());
        }

        @JavascriptInterface
        public String consumeOpen() {
            if (!takeOpenPlayback()) return "";
            Intent intent = getIntent();
            String id = intent == null ? "" : intent.getStringExtra("playId");
            if (id == null || id.isEmpty()) return "";
            int ep = intent.getIntExtra("playEp", 0);
            return id + "\n" + ep;
        }
    }
}
