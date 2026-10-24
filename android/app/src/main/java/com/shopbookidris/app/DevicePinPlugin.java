package com.shopbookidris.app;

import android.app.Activity;
import android.app.KeyguardManager;
import android.content.Context;
import android.content.Intent;

import androidx.activity.result.ActivityResult;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Unlock with the phone's own PIN / pattern / password — and nothing else.
 *
 * The fingerprint plugin can only offer the PIN as a fallback INSIDE its own
 * sheet, which on Android 10 turns the sheet into Settings' combined page. The
 * owner wanted the two as separate choices on Daftar's lock screen, so this
 * asks Android for the screen-lock check alone.
 *
 * KeyguardManager hands back an intent for Android's own confirm screen; the
 * app never sees the PIN, only "confirmed" or "backed out". On a Note 9 that
 * screen is full-screen — Android does not let an app shrink it into a box.
 */
@CapacitorPlugin(name = "DevicePin")
public class DevicePinPlugin extends Plugin {

    @PluginMethod
    public void confirm(PluginCall call) {
        KeyguardManager km =
                (KeyguardManager) getContext().getSystemService(Context.KEYGUARD_SERVICE);
        if (km == null || !km.isDeviceSecure()) {
            call.reject("لا يوجد رمز قفل على هذا الهاتف");
            return;
        }
        Intent intent = km.createConfirmDeviceCredentialIntent("دفتر البقالة", "أدخل رمز الهاتف لفتح الدفتر");
        if (intent == null) {
            call.reject("لا يوجد رمز قفل على هذا الهاتف");
            return;
        }
        startActivityForResult(call, intent, "confirmResult");
    }

    @ActivityCallback
    private void confirmResult(PluginCall call, ActivityResult result) {
        if (call == null) {
            return;
        }
        JSObject ret = new JSObject();
        ret.put("confirmed", result.getResultCode() == Activity.RESULT_OK);
        call.resolve(ret);
    }
}
