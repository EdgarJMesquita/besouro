// Fabric component view backing the `BesouroWebView` spec in
// src/native/BesouroWebViewNativeComponent.ts — a WKWebView with two
// props, used by the Network inspector to render an HTML response body.
//
// New architecture only: the legacy renderer has no RCTViewManager counterpart,
// so the whole file compiles away on an old-arch build and JS falls back to the
// raw text viewer (see isFabricRenderer in src/shared/fabric.ts).

#ifdef RCT_NEW_ARCH_ENABLED

#import <React/RCTViewComponentView.h>
#import <UIKit/UIKit.h>

NS_ASSUME_NONNULL_BEGIN

@interface BesouroWebView : RCTViewComponentView
@end

NS_ASSUME_NONNULL_END

#endif
