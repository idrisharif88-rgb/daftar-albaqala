package com.shopbookidris.app;

import android.Manifest;
import android.content.Context;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.os.Build;
import android.telephony.SmsManager;

import androidx.annotation.NonNull;
import androidx.core.content.ContextCompat;
import androidx.work.ExistingPeriodicWorkPolicy;
import androidx.work.PeriodicWorkRequest;
import androidx.work.WorkManager;
import androidx.work.Worker;
import androidx.work.WorkerParameters;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.Calendar;
import java.util.concurrent.TimeUnit;

/**
 * Sends the reminders that are due — with the app closed, after a reboot,
 * without anyone touching the phone. WorkManager wakes it every few hours;
 * Android may delay a run to save battery, which is fine for a reminder
 * measured in days.
 *
 * Rules: only while the owner's switch is on and SEND_SMS is granted; only by
 * day (SEND_FROM–SEND_UNTIL, the phone's local time); at most MAX_PER_RUN
 * messages a run, so a large book is spread out instead of flooding the SIM.
 */
public class ReminderWorker extends Worker {
    static final String WORK = "auto_sms_reminders";
    static final int SEND_FROM = 9;
    static final int SEND_UNTIL = 21;
    static final int MAX_PER_RUN = 20;
    static final long DAY = 24L * 60 * 60 * 1000;

    public ReminderWorker(@NonNull Context ctx, @NonNull WorkerParameters params) {
        super(ctx, params);
    }

    static void schedule(Context ctx, boolean enabled) {
        WorkManager wm = WorkManager.getInstance(ctx);
        if (!enabled) { wm.cancelUniqueWork(WORK); return; }
        PeriodicWorkRequest req = new PeriodicWorkRequest.Builder(ReminderWorker.class, 3, TimeUnit.HOURS).build();
        wm.enqueueUniquePeriodicWork(WORK, ExistingPeriodicWorkPolicy.KEEP, req);
    }

    @NonNull
    @Override
    public Result doWork() {
        Context ctx = getApplicationContext();
        if (ContextCompat.checkSelfPermission(ctx, Manifest.permission.SEND_SMS) != PackageManager.PERMISSION_GRANTED) {
            return Result.success();
        }
        int hour = Calendar.getInstance().get(Calendar.HOUR_OF_DAY);
        if (hour < SEND_FROM || hour >= SEND_UNTIL) return Result.success();

        synchronized (AutoSmsPlugin.LOCK) {
            SharedPreferences p = AutoSmsPlugin.prefs(ctx);
            if (!p.getBoolean("enabled", false)) return Result.success();
            JSONObject since = AutoSmsPlugin.readObject(p, "since");
            JSONObject last = AutoSmsPlugin.readObject(p, "last");
            JSONArray outbox;
            try { outbox = new JSONArray(p.getString("outbox", "[]")); } catch (JSONException e) { return Result.success(); }

            SmsManager sms = Build.VERSION.SDK_INT >= 31
                ? ctx.getSystemService(SmsManager.class)
                : SmsManager.getDefault();
            if (sms == null) return Result.success();

            long now = System.currentTimeMillis();
            int sent = 0;
            for (int i = 0; i < outbox.length() && sent < MAX_PER_RUN; i++) {
                JSONObject it = outbox.optJSONObject(i);
                if (it == null) continue;
                String id = it.optString("id");
                long base = last.has(id) ? last.optLong(id) : since.optLong(id, now);
                if (now < base + it.optInt("days") * DAY) continue;
                try {
                    ArrayList<String> parts = sms.divideMessage(it.optString("text"));
                    sms.sendMultipartTextMessage(it.optString("phone"), null, parts, null, null);
                    last.put(id, now);
                    sent++;
                } catch (Exception e) {
                    // A bad number or no signal: try again on the next run.
                }
            }
            if (sent > 0) p.edit().putString("last", last.toString()).apply();
        }
        return Result.success();
    }
}
