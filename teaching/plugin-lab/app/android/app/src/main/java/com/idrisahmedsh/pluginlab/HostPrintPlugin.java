package com.idrisahmedsh.pluginlab;

import android.content.Context;
import android.print.PrintAttributes;
import android.print.PrintDocumentAdapter;
import android.print.PrintManager;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Print an HTML page on ANY printer the phone can reach, through Android's own
 * print dialog. / Skriv ut en HTML-side på HVILKEN SOM HELST skriver telefonen
 * når, via Androids egen utskriftsdialog.
 *
 * EN: A plugin (pure JavaScript) hands the host a finished HTML string; the host
 *     draws it in a hidden WebView — which shapes Arabic and uses the bundled
 *     font — and gives that to PrintManager. No permission is involved: the
 *     dialog runs in the system's process.
 * NO: En plugin (ren JavaScript) gir verten en ferdig HTML-streng; verten
 *     tegner den i en skjult WebView — som former arabisk og bruker den
 *     medfølgende fonten — og gir den til PrintManager. Ingen tillatelse trengs.
 *
 * `printHtml` resolves when the dialog is SHOWN; whether paper came out is
 * between the print service and the printer.
 */
@CapacitorPlugin(name = "HostPrint")
public class HostPrintPlugin extends Plugin {

    // Held until the next job: the print adapter reads the WebView lazily, so a
    // garbage-collected view would print a blank page.
    private WebView printView;

    @PluginMethod
    public void printHtml(PluginCall call) {
        final String html = call.getString("html");
        final String jobName = call.getString("jobName", "Plugin Lab");
        if (html == null || html.isEmpty()) {
            call.reject("Nothing to print");
            return;
        }
        getActivity().runOnUiThread(() -> {
            try {
                WebView view = new WebView(getActivity());
                view.getSettings().setJavaScriptEnabled(false); // a static page needs no script
                final boolean[] started = { false };
                view.setWebViewClient(new WebViewClient() {
                    @Override
                    public void onPageFinished(WebView v, String url) {
                        if (started[0]) return; // can fire more than once
                        started[0] = true;
                        PrintManager pm = (PrintManager) getActivity().getSystemService(Context.PRINT_SERVICE);
                        if (pm == null) { call.reject("Printing is not supported on this device"); return; }
                        PrintDocumentAdapter adapter = v.createPrintDocumentAdapter(jobName);
                        pm.print(jobName, adapter, new PrintAttributes.Builder().build());
                        call.resolve();
                    }
                });
                printView = view;
                view.loadDataWithBaseURL(null, html, "text/html", "UTF-8", null);
            } catch (Exception e) {
                call.reject("Could not open the print dialog", e);
            }
        });
    }
}
