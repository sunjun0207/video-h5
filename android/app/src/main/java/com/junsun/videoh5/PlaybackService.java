package com.junsun.videoh5;

import android.app.Notification;
import android.app.Service;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.os.Build;
import android.os.IBinder;

/** 把正在播放的通知挂成前台服务，切出应用后画面和通知卡片才不会被系统冻住。 */
public final class PlaybackService extends Service {
    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        Notification notification = PlaybackNotifier.foregroundNotification();
        if (notification == null) {
            stopSelf();
            return START_NOT_STICKY;
        }
        if (Build.VERSION.SDK_INT >= 29) {
            startForeground(PlaybackNotifier.NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK);
        } else {
            startForeground(PlaybackNotifier.NOTIFICATION_ID, notification);
        }
        return START_STICKY;
    }

    @Override
    public void onDestroy() {
        stopForeground(false);
        super.onDestroy();
    }
}
