package com.shopbookidris.app;

import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.database.Cursor;
import android.net.Uri;
import android.provider.ContactsContract;

import androidx.activity.result.ActivityResult;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Pick ONE contact's name and number, with no contacts permission at all.
 *
 * The app used to hold READ_CONTACTS (and WRITE_CONTACTS, which it never used —
 * the old plugin's permission alias demanded both). That permission means "let
 * me read the whole address book, whenever I like", and Google Play treats it
 * accordingly: prominent in-app disclosure, a privacy-policy section, and a
 * Data Safety declaration. All of that to fill in two fields on a form.
 *
 * ACTION_PICK asks Android's own contacts app to show the list instead. The
 * user chooses; Android hands back a URI for that ONE contact together with a
 * temporary read grant for it. The app never sees the rest of the address book,
 * so there is nothing to ask permission for and no dialog is ever shown.
 *
 * 🧩 Server concept: least privilege, again. Holding READ_CONTACTS is holding a
 * key to the whole address book because you need one row from it. This is the
 * difference between granting SELECT on a database and handing back a single
 * row — and the same reason `daftar_user` on the droplet has DML but not DDL.
 */
@CapacitorPlugin(name = "ContactPicker")
public class ContactPickerPlugin extends Plugin {

    @PluginMethod
    public void pick(PluginCall call) {
        try {
            // Phone.CONTENT_URI rather than Contacts.CONTENT_URI: it lists one
            // entry per NUMBER, so a contact with three numbers lets the user
            // say which one, instead of the app guessing at the first.
            Intent intent = new Intent(Intent.ACTION_PICK,
                    ContactsContract.CommonDataKinds.Phone.CONTENT_URI);
            startActivityForResult(call, intent, "pickResult");
        } catch (ActivityNotFoundException e) {
            // A device with no contacts app. Not an error worth a red dialog —
            // the form still takes a name and number typed by hand.
            call.reject("لا يوجد تطبيق جهات اتصال على هذا الجهاز");
        }
    }

    @ActivityCallback
    private void pickResult(PluginCall call, ActivityResult result) {
        if (call == null) {
            return;
        }

        JSObject ret = new JSObject();
        Uri picked = result.getData() != null ? result.getData().getData() : null;
        if (result.getResultCode() != Activity.RESULT_OK || picked == null) {
            // Backed out of the picker — a cancellation, not a failure.
            ret.put("cancelled", true);
            call.resolve(ret);
            return;
        }

        Cursor cursor = null;
        try {
            cursor = getContext().getContentResolver().query(picked, null, null, null, null);
            if (cursor != null && cursor.moveToFirst()) {
                int nameIndex = cursor.getColumnIndex(ContactsContract.Contacts.DISPLAY_NAME);
                int phoneIndex =
                        cursor.getColumnIndex(ContactsContract.CommonDataKinds.Phone.NUMBER);
                ret.put("name", nameIndex >= 0 ? cursor.getString(nameIndex) : "");
                ret.put("phone", phoneIndex >= 0 ? cursor.getString(phoneIndex) : "");
                ret.put("cancelled", false);
            } else {
                ret.put("cancelled", true);
            }
        } catch (Exception e) {
            call.reject("تعذّرت قراءة جهة الاتصال", e);
            return;
        } finally {
            if (cursor != null) {
                cursor.close();
            }
        }

        call.resolve(ret);
    }
}
