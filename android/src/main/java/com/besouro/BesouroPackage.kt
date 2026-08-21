package com.besouro

import com.facebook.react.BaseReactPackage
import com.facebook.react.bridge.ModuleSpec
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.module.model.ReactModuleInfo
import com.facebook.react.module.model.ReactModuleInfoProvider
import java.util.HashMap
import javax.inject.Provider

class BesouroPackage : BaseReactPackage() {
  /** The Network inspector's HTML response preview — Fabric only, see the manager. */
  override fun getViewManagers(reactContext: ReactApplicationContext): List<ModuleSpec> =
    listOf(ModuleSpec.viewManagerSpec(Provider { BesouroWebViewManager() }))

  override fun getModule(name: String, reactContext: ReactApplicationContext): NativeModule? {
    return when (name) {
      BesouroModule.NAME -> BesouroModule(reactContext)
      BesouroFileSystemModule.NAME -> BesouroFileSystemModule(reactContext)
      BesouroDatabaseModule.NAME -> BesouroDatabaseModule(reactContext)
      else -> null
    }
  }

  override fun getReactModuleInfoProvider() = ReactModuleInfoProvider {
    mapOf(
      BesouroModule.NAME to ReactModuleInfo(
        name = BesouroModule.NAME,
        className = BesouroModule.NAME,
        canOverrideExistingModule = false,
        needsEagerInit = false,
        isCxxModule = false,
        isTurboModule = true
      ),
      BesouroFileSystemModule.NAME to ReactModuleInfo(
        name = BesouroFileSystemModule.NAME,
        className = BesouroFileSystemModule.NAME,
        canOverrideExistingModule = false,
        needsEagerInit = false,
        isCxxModule = false,
        isTurboModule = true
      ),
      BesouroDatabaseModule.NAME to ReactModuleInfo(
        name = BesouroDatabaseModule.NAME,
        className = BesouroDatabaseModule.NAME,
        canOverrideExistingModule = false,
        needsEagerInit = false,
        isCxxModule = false,
        isTurboModule = true
      )
    )
  }
}
