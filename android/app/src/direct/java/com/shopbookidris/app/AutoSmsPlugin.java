package com.shopbookidris.app;

import android.Manifest;
import android.content.Context;
import android.content.SharedPreferences;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.util.HashSet;
import java.util.Iterator;
import java.util.Set;

/**
 * Automatic debt reminders by SMS — DIRECT build only (see the manifest here).
 *
 * The web side (src/data/reminders.ts) writes the OUTBOX: one item per contact
 * due reminders, with the finished text and the interval in days. This class
 * only stores it and keeps the background job scheduled; ReminderWorker sends.
 *
 * Kept in SharedPreferences "auto_sms":
 *   enabled  — the owner's switch in Settings
 *   outbox   — JSON array [{id, phone, text, days}]
 *   since    — JSON {id: ms} when the contact entered the outbox (the first
 *              reminder is due one interval after that, never at once)
 *   last     — JSON {id: ms} when the last reminder went
 * A contact leaving the outbox (paid up, consent withdrawn) loses both times,
 * so owing again starts a fresh interval.
 */
@CapacitorPlugin(
    name = "AutoSms",
    permissions = { @Permission(alias = "sms", strings = { Manifest.permission.SEND_SMS }) }
)
public class AutoSmsPlugin extends Plugin {
    static final String PREFS = "auto_sms";
    static final Object LOCK = new Object();

    static SharedPreferences prefs(Context ctx) {
        return ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    static JSONObject readObject(SharedPreferences p, String key) {
        try { return new JSONObject(p.getString(key, "{}")); } catch (JSONException e) { return new JSONObject(); }
    }

    private String permission() {
        PermissionState s = getPermissionState("sms");
        return s == null ? "prompt" : s.toString();
    }

    @PluginMethod
    public void status(PluginCall call) {
        SharedPreferences p = prefs(getContext());
        JSObject last = new JSObject();
        JSONObject stored = readObject(p, "last");
        Iterator<String> keys = stored.keys();
        while (keys.hasNext()) {
            String k = keys.next();
            last.put(k, stored.optLong(k));
        }
        JSObject out = new JSObject();
        out.put("permission", permission());
        out.put("enabled", p.getBoolean("enabled", false));
        out.put("lastSent", last);
        call.resolve(out);
    }

    @PluginMethod
    public void requestPermission(PluginCall call) {
        if (getPermissionState("sms") == PermissionState.GRANTED) {
            JSObject out = new JSObject();
            out.put("permission", "granted");
            call.resolve(out);
            return;
        }
        requestPermissionForAlias("sms", call, "onPermission");
    }

    @PermissionCallback
    private void onPermission(PluginCall call) {
        JSObject out = new JSObject();
        out.put("permission", permission());
        call.resolve(out);
    }

    @PluginMethod
    public void setEnabled(PluginCall call) {
        boolean enabled = Boolean.TRUE.equals(call.getBoolean("enabled", false));
        Context ctx = getContext();
        synchronized (LOCK) {
            SharedPreferences p = prefs(ctx);
            SharedPreferences.Editor e = p.edit();
            if (enabled && !p.getBoolean("enabled", false)) {
                // Switching on must not fire a burst for everyone who waited
                // while it was off: their interval starts now.
                JSONObject since = readObject(p, "since");
                JSONObject last = readObject(p, "last");
                long now = System.currentTimeMillis();
                Iterator<String> keys = since.keys();
                Set<String> ids = new HashSet<>();
                while (keys.hasNext()) ids.add(keys.next());
                try {
                    for (String id : ids) { if (!last.has(id)) since.put(id, now); }
                } catch (JSONException ignored) { }
                e.putString("since", since.toString());
            }
            e.putBoolean("enabled", enabled).apply();
        }
        ReminderWorker.schedule(ctx, enabled);
        call.resolve();
    }

    @PluginMethod
    public void setOutbox(PluginCall call) {
        JSArray items = call.getArray("items");
        if (items == null) { call.reject("items required"); return; }
        Context ctx = getContext();
        synchronized (LOCK) {
            SharedPreferences p = prefs(ctx);
            JSONObject since = readObject(p, "since");
            JSONObject last = readObject(p, "last");
            JSONObject nextSince = new JSONObject();
            JSONObject nextLast = new JSONObject();
            JSONArray clean = new JSONArray();
            long now = System.currentTimeMillis();
            try {
                for (int i = 0; i < items.length(); i++) {
                    JSONObject it = items.getJSONObject(i);
                    String id = it.optString("id", "");
                    String phone = it.optString("phone", "");
                    String text = it.optString("text", "");
                    int days = it.optInt("days", 0);
                    if (id.isEmpty() || phone.isEmpty() || text.isEmpty() || days <= 0) continue;
                    clean.put(it);
                    nextSince.put(id, since.has(id) ? since.getLong(id) : now);
                    if (last.has(id)) nextLast.put(id, last.getLong(id));
                }
            } catch (JSONException e) {
                call.reject("bad outbox");
                return;
            }
            p.edit()
                .putString("outbox", clean.toString())
                .putString("since", nextSince.toString())
                .putString("last", nextLast.toString())
                .apply();
        }
        ReminderWorker.schedule(ctx, prefs(ctx).getBoolean("enabled", false));
        call.resolve();
    }
}
