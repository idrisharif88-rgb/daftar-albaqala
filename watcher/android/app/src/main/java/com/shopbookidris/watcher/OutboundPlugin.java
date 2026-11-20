package com.shopbookidris.watcher;

import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.net.Uri;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Opens WhatsApp or the messaging app on the developer's phone with a message
 * filled in (the verification code) — and says whether it opened.
 *
 * A trimmed copy of the shop app's OutboundPlugin: an explicit intent reports
 * failure, where window.open('https://wa.me/…') silently opens a browser.
 * No permission: the developer presses send himself, in his own app.
 * The <queries> entries in the manifest make WhatsApp / SMS visible (Android 11+).
 */
@CapacitorPlugin(name = "Outbound")
public class OutboundPlugin extends Plugin {

    private void answer(PluginCall call, boolean opened) {
        JSObject ret = new JSObject();
        ret.put("opened", opened);
        call.resolve(ret);
    }

    private boolean launch(Intent intent) {
        try {
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(intent);
            return true;
        } catch (ActivityNotFoundException e) {
            return false;
        } catch (Exception e) {
            return false;
        }
    }

    @PluginMethod
    public void openWhatsApp(PluginCall call) {
        Uri uri = Uri.parse("whatsapp://send?phone=" + Uri.encode(call.getString("phone", ""))
                + "&text=" + Uri.encode(call.getString("text", "")));
        answer(call, launch(new Intent(Intent.ACTION_VIEW, uri)));
    }

    @PluginMethod
    public void openSms(PluginCall call) {
        Intent intent = new Intent(Intent.ACTION_SENDTO,
                Uri.parse("smsto:" + Uri.encode(call.getString("phone", ""))));
        intent.putExtra("sms_body", call.getString("text", ""));
        answer(call, launch(intent));
    }
}
