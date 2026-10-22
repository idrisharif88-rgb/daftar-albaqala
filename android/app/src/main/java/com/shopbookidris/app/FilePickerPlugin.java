package com.shopbookidris.app;

import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.database.Cursor;
import android.net.Uri;
import android.provider.OpenableColumns;
import android.util.Base64;

import androidx.activity.result.ActivityResult;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;

/**
 * Pick ONE file (an image or a PDF) to attach to an entry, with NO storage or
 * media permission.
 *
 * ACTION_GET_CONTENT asks the system picker to show the user their files; the
 * user chooses one, and Android returns a content URI carrying a one-shot read
 * grant for that single file. The app reads the bytes through that grant and
 * never holds READ_MEDIA_IMAGES or READ_EXTERNAL_STORAGE — the same
 * least-privilege design as ContactPickerPlugin.
 *
 * The bytes come back base64-encoded in the result, because the whole app talks
 * to the WebView in JSON (CapacitorHttp, the SQLite layer); a base64 string is
 * the one shape that crosses the bridge without special handling. Files above a
 * ceiling are refused here rather than read into memory.
 */
@CapacitorPlugin(name = "FilePicker")
public class FilePickerPlugin extends Plugin {

    // Must match MAX_BYTES in src/lib/filePicker.ts.
    private static final long MAX_BYTES = 12L * 1024 * 1024;

    @PluginMethod
    public void pick(PluginCall call) {
        try {
            Intent intent = new Intent(Intent.ACTION_GET_CONTENT);
            intent.addCategory(Intent.CATEGORY_OPENABLE);
            // A broad type with a narrower allowlist: some pickers ignore an
            // EXTRA_MIME_TYPES filter unless the base type is permissive.
            intent.setType("*/*");
            intent.putExtra(Intent.EXTRA_MIME_TYPES, new String[]{"image/*", "application/pdf"});
            startActivityForResult(call, Intent.createChooser(intent, "اختر ملفاً"), "pickResult");
        } catch (ActivityNotFoundException e) {
            call.reject("لا يوجد تطبيق لاختيار الملفات على هذا الجهاز");
        }
    }

    @ActivityCallback
    private void pickResult(PluginCall call, ActivityResult result) {
        if (call == null) {
            return;
        }

        JSObject ret = new JSObject();
        Uri uri = result.getData() != null ? result.getData().getData() : null;
        if (result.getResultCode() != Activity.RESULT_OK || uri == null) {
            ret.put("cancelled", true);
            call.resolve(ret);
            return;
        }

        try {
            String mime = getContext().getContentResolver().getType(uri);
            String name = queryName(uri);
            byte[] bytes = readBytes(uri);
            if (bytes == null) {
                ret.put("tooLarge", true);
                call.resolve(ret);
                return;
            }
            ret.put("data", Base64.encodeToString(bytes, Base64.NO_WRAP));
            ret.put("mime", mime != null ? mime : "application/octet-stream");
            ret.put("filename", name != null ? name : "");
            ret.put("size", bytes.length);
            ret.put("cancelled", false);
        } catch (Exception e) {
            call.reject("تعذّرت قراءة الملف", e);
            return;
        }

        call.resolve(ret);
    }

    // The display name, from the OpenableColumns metadata of the picked URI.
    private String queryName(Uri uri) {
        Cursor cursor = null;
        try {
            cursor = getContext().getContentResolver().query(uri, null, null, null, null);
            if (cursor != null && cursor.moveToFirst()) {
                int idx = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME);
                if (idx >= 0) {
                    return cursor.getString(idx);
                }
            }
        } catch (Exception ignored) {
            // No name is not an error — the app supplies a default.
        } finally {
            if (cursor != null) {
                cursor.close();
            }
        }
        return null;
    }

    // Read the whole file, aborting if it exceeds the ceiling (returns null) so
    // a giant file never balloons memory.
    private byte[] readBytes(Uri uri) throws Exception {
        InputStream in = getContext().getContentResolver().openInputStream(uri);
        if (in == null) {
            throw new Exception("stream unavailable");
        }
        try {
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            byte[] buf = new byte[8192];
            long total = 0;
            int n;
            while ((n = in.read(buf)) != -1) {
                total += n;
                if (total > MAX_BYTES) {
                    return null;
                }
                out.write(buf, 0, n);
            }
            return out.toByteArray();
        } finally {
            in.close();
        }
    }
}
