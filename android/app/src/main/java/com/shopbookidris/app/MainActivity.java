package com.shopbookidris.app;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Plugins written in this app module are not discovered automatically —
        // only the ones installed as packages are. Registration must happen
        // BEFORE super.onCreate, which is where the bridge is built.
        registerPlugin(ContactPickerPlugin.class);
        registerPlugin(OutboundPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
