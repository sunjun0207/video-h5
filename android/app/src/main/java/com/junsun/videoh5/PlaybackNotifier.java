package com.junsun.videoh5;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.pm.PackageManager;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.net.Uri;
import android.os.Build;
import android.os.SystemClock;
import android.support.v4.media.MediaMetadataCompat;
import android.support.v4.media.session.MediaSessionCompat;
import android.support.v4.media.session.PlaybackStateCompat;
import android.util.Base64;
import androidx.core.app.ActivityCompat;
import androidx.core.app.NotificationCompat;
import androidx.core.content.ContextCompat;
import androidx.core.content.FileProvider;
import java.io.File;
import java.io.FileOutputStream;
import java.util.ArrayDeque;
import org.json.JSONObject;

/**
 * 播放时在通知栏放一条媒体卡片：画面缩略图、片名、选集、播放/暂停、进入正在播放的页面、关闭。
 * 进度走 MediaSession，系统下拉卡片才会跟着画面走，点卡片才能回到这一集。
 */
public final class PlaybackNotifier {
    static final String ACTION_TOGGLE = "com.junsun.videoh5.notice.TOGGLE";
    static final String ACTION_OPEN = "com.junsun.videoh5.notice.OPEN";
    static final String ACTION_CLOSE = "com.junsun.videoh5.notice.CLOSE";
    private static final String CHANNEL_ID = "playback";
    static final int NOTIFICATION_ID = 7;
    private static final int PERMISSION_REQUEST = 41;

    private static volatile Notification foregroundNote;

    static Notification foregroundNotification() {
        return foregroundNote;
    }

    private final MainActivity activity;
    private final BroadcastReceiver receiver = new BroadcastReceiver() {
        @Override
        public void onReceive(Context context, Intent intent) {
            String action = intent == null ? null : intent.getAction();
            if (ACTION_CLOSE.equals(action)) {
                dispatch("window.dispatchEvent(new Event('app-close-playback'))");
                clear();
                return;
            }
            if (ACTION_OPEN.equals(action)) {
                activity.openPlaying();
                return;
            }
            if (ACTION_TOGGLE.equals(action)) {
                if (playing) pauseFromCard();
                else playFromCard();
            }
        }
    };
    private MediaSessionCompat session;
    private boolean playing;
    private boolean active;
    private boolean serviceStarted;
    private String waiting;
    private String playId = "";
    private int playEp;
    private String title = "正在播放";
    private String subtitle = "";
    private long position;
    private long duration;
    private Bitmap art;
    private Uri artUri;
    private int frameSeq;
    private long lastFrameAt;
    private final ArrayDeque<File> frameFiles = new ArrayDeque<>();
    private String shownKey = "";

    PlaybackNotifier(MainActivity activity) {
        this.activity = activity;
    }

    void start() {
        NotificationManager manager = manager();
        if (manager != null && Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationChannel channel = new NotificationChannel(CHANNEL_ID, "正在播放", NotificationManager.IMPORTANCE_LOW);
            channel.setDescription("当前影片的播放控制");
            channel.setSound(null, null);
            manager.createNotificationChannel(channel);
        }
        session = new MediaSessionCompat(activity, "video-h5");
        session.setFlags(MediaSessionCompat.FLAG_HANDLES_MEDIA_BUTTONS | MediaSessionCompat.FLAG_HANDLES_TRANSPORT_CONTROLS);
        session.setCallback(new MediaSessionCompat.Callback() {
            @Override
            public void onPlay() {
                playFromCard();
            }

            @Override
            public void onPause() {
                pauseFromCard();
            }

            @Override
            public void onSeekTo(long pos) {
                position = Math.max(0, pos);
                publishState();
                dispatch("window.dispatchEvent(new CustomEvent('app-seek-playback',{detail:" + position + "}))");
            }

            @Override
            public void onStop() {
                dispatch("window.dispatchEvent(new Event('app-close-playback'))");
                clear();
            }
        });
        session.setActive(true);
        IntentFilter filter = new IntentFilter();
        filter.addAction(ACTION_TOGGLE);
        filter.addAction(ACTION_OPEN);
        filter.addAction(ACTION_CLOSE);
        if (Build.VERSION.SDK_INT >= 33) {
            activity.registerReceiver(receiver, filter, Context.RECEIVER_NOT_EXPORTED);
        } else {
            activity.registerReceiver(receiver, filter);
        }
    }

