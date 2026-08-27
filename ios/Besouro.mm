#import "Besouro.h"

#import "BesouroBubbleController.h"
#import "BesouroCrashCapture.h"
#import "BesouroElementPicker.h"
#import "BesouroFileStore.h"
#import "BesouroSurfaceController.h"
#import "BesouroShare.h"
#import "BesouroViewTreeSnapshot.h"
#import "BesouroWindows.h"

#import <UIKit/UIKit.h>
#import <React/RCTReloadCommand.h>

// The overlay TurboModule (SPEC §7): the native floating bubble, the drawer
// surface, the element-pick overlay, and the small platform bridges the drawer
// needs from outside the app's React tree.
//
// Every method here is an entry point and nothing more. The work lives in
// dedicated collaborators — bubble, drawer, picker, file store, share — and this
// class owns three responsibilities they cannot: the warm/cold reload flag, the
// main-queue hop each spec call needs, and the wiring between the bubble and the
// drawer (which deliberately know nothing about each other).

@interface Besouro ()
@property (nonatomic, strong) BesouroBubbleController *bubbleController;
@property (nonatomic, strong) BesouroSurfaceController *surfaceController;
@property (nonatomic, strong) BesouroElementPicker *elementPicker;
@end

@implementation Besouro {
  // Whether this instance was created in a process that had already hosted an
  // earlier one — a JS reload (warm) rather than a cold process start. Captured
  // once at init; see -isWarmReload.
  BOOL _warmReload;
}

// Process-lifetime flag: set the first time the module is created, so later
// instances (after a JS reload) can tell warm from cold. A native crash kills
// the process, so its relaunch reads as cold.
static BOOL sProcessInitialized = NO;

- (instancetype)init {
  if (self = [super init]) {
    @synchronized(Besouro.class) {
      _warmReload = sProcessInitialized;
      sProcessInitialized = YES;
    }

    _bubbleController = [BesouroBubbleController new];
    _surfaceController = [BesouroSurfaceController new];
    _elementPicker = [BesouroElementPicker new];

    // The bubble reports a tap; the drawer reports open/close. Neither imports
    // the other — this is the only place the two are joined.
    __weak __typeof(self) weakSelf = self;
    _bubbleController.onTap = ^{
      [weakSelf.surfaceController open];
    };
    _surfaceController.onWillOpen = ^{
      [weakSelf.bubbleController slideOffscreen];
    };
    _surfaceController.onDidClose = ^(BOOL animated) {
      [weakSelf.bubbleController returnToRestAnimated:animated];
    };
  }
  return self;
}

- (void)dealloc {
  [[NSNotificationCenter defaultCenter] removeObserver:self];
}

- (NSNumber *)isWarmReload {
  return @(_warmReload);
}

// ── Overlay ─────────────────────────────────────────────────────────────────

- (void)mountBubble:(NSString *)configuredTheme
    lightBackground:(NSString *)lightBackground
          lightIcon:(NSString *)lightIcon
     darkBackground:(NSString *)darkBackground
           darkIcon:(NSString *)darkIcon {
  // The drawer is a Fabric surface bound to the current RCTHost. On a full
  // reload the host (and its surface presenter) is torn down, but the drawer
  // window is retained by the singleton store and keeps the surface mounted —
  // a use-after-free that crashes if the drawer was open. Tear the drawer down
  // deterministically the instant a reload is triggered, while the host is
  // still alive. The bubble is a plain native view and survives the reload.
  [[NSNotificationCenter defaultCenter] addObserver:self
                                           selector:@selector(teardownSurfaceForReload)
                                               name:RCTTriggerReloadCommandNotification
                                             object:nil];
  dispatch_async(dispatch_get_main_queue(), ^{
#if !RCT_NEW_ARCH_ENABLED
    self.surfaceController.bridge = (RCTBridge *)self.bridge;
#endif
    // A re-adopted bubble means a previous module instance was here, and it may
    // have left a surface window behind that would block the re-wired bubble from
    // opening a fresh one.
    if ([self.bubbleController mountWithConfiguredTheme:configuredTheme
                                       lightBackground:lightBackground
                                             lightIcon:lightIcon
                                        darkBackground:darkBackground
                                              darkIcon:darkIcon]) {
      [self.surfaceController discardOrphanedWindows];
    }
  });
}

- (void)teardownSurfaceForReload {
  [self.surfaceController teardownForReload];
}

- (void)openDrawer {
  // Exposed to JS (the element inspector reopens the drawer after a pick), so it
  // can arrive on a background queue — but it creates the Fabric surface and
  // touches UIKit, which must be on the main queue (`-[RCTFabricSurface view]`
  // asserts this). Always hop to main; from the bubble-tap path (already main)
  // this just defers a runloop, which is harmless.
  dispatch_async(dispatch_get_main_queue(), ^{
    [self.surfaceController open];
  });
}

- (void)closeDrawer {
  dispatch_async(dispatch_get_main_queue(), ^{
    [self.surfaceController close];
  });
}

- (void)setSurfaceFrame:(double)x y:(double)y width:(double)width height:(double)height {
  dispatch_async(dispatch_get_main_queue(), ^{
    [self.surfaceController setFrame:CGRectMake(x, y, width, height)];
  });
}

- (void)resetSurfaceFrame {
  dispatch_async(dispatch_get_main_queue(), ^{
    [self.surfaceController resetFrame];
  });
}

- (void)setBubbleAppearance:(NSString *)background iconColor:(NSString *)iconColor {
  dispatch_async(dispatch_get_main_queue(), ^{
    [self.bubbleController applyAppearanceBackground:background iconColor:iconColor];
  });
}

// ── Element pick ────────────────────────────────────────────────────────────

