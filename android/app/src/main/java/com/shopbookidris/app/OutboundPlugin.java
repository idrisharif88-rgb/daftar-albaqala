package com.shopbookidris.app;

import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.net.Uri;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Handing a message to another app — WhatsApp, the messaging app, the mail app,
 * the browser — and saying honestly whether that app is there.
 *
 * The WebView could open most of these itself with window.open, and used to.
 * The problem is that it cannot report failure. `https://wa.me/…` is a web
 * address, so on a phone without WhatsApp Android opens a BROWSER on WhatsApp's
 * download page; on a bare emulator with no browser either, nothing happens at
 * all and no error ever reaches the JavaScript. The owner taps «إرسال عبر
 * واتساب» and watches nothing occur. A reviewer does the same thing and files
 * it as broken.
 *
 * So each channel is an explicit intent here, in two halves:
 *   - `canOpen*` asks the package manager whether anything will handle it, and
 *   - `open*` fires it inside a try/catch and returns whether it went.
 *
 * The ask-first half is what lets the app decide BEFORE writing anything: a
 * debt is only recorded once the notice is actually going out (see
 * useContactNotifier), and that promise can only be kept if "will this open?"
 * can be answered before the entry is committed.
 *
 * `canOpen` depends on the <queries> entries in the manifest — Android 11+
 * hides other packages from resolveActivity unless they are declared, and an
 * undeclared app looks identical to an absent one.
 */
@CapacitorPlugin(name = "Outbound")
public class OutboundPlugin extends Plugin {

    /** WhatsApp's own scheme. It resolves only when WhatsApp is installed —
     *  unlike a wa.me web address, which any browser will happily take. */
    private static Uri whatsappUri(String phone, String text) {
        return Uri.parse("whatsapp://send?phone=" + Uri.encode(phone)
                + "&text=" + Uri.encode(text));
    }

    private boolean resolves(Intent intent) {
        return intent.resolveActivity(getContext().getPackageManager()) != null;
    }

    private void answer(PluginCall call, String key, boolean value) {
        JSObject ret = new JSObject();
        ret.put(key, value);
        call.resolve(ret);
    }

    /** Try to start it; false means nothing on this device handles it. */
    private boolean launch(Intent intent) {
        try {
            // The plugin's context is the Activity, but an intent started from
            // outside an activity task needs its own — this flag keeps the
            // target app from being pushed into ours.
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(intent);
            return true;
        } catch (ActivityNotFoundException e) {
            return false;
        } catch (Exception e) {
            // A malformed URI or a target that refuses the start. Same outcome
            // for the caller: the message did not go.
            return false;
        }
    }

    @PluginMethod
    public void canOpenWhatsApp(PluginCall call) {
        answer(call, "available", resolves(new Intent(Intent.ACTION_VIEW, whatsappUri("0", ""))));
    }

    @PluginMethod
    public void openWhatsApp(PluginCall call) {
        String phone = call.getString("phone", "");
        String text = call.getString("text", "");
        answer(call, "opened",
                launch(new Intent(Intent.ACTION_VIEW, whatsappUri(phone, text))));
    }

    @PluginMethod
    public void canOpenSms(PluginCall call) {
        Intent probe = new Intent(Intent.ACTION_SENDTO, Uri.parse("smsto:0"));
        answer(call, "available", resolves(probe));
    }

    @PluginMethod
    public void openSms(PluginCall call) {
        String phone = call.getString("phone", "");
        String text = call.getString("text", "");
        // ACTION_SENDTO + smsto: opens the user's own messaging app with the
        // number and body filled in. It needs no permission at all — sending is
        // the person's act, in their app (see notify.ts).
        Intent intent = new Intent(Intent.ACTION_SENDTO, Uri.parse("smsto:" + Uri.encode(phone)));
        intent.putExtra("sms_body", text);
        answer(call, "opened", launch(intent));
    }

    @PluginMethod
    public void openEmail(PluginCall call) {
        String to = call.getString("to", "");
        Intent intent = new Intent(Intent.ACTION_SENDTO, Uri.parse("mailto:" + Uri.encode(to)));
        intent.putExtra(Intent.EXTRA_SUBJECT, call.getString("subject", ""));
        intent.putExtra(Intent.EXTRA_TEXT, call.getString("body", ""));
        answer(call, "opened", launch(intent));
    }

    @PluginMethod
    public void openUrl(PluginCall call) {
        String url = call.getString("url", "");
        answer(call, "opened", launch(new Intent(Intent.ACTION_VIEW, Uri.parse(url))));
    }
}
