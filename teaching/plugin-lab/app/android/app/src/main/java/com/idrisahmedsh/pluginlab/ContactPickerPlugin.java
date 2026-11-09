package com.idrisahmedsh.pluginlab;

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
 * Velg ÉN kontakts navn og nummer, helt uten kontakttillatelse.
 *
 * EN: READ_CONTACTS means "let me read the whole address book, whenever I like".
 *     ACTION_PICK instead asks Android's own contacts app to show the list. The
 *     person chooses; Android hands back ONE row with a temporary read grant.
 *     The app never sees the rest, so there is nothing to ask permission for.
 *     (Same least-privilege idea as the Daftar app this was learned from.)
 * NO: READ_CONTACTS betyr «la meg lese hele adresseboken når jeg vil». ACTION_PICK
 *     ber i stedet Androids egen kontaktapp vise listen. Personen velger; Android
 *     gir tilbake ÉN rad med en midlertidig leseadgang. Appen ser aldri resten.
 */
@CapacitorPlugin(name = "ContactPicker")
public class ContactPickerPlugin extends Plugin {

    @PluginMethod
    public void pick(PluginCall call) {
        try {
            // Phone.CONTENT_URI (not Contacts.CONTENT_URI): one entry per NUMBER, so a
            // contact with three numbers lets the person say which one.
            Intent intent = new Intent(Intent.ACTION_PICK, ContactsContract.CommonDataKinds.Phone.CONTENT_URI);
            startActivityForResult(call, intent, "pickResult");
        } catch (ActivityNotFoundException e) {
            call.reject("No contacts app on this device");
        }
    }

    @ActivityCallback
    private void pickResult(PluginCall call, ActivityResult result) {
        if (call == null) return;
        JSObject ret = new JSObject();
        Uri picked = result.getData() != null ? result.getData().getData() : null;
        if (result.getResultCode() != Activity.RESULT_OK || picked == null) {
            ret.put("cancelled", true);            // backing out is a cancellation, not a failure
            call.resolve(ret);
            return;
        }
        Cursor cursor = null;
        try {
            cursor = getContext().getContentResolver().query(picked, null, null, null, null);
            if (cursor != null && cursor.moveToFirst()) {
                int nameIndex = cursor.getColumnIndex(ContactsContract.Contacts.DISPLAY_NAME);
                int phoneIndex = cursor.getColumnIndex(ContactsContract.CommonDataKinds.Phone.NUMBER);
                ret.put("name", nameIndex >= 0 ? cursor.getString(nameIndex) : "");
                ret.put("phone", phoneIndex >= 0 ? cursor.getString(phoneIndex) : "");
                ret.put("cancelled", false);
            } else {
                ret.put("cancelled", true);
            }
        } catch (Exception e) {
            call.reject("Could not read the contact", e);
            return;
        } finally {
            if (cursor != null) cursor.close();
        }
        call.resolve(ret);
    }
}
