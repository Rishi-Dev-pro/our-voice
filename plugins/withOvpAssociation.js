const { withMainActivity, withMainApplication } = require('@expo/config-plugins');
const fs = require('fs');
const path = require('path');

const INCOMING_PACKAGE_MODULE_CODE = `package com.rishi.ourvoice

import android.content.Intent
import android.net.Uri
import android.os.Build
import android.util.Log
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.bridge.WritableMap
import com.facebook.react.modules.core.DeviceEventManagerModule

class IncomingPackageModule(reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    companion object {
        const val NAME = "OurVoiceIncomingPackage"
        const val EVENT_NAME = "ourvoiceIncomingPackage"
        private const val TAG = "OurVoiceIncomingPackage"

        @Volatile
        var pendingPackage: WritableMap? = null

        @Volatile
        var currentReactContext: ReactApplicationContext? = null

        fun handleIncomingIntent(intent: Intent?) {
            if (intent == null) {
                Log.d(TAG, "[NATIVE] handleIncomingIntent: intent is null")
                return
            }

            val action = intent.action ?: run {
                Log.d(TAG, "[NATIVE] handleIncomingIntent: intent action is null")
                return
            }

            val mimeType = intent.type ?: "application/octet-stream"
            Log.d(TAG, "[NATIVE] handleIncomingIntent received action: $action, MIME: $mimeType")

            var uri: Uri? = null
            var hasExtraStream = false

            if (Intent.ACTION_SEND == action) {
                // 1. Check Intent.EXTRA_STREAM
                hasExtraStream = intent.hasExtra(Intent.EXTRA_STREAM)
                Log.d(TAG, "[NATIVE] ACTION_SEND hasExtraStream: \$hasExtraStream")

                if (hasExtraStream) {
                    uri = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                        try {
                            intent.getParcelableExtra(Intent.EXTRA_STREAM, Uri::class.java)
                        } catch (e: Exception) {
                            Log.w(TAG, "[NATIVE] getParcelableExtra Uri failed: \${e.message}")
                            null
                        }
                    } else {
                        @Suppress("DEPRECATION")
                        try {
                            intent.getParcelableExtra(Intent.EXTRA_STREAM)
                        } catch (e: Exception) {
                            Log.w(TAG, "[NATIVE] legacy getParcelableExtra failed: \${e.message}")
                            null
                        }
                    }

                    // 2. If single parcelable returned null, check for ArrayList<Uri>
                    if (uri == null) {
                        try {
                            val list: ArrayList<Uri>? = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                                intent.getParcelableArrayListExtra(Intent.EXTRA_STREAM, Uri::class.java)
                            } else {
                                @Suppress("DEPRECATION")
                                intent.getParcelableArrayListExtra(Intent.EXTRA_STREAM)
                            }
                            if (!list.isNullOrEmpty()) {
                                uri = list[0]
                                Log.d(TAG, "[NATIVE] Extracted URI from EXTRA_STREAM ArrayList")
                            }
                        } catch (e: Exception) {
                            Log.w(TAG, "[NATIVE] getParcelableArrayListExtra failed: \${e.message}")
                        }
                    }
                }

                // 3. Fallback to clipData
                if (uri == null && intent.clipData != null && (intent.clipData?.itemCount ?: 0) > 0) {
                    uri = intent.clipData?.getItemAt(0)?.uri
                    Log.d(TAG, "[NATIVE] Extracted URI from clipData")
                }

                // 4. Fallback to intent.data
                if (uri == null && intent.data != null) {
                    uri = intent.data
                    Log.d(TAG, "[NATIVE] Extracted URI from intent.data")
                }
            } else if (Intent.ACTION_VIEW == action) {
                uri = intent.data ?: intent.clipData?.takeIf { it.itemCount > 0 }?.getItemAt(0)?.uri
                Log.d(TAG, "[NATIVE] ACTION_VIEW URI: $uri")
            }

            if (uri != null) {
                val scheme = uri.scheme ?: "unknown"
                Log.d(TAG, "[NATIVE] URI scheme: $scheme, URI normalized: true")

                // Ensure read permission flag is preserved
                intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)

                val payload = Arguments.createMap().apply {
                    putString("uri", uri.toString())
                    putString("mimeType", mimeType)
                    putString("action", action)
                }

                // Store in companion object for JS cold start
                pendingPackage = payload
                Log.d(TAG, "[NATIVE] Stored pending package in native memory")

                // If React context is already initialized and active (warm start / background resume)
                val ctx = currentReactContext
                if (ctx != null && ctx.hasActiveReactInstance()) {
                    try {
                        ctx.getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
                            .emit(EVENT_NAME, payload)
                        Log.d(TAG, "[NATIVE] Emitted \$EVENT_NAME event directly to active React context")
                    } catch (e: Exception) {
                        Log.w(TAG, "[NATIVE] Failed to emit to active context: \${e.message}")
                    }
                }
            } else {
                Log.d(TAG, "[NATIVE] No URI found in incoming intent")
            }
        }
    }

    init {
        currentReactContext = reactContext
        Log.d(TAG, "[NATIVE] IncomingPackageModule initialized with ReactContext")
    }

    override fun getName(): String = NAME

    @ReactMethod
    fun getPendingPackage(promise: Promise) {
        val pkg = pendingPackage
        Log.d(TAG, "[NATIVE] getPendingPackage called from JS. Has pending: \${pkg != null}")
        promise.resolve(pkg)
    }

    @ReactMethod
    fun clearPendingPackage(promise: Promise) {
        Log.d(TAG, "[NATIVE] clearPendingPackage called from JS. Clearing memory.")
        pendingPackage = null
        promise.resolve(true)
    }
}
`;