- (void)startElementInspection:(RCTResponseSenderBlock)onResult {
  dispatch_async(dispatch_get_main_queue(), ^{
    // Dismiss the drawer so the app receives touches.
    [self.surfaceController close];
    [self.elementPicker startWithResult:onResult];
  });
}

// ── View tree snapshot ──────────────────────────────────────────────────────
// The whole native view tree under the app root, for the View Hierarchy tab. Same
// walk as the element pick, minus the point test; see `BesouroViewTreeSnapshot`.
//
// A promise because it must run on the main thread: TurboModule methods are
// invoked on the JS thread, and touching UIKit off the main thread is undefined
// behaviour. Same hop as `getSafeAreaInsets`.

- (void)snapshotViewTree:(RCTPromiseResolveBlock)resolve
                  reject:(RCTPromiseRejectBlock)reject {
  dispatch_async(dispatch_get_main_queue(), ^{
    resolve([BesouroViewTreeSnapshot captureJSON]);
  });
}

// ── Filesystem persistence ──────────────────────────────────────────────────

- (void)readFile:(NSString *)filename
         resolve:(RCTPromiseResolveBlock)resolve
          reject:(RCTPromiseRejectBlock)reject {
  resolve([BesouroFileStore readFile:filename]);
}

- (void)writeFile:(NSString *)filename
          content:(NSString *)content
          resolve:(RCTPromiseResolveBlock)resolve
           reject:(RCTPromiseRejectBlock)reject {
  NSError *error = nil;
  [BesouroFileStore writeFile:filename content:content error:&error];
  if (error) {
    reject(@"Besouro", error.localizedDescription, error);
  } else {
    resolve(nil);
  }
}

- (void)deleteFile:(NSString *)filename
           resolve:(RCTPromiseResolveBlock)resolve
            reject:(RCTPromiseRejectBlock)reject {
  [BesouroFileStore deleteFile:filename];
  resolve(nil);
}

// ── Native crash capture ────────────────────────────────────────────────────

- (void)setCrashContext:(NSString *)sessionId {
  [BesouroCrashCapture installWithSessionId:sessionId];
}

// ── Safe-area insets ────────────────────────────────────────────────────────
// The drawer is hosted in its own full-screen UIWindow, outside the app's React
// tree, so JS has no SafeAreaProvider to read from. Report the app window's
// safeAreaInsets (points — the units React layout uses) so the drawer can keep
// content clear of the notch/status bar, home indicator and rounded corners.
// safeAreaInsets is a UIKit read, so hop to the main thread.

- (void)getSafeAreaInsets:(RCTPromiseResolveBlock)resolve
                   reject:(RCTPromiseRejectBlock)reject {
  dispatch_async(dispatch_get_main_queue(), ^{
    UIEdgeInsets insets = [BesouroWindows appSafeAreaInsets];
    resolve(@{
      @"top": @(insets.top),
      @"bottom": @(insets.bottom),
      @"left": @(insets.left),
      @"right": @(insets.right),
    });
  });
}

// ── Device locale ───────────────────────────────────────────────────────────
// The drawer's i18n resolves its language from this. `preferredLanguages` is the
// user's ordered UI-language list ("pt-BR", "es-419", …) — the list the UI should
// follow; `currentLocale` is the region/format locale, used only as a fallback.
// NSLocale is thread-safe, so no main-queue hop, which keeps the call synchronous
// for JS.

- (NSString *)getDeviceLocale {
  return NSLocale.preferredLanguages.firstObject
      ?: NSLocale.currentLocale.localeIdentifier;
}

// ── Clipboard ───────────────────────────────────────────────────────────────
// Write-only. UIPasteboard must be touched on the main thread.

- (void)setClipboardString:(NSString *)text {
  dispatch_async(dispatch_get_main_queue(), ^{
    [UIPasteboard generalPasteboard].string = text ?: @"";
  });
}

// ── Haptics ─────────────────────────────────────────────────────────────────
// One light tap, for a gesture that changed state under the finger. The
// generator is created per call rather than kept around: `prepare` warms the
// Taptic Engine for the moment that follows, and holding it warm between drags
// would burn power for a feedback the user may never ask for again. A device
// without a Taptic Engine, or a user who silenced haptics, gets nothing — the
// call is still safe.

- (void)haptic {
  dispatch_async(dispatch_get_main_queue(), ^{
    UIImpactFeedbackGenerator *generator = [[UIImpactFeedbackGenerator alloc]
        initWithStyle:UIImpactFeedbackStyleLight];
    [generator prepare];
    [generator impactOccurred];
  });
}

// ── Share ───────────────────────────────────────────────────────────────────
// `mimeType` is Android-only: UIActivityViewController infers the UTI from the
// file extension, so it is accepted and ignored here.

- (void)shareFile:(NSString *)path mimeType:(NSString *)mimeType {
  dispatch_async(dispatch_get_main_queue(), ^{
    [BesouroShare shareFileAtPath:path
                        preferredWindow:self.surfaceController.surfaceWindow];
  });
}

- (void)shareBase64File:(NSString *)base64
               filename:(NSString *)filename
               mimeType:(NSString *)mimeType {
  dispatch_async(dispatch_get_main_queue(), ^{
    [BesouroShare shareBase64:base64
                           filename:filename
                    preferredWindow:self.surfaceController.surfaceWindow];
  });
}

// ── TurboModule registration ────────────────────────────────────────────────

- (std::shared_ptr<facebook::react::TurboModule>)getTurboModule:
    (const facebook::react::ObjCTurboModule::InitParams &)params
{
    return std::make_shared<facebook::react::NativeBesouroSpecJSI>(params);
}

+ (NSString *)moduleName {
  return @"Besouro";
}

@end