    void stop() {
        try {
            activity.unregisterReceiver(receiver);
        } catch (IllegalArgumentException ignored) {
            // 还没登记过。
        }
        clear();
        if (session != null) {
            session.setActive(false);
            session.release();
            session = null;
        }
    }

    boolean isActive() {
        return active;
    }

    void update(String json) {
        if (Build.VERSION.SDK_INT >= 33 && ContextCompat.checkSelfPermission(activity, android.Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
            waiting = json;
            ActivityCompat.requestPermissions(activity, new String[] {android.Manifest.permission.POST_NOTIFICATIONS}, PERMISSION_REQUEST);
            return;
        }
        show(json);
    }

    void onPermissionResult() {
        if (waiting == null) return;
        String json = waiting;
        waiting = null;
        if (Build.VERSION.SDK_INT < 33 || ContextCompat.checkSelfPermission(activity, android.Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED) {
            show(json);
        }
    }

    /** 只刷新进度和播放状态，避免每一秒都重画缩略图。 */
    void progress(int positionMs, int durationMs, boolean isPlaying) {
        if (!active || session == null) return;
        position = Math.max(0, positionMs);
        if (durationMs > 0) duration = durationMs;
        playing = isPlaying;
        publishSession(false);
    }

    /** 播放中大约每秒换一张当前画面。小米的卡片会记住第一张图，地址变了才会重画。 */
    void frame(String dataUrl) {
        if (!active || session == null) return;
        long now = SystemClock.elapsedRealtime();
        if (now - lastFrameAt < 700) return;
        byte[] bytes = decodeDataImage(dataUrl);
        if (bytes == null) return;
        Bitmap bitmap = BitmapFactory.decodeByteArray(bytes, 0, bytes.length);
        if (bitmap == null) return;
        lastFrameAt = now;
        art = bitmap;
        Uri next = writeFrame(bytes);
        if (next != null) artUri = next;
        publishSession(true);
    }

    void clear() {
        waiting = null;
        playing = false;
        active = false;
        shownKey = "";
        foregroundNote = null;
        art = null;
        artUri = null;
        lastFrameAt = 0;
        deleteFrames();
        activity.releasePlaybackKeep();
        stopService();
        NotificationManager manager = manager();
        if (manager != null) manager.cancel(NOTIFICATION_ID);
        if (session != null) session.setActive(false);
    }

    private void playFromCard() {
        playing = true;
        publishState();
        dispatch("window.dispatchEvent(new Event('app-play-playback'))");
    }

    private void pauseFromCard() {
        playing = false;
        publishState();
        dispatch("window.dispatchEvent(new Event('app-pause-playback'))");
    }

    private void show(String json) {
        NotificationManager manager = manager();
        if (manager == null || session == null) return;
        String nextTitle = "正在播放";
        String nextSubtitle = "";
        String thumb = "";
        boolean nextPlaying = false;
        String nextId = "";
        int nextEp = 0;
        long nextPosition = 0;
        long nextDuration = 0;
        try {
            JSONObject payload = new JSONObject(json);
            nextTitle = payload.optString("title", nextTitle);
            nextSubtitle = payload.optString("subtitle", "");
            thumb = payload.optString("thumb", "");
            nextPlaying = payload.optBoolean("playing", false);
            nextId = payload.optString("id", "");
            nextEp = payload.optInt("ep", 0);
            nextPosition = payload.optLong("position", 0);
            nextDuration = payload.optLong("duration", 0);
        } catch (Exception ignored) {
            return;
        }
        title = nextTitle;
        subtitle = nextSubtitle;
        playId = nextId;
        playEp = nextEp;
        playing = nextPlaying;
        position = Math.max(0, nextPosition);
        if (nextDuration > 0) duration = nextDuration;
        Bitmap decoded = decodeThumb(thumb);
        if (decoded != null) art = decoded;
        active = true;
        publishSession(true);
        activity.keepPlaybackAlive();
    }

    private void publishSession(boolean notify) {
        if (session == null) return;
        session.setActive(true);
        PendingIntent open = openIntent();
        session.setSessionActivity(open);
        MediaMetadataCompat.Builder meta = new MediaMetadataCompat.Builder()
            .putString(MediaMetadataCompat.METADATA_KEY_TITLE, title)
            .putString(MediaMetadataCompat.METADATA_KEY_ARTIST, subtitle)
            .putString(MediaMetadataCompat.METADATA_KEY_DISPLAY_TITLE, title)
            .putString(MediaMetadataCompat.METADATA_KEY_DISPLAY_SUBTITLE, subtitle);
        if (duration > 0) meta.putLong(MediaMetadataCompat.METADATA_KEY_DURATION, duration);
        if (art != null) {
            meta.putBitmap(MediaMetadataCompat.METADATA_KEY_ALBUM_ART, art);
            meta.putBitmap(MediaMetadataCompat.METADATA_KEY_ART, art);
            meta.putBitmap(MediaMetadataCompat.METADATA_KEY_DISPLAY_ICON, art);
        }
        if (artUri != null) {
            String uri = artUri.toString();
            meta.putString(MediaMetadataCompat.METADATA_KEY_ALBUM_ART_URI, uri);
            meta.putString(MediaMetadataCompat.METADATA_KEY_ART_URI, uri);
            meta.putString(MediaMetadataCompat.METADATA_KEY_DISPLAY_ICON_URI, uri);
        }
        session.setMetadata(meta.build());
        publishState();
        if (!notify) return;
        String key = playId + "\n" + playEp + "\n" + (playing ? 1 : 0) + "\n" + title + "\n" + subtitle + "\n" + System.identityHashCode(art);
        if (key.equals(shownKey) && foregroundNote != null) return;
        shownKey = key;
        int toggleIcon = playing ? android.R.drawable.ic_media_pause : android.R.drawable.ic_media_play;
        String toggleLabel = playing ? "暂停" : "播放";
        Notification notification = new NotificationCompat.Builder(activity, CHANNEL_ID)
            .setSmallIcon(android.R.drawable.ic_media_play)
            .setLargeIcon(art)
            .setContentTitle(title)
            .setContentText(subtitle)
            .setContentIntent(open)
            .setDeleteIntent(pendingBroadcast(ACTION_CLOSE))
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setCategory(NotificationCompat.CATEGORY_TRANSPORT)
            .setOnlyAlertOnce(true)
            .setOngoing(playing)
            .setColor(0xFFDB2777)
            .addAction(toggleIcon, toggleLabel, pendingBroadcast(ACTION_TOGGLE))
            .addAction(android.R.drawable.ic_menu_view, "进入应用", open)
            .addAction(android.R.drawable.ic_menu_close_clear_cancel, "关闭", pendingBroadcast(ACTION_CLOSE))
            .setStyle(new androidx.media.app.NotificationCompat.MediaStyle()
                .setMediaSession(session.getSessionToken())
                .setShowActionsInCompactView(0, 1, 2))
            .build();
        foregroundNote = notification;
        NotificationManager manager = manager();
        if (manager != null) manager.notify(NOTIFICATION_ID, notification);
        ensureService();
    }

    private void publishState() {
        if (session == null) return;
        long actions = PlaybackStateCompat.ACTION_PLAY
            | PlaybackStateCompat.ACTION_PAUSE
            | PlaybackStateCompat.ACTION_PLAY_PAUSE
            | PlaybackStateCompat.ACTION_STOP
            | PlaybackStateCompat.ACTION_SEEK_TO;
        int state = playing ? PlaybackStateCompat.STATE_PLAYING : PlaybackStateCompat.STATE_PAUSED;
        session.setPlaybackState(new PlaybackStateCompat.Builder()
            .setActions(actions)
            .setState(state, duration > 0 ? position : PlaybackStateCompat.PLAYBACK_POSITION_UNKNOWN, playing ? 1f : 0f)
            .build());
    }

    private void ensureService() {
        if (serviceStarted || foregroundNote == null) return;
        serviceStarted = true;
        try {
            Intent intent = new Intent(activity, PlaybackService.class);
            if (Build.VERSION.SDK_INT >= 26) activity.startForegroundService(intent);
            else activity.startService(intent);
        } catch (Exception ex) {
            serviceStarted = false;
        }
    }

    private void stopService() {
        if (!serviceStarted) return;
        serviceStarted = false;
        activity.stopService(new Intent(activity, PlaybackService.class));
    }

    private Bitmap decodeThumb(String thumb) {
        byte[] bytes = decodeDataImage(thumb);
        if (bytes == null) return null;
        return BitmapFactory.decodeByteArray(bytes, 0, bytes.length);
    }

    private byte[] decodeDataImage(String data) {
        if (data == null || !data.startsWith("data:image")) return null;
        int comma = data.indexOf(',');
        if (comma < 0) return null;
        try {
            return Base64.decode(data.substring(comma + 1), Base64.DEFAULT);
        } catch (IllegalArgumentException ex) {
            return null;
        }
    }

    private Uri writeFrame(byte[] bytes) {
        try {
            File dir = new File(activity.getCacheDir(), "playback");
            if (!dir.exists() && !dir.mkdirs()) return null;
            frameSeq += 1;
            File file = new File(dir, "frame-" + frameSeq + ".jpg");
            try (FileOutputStream out = new FileOutputStream(file)) {
                out.write(bytes);
            }
            frameFiles.addLast(file);
            while (frameFiles.size() > 3) {
                File old = frameFiles.removeFirst();
                if (old != null) old.delete();
            }
            Uri uri = FileProvider.getUriForFile(activity, activity.getPackageName() + ".fileprovider", file);
            grantArtwork(uri);
            return uri;
        } catch (Exception ex) {
            return null;
        }
    }

    private void grantArtwork(Uri uri) {
        int mode = Intent.FLAG_GRANT_READ_URI_PERMISSION;
        String[] readers = {"com.android.systemui", "com.miui.systemui"};
        for (String reader : readers) {
            try {
                activity.grantUriPermission(reader, uri, mode);
            } catch (Exception ignored) {
                // 这台机器没有这个系统界面包。
            }
        }
    }

    private void deleteFrames() {
        while (!frameFiles.isEmpty()) {
            File old = frameFiles.removeFirst();
            if (old != null) old.delete();
        }
    }

    private PendingIntent openIntent() {
        Intent launch = new Intent(activity, MainActivity.class);
        launch.setAction(ACTION_OPEN);
        launch.setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        launch.putExtra("openPlayback", true);
        launch.putExtra("playId", playId == null ? "" : playId);
        launch.putExtra("playEp", playEp);
        int flags = PendingIntent.FLAG_UPDATE_CURRENT;
        if (Build.VERSION.SDK_INT >= 23) flags |= PendingIntent.FLAG_IMMUTABLE;
        return PendingIntent.getActivity(activity, 17, launch, flags);
    }

    private PendingIntent pendingBroadcast(String action) {
        Intent intent = new Intent(action).setPackage(activity.getPackageName());
        int flags = PendingIntent.FLAG_UPDATE_CURRENT;
        if (Build.VERSION.SDK_INT >= 23) flags |= PendingIntent.FLAG_IMMUTABLE;
        return PendingIntent.getBroadcast(activity, action.hashCode(), intent, flags);
    }

    private void dispatch(String script) {
        activity.dispatchJs(script);
    }

    private NotificationManager manager() {
        return (NotificationManager) activity.getSystemService(Context.NOTIFICATION_SERVICE);
    }
}