const INCOMING_PACKAGE_PACKAGE_CODE = `package com.rishi.ourvoice

import android.view.View
import com.facebook.react.ReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.uimanager.ReactShadowNode
import com.facebook.react.uimanager.ViewManager

class IncomingPackagePackage : ReactPackage {
    override fun createNativeModules(reactContext: ReactApplicationContext): List<NativeModule> {
        return listOf(IncomingPackageModule(reactContext))
    }

    override fun createViewManagers(reactContext: ReactApplicationContext): List<ViewManager<View, ReactShadowNode<*>>> {
        return emptyList()
    }
}
`;

/**
 * Expo Config Plugin to ensure:
 * 1. Native modules IncomingPackageModule and IncomingPackagePackage are written during prebuild.
 * 2. MainApplication.kt registers IncomingPackagePackage.
 * 3. MainActivity.kt invokes IncomingPackageModule.handleIncomingIntent for ACTION_SEND and ACTION_VIEW on both cold and warm starts.
 */
const withOvpAssociation = (config) => {
  // 1. Configure MainApplication.kt
  config = withMainApplication(config, (config) => {
    // Write native Kotlin source files into the android project
    const androidSrcDir = path.join(
      config.modRequest.platformProjectRoot,
      'app/src/main/java/com/rishi/ourvoice'
    );
    if (!fs.existsSync(androidSrcDir)) {
      fs.mkdirSync(androidSrcDir, { recursive: true });
    }
    fs.writeFileSync(
      path.join(androidSrcDir, 'IncomingPackageModule.kt'),
      INCOMING_PACKAGE_MODULE_CODE,
      'utf8'
    );
    fs.writeFileSync(
      path.join(androidSrcDir, 'IncomingPackagePackage.kt'),
      INCOMING_PACKAGE_PACKAGE_CODE,
      'utf8'
    );

    let contents = config.modResults.contents;
    if (!contents.includes('IncomingPackagePackage()')) {
      contents = contents.replace(
        'PackageList(this).packages.apply {',
        'PackageList(this).packages.apply {\n          add(IncomingPackagePackage())'
      );
      config.modResults.contents = contents;
    }

    return config;
  });

  // 2. Configure MainActivity.kt
  config = withMainActivity(config, (config) => {
    let contents = config.modResults.contents;

    // Add required imports
    const requiredImports = [
      'import android.content.Intent',
      'import android.net.Uri',
      'import android.os.Build',
    ];
    for (const imp of requiredImports) {
      if (!contents.includes(imp)) {
        contents = contents.replace(
          'package com.rishi.ourvoice',
          `package com.rishi.ourvoice\n${imp}`
        );
      }
    }

    // Replace or add handleIncomingIntent in onCreate
    if (contents.includes('normalizeIncomingIntent(intent)')) {
      contents = contents.replace(
        'normalizeIncomingIntent(intent)',
        'IncomingPackageModule.handleIncomingIntent(intent)'
      );
    } else if (contents.includes('super.onCreate(null)')) {
      contents = contents.replace(
        'super.onCreate(null)',
        'IncomingPackageModule.handleIncomingIntent(intent)\n    super.onCreate(null)'
      );
    } else if (contents.includes('super.onCreate(savedInstanceState)')) {
      contents = contents.replace(
        'super.onCreate(savedInstanceState)',
        'IncomingPackageModule.handleIncomingIntent(intent)\n    super.onCreate(savedInstanceState)'
      );
    }

    // Add or replace onNewIntent
    if (contents.includes('override fun onNewIntent(intent: Intent)')) {
      // Replace existing onNewIntent and normalizeIncomingIntent with clean implementation
      contents = contents.replace(
        /override fun onNewIntent[\s\S]*?private fun normalizeIncomingIntent[\s\S]*?\n  }/,
        `override fun onNewIntent(intent: Intent) {
    IncomingPackageModule.handleIncomingIntent(intent)
    super.onNewIntent(intent)
    setIntent(intent)
  }`
      );
    } else {
      const methodsToAdd = `
  override fun onNewIntent(intent: Intent) {
    IncomingPackageModule.handleIncomingIntent(intent)
    super.onNewIntent(intent)
    setIntent(intent)
  }
`;
      const lastBraceIndex = contents.lastIndexOf('}');
      if (lastBraceIndex !== -1) {
        contents =
          contents.slice(0, lastBraceIndex) +
          methodsToAdd +
          contents.slice(lastBraceIndex);
      }
    }

    config.modResults.contents = contents;
    return config;
  });

  return config;
};

module.exports = withOvpAssociation;
