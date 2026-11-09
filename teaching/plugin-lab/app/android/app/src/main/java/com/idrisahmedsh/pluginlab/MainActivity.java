package com.idrisahmedsh.pluginlab;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // A plugin written in this app module is not discovered automatically —
        // register it BEFORE super.onCreate, where the bridge is built.
        // En plugin skrevet i app-modulen oppdages ikke automatisk — registrer
        // den FØR super.onCreate, der broen bygges.
        registerPlugin(HostPrintPlugin.class);
        registerPlugin(ContactPickerPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
