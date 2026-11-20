package com.shopbookidris.watcher;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // App-module plugins are not auto-discovered; register before the bridge is built.
        registerPlugin(OutboundPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
