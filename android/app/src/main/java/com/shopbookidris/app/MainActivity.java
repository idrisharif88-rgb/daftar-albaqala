package com.shopbookidris.app;

import android.content.Intent;
import android.os.Bundle;

import com.getcapacitor.BridgeActivity;
import com.getcapacitor.PluginHandle;

import ee.forgr.capacitor.social.login.GoogleProvider;
import ee.forgr.capacitor.social.login.ModifiedMainActivityForSocialLoginPlugin;
import ee.forgr.capacitor.social.login.SocialLoginPlugin;

public class MainActivity extends BridgeActivity implements ModifiedMainActivityForSocialLoginPlugin {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Plugins written in this app module are not discovered automatically —
        // only the ones installed as packages are. Registration must happen
        // BEFORE super.onCreate, which is where the bridge is built.
        registerPlugin(ContactPickerPlugin.class);
        registerPlugin(OutboundPlugin.class);
        registerPlugin(SystemPrintPlugin.class);
        registerPlugin(FilePickerPlugin.class);
        registerPlugin(DevicePinPlugin.class);
        super.onCreate(savedInstanceState);
    }

    // Google Drive backup. The Google sign-in plugin will not ask for any extra
    // scope (Drive) on Android unless this activity hands the consent screen's
    // answer back to it — without this every request fails with «You CANNOT use
    // scopes…». A browser test never needs it, so it does not prove the APK works.
    @Override
    public void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode < GoogleProvider.REQUEST_AUTHORIZE_GOOGLE_MIN
                || requestCode >= GoogleProvider.REQUEST_AUTHORIZE_GOOGLE_MAX) return;
        PluginHandle handle = getBridge().getPlugin("SocialLogin");
        if (handle != null && handle.getInstance() instanceof SocialLoginPlugin) {
            ((SocialLoginPlugin) handle.getInstance()).handleGoogleLoginIntent(requestCode, data);
        }
    }

    @Override
    public void IHaveModifiedTheMainActivityForTheUseWithSocialLoginPlugin() { }
}
