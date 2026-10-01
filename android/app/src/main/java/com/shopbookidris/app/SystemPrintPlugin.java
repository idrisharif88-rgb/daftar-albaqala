package com.shopbookidris.app;

import android.content.Context;
import android.os.Bundle;
import android.os.CancellationSignal;
import android.os.ParcelFileDescriptor;
import android.print.PageRange;
import android.print.PrintAttributes;
import android.print.PrintDocumentAdapter;
import android.print.PrintDocumentInfo;
import android.print.PrintManager;
import android.util.Base64;

import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;

/**
 * Print a PDF on ANY printer the phone can reach, through Android's own print
 * dialog.
 *
 * The Bluetooth path (print.ts) talks ESC/POS straight to one thermal printer.
 * That is the right tool for a receipt printer on the counter, and the wrong
 * one for everything else: an office laser printer on the WiFi speaks IPP, not
 * ESC/POS, and there is no end of other printer languages behind that. Android
 * already solves this — print services (Mopria, HP's plugin, Samsung's, a
 * vendor app for a thermal unit) each know their own printers, and PrintManager
 * puts all of them in ONE dialog where the user picks the printer, copies and
 * paper size. So the app hands over a finished PDF and lets the system do the
 * rest.
 *
 * No permission is involved: the dialog runs in the system's process and the
 * app only ever sees "here is the document". Same principle as the contact
 * picker and the SMS intent — delegate the act instead of holding the power.
 *
 * `print()` returns as soon as the dialog is shown. Whether the page actually
 * came out is between the print service and the printer; the app is not told,
 * and does not pretend to know.
 */
@CapacitorPlugin(name = "SystemPrint")
public class SystemPrintPlugin extends Plugin {

    @PluginMethod
    public void printPdf(PluginCall call) {
        String base64 = call.getString("base64");
        String jobName = call.getString("jobName", "دفتر البقالة");
        if (base64 == null || base64.isEmpty()) {
            call.reject("لا يوجد ما يُطبع");
            return;
        }

        // A file per job, not one shared name: the dialog reads the document
        // when IT decides to (on open, again on every paper-size change), so a
        // second print started meanwhile must not overwrite the first one's
        // pages. The adapter deletes its file when the dialog is done with it.
        final File file;
        try {
            byte[] bytes = Base64.decode(base64, Base64.DEFAULT);
            file = new File(getContext().getCacheDir(),
                    "print-" + System.currentTimeMillis() + ".pdf");
            try (FileOutputStream out = new FileOutputStream(file)) {
                out.write(bytes);
            }
        } catch (Exception e) {
            call.reject("تعذّر تجهيز الملف للطباعة", e);
            return;
        }

        // PrintManager must be driven from the UI thread and from an Activity
        // context; plugin methods arrive on a background thread.
        getActivity().runOnUiThread(() -> {
            try {
                PrintManager printManager =
                        (PrintManager) getActivity().getSystemService(Context.PRINT_SERVICE);
                if (printManager == null) {
                    file.delete();
                    call.reject("الطباعة غير مدعومة على هذا الجهاز");
                    return;
                }
                printManager.print(jobName, new PdfFileAdapter(file, jobName),
                        new PrintAttributes.Builder().build());
                call.resolve();
            } catch (Exception e) {
                file.delete();
                call.reject("تعذّر فتح نافذة الطباعة", e);
            }
        });
    }

    /** Feeds an already-finished PDF to the print dialog, unchanged. */
    private static class PdfFileAdapter extends PrintDocumentAdapter {
        private final File file;
        private final String documentName;

        PdfFileAdapter(File file, String jobName) {
            this.file = file;
            // Used as the file name when the user picks «Save as PDF».
            this.documentName = jobName.endsWith(".pdf") ? jobName : jobName + ".pdf";
        }

        @Override
        public void onLayout(PrintAttributes oldAttributes, PrintAttributes newAttributes,
                             CancellationSignal cancellationSignal,
                             LayoutResultCallback callback, Bundle extras) {
            if (cancellationSignal.isCanceled()) {
                callback.onLayoutCancelled();
                return;
            }
            // The PDF is laid out already (an A4 page — see print.ts and
            // pdf.ts). Page count is left to the service to read.
            PrintDocumentInfo info = new PrintDocumentInfo.Builder(documentName)
                    .setContentType(PrintDocumentInfo.CONTENT_TYPE_DOCUMENT)
                    .setPageCount(PrintDocumentInfo.PAGE_COUNT_UNKNOWN)
                    .build();
            callback.onLayoutFinished(info, !newAttributes.equals(oldAttributes));
        }

        @Override
        public void onWrite(PageRange[] pages, ParcelFileDescriptor destination,
                            CancellationSignal cancellationSignal,
                            WriteResultCallback callback) {
            try (InputStream in = new FileInputStream(file);
                 OutputStream out = new FileOutputStream(destination.getFileDescriptor())) {
                byte[] buffer = new byte[16 * 1024];
                int read;
                while ((read = in.read(buffer)) >= 0) {
                    if (cancellationSignal.isCanceled()) {
                        callback.onWriteCancelled();
                        return;
                    }
                    out.write(buffer, 0, read);
                }
                callback.onWriteFinished(new PageRange[] { PageRange.ALL_PAGES });
            } catch (Exception e) {
                callback.onWriteFailed(e.getMessage());
            }
        }

        @Override
        public void onFinish() {
            file.delete();
        }
    }
}
