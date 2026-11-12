package dev.bmweb.frontend;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Intent;
import android.content.res.AssetManager;
import android.os.Build;
import android.os.IBinder;
import java.io.IOException;
import java.io.InputStream;

public class ServerService extends Service {
  public static volatile String baseUrl = null;
  private LocalServer server;

  public IBinder onBind(Intent i) { return null; }

  public int onStartCommand(Intent intent, int flags, int startId) {
    if (server == null) {
      try {
        final AssetManager assets = getAssets();
        LocalServer srv = new LocalServer(new LocalServer.Opener() {
          public InputStream open(String path) throws IOException { return assets.open(path); }
        });
        int p = srv.start(8901);
        server = srv;
        baseUrl = "http://127.0.0.1:" + p + "/";
      } catch (Throwable t) { stopSelf(); return START_NOT_STICKY; }
      if (server == null) { stopSelf(); return START_NOT_STICKY; }
    }
    try {
      String ch = "bmweb";
      NotificationManager nm = (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
      if (Build.VERSION.SDK_INT >= 26) {
        NotificationChannel c = new NotificationChannel(ch, "BM Web server", NotificationManager.IMPORTANCE_LOW);
        nm.createNotificationChannel(c);
      }
      Intent back = new Intent(this, MainActivity.class);
      PendingIntent pi = PendingIntent.getActivity(this, 0, back, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
      Notification.Builder b = (Build.VERSION.SDK_INT >= 26) ? new Notification.Builder(this, ch) : new Notification.Builder(this);
      b.setContentTitle("BM Web running").setContentText(baseUrl + " - game stays playable in Chrome");
      b.setSmallIcon(android.R.drawable.ic_dialog_info).setContentIntent(pi).setOngoing(true);
      startForeground(1, b.build());
    } catch (Throwable ignoredFg) {}
    return START_STICKY;
  }

  public void onDestroy() {
    if (server != null) { server.stop(); server = null; }
    baseUrl = null;
    super.onDestroy();
  }
}