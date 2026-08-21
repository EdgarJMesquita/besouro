#import "BesouroShare.h"

#import "BesouroWindows.h"

@implementation BesouroShare

+ (void)shareFileAtPath:(NSString *)path preferredWindow:(UIWindow *)preferredWindow {
  if (path.length == 0) return;
  if (![[NSFileManager defaultManager] fileExistsAtPath:path]) return;

  [self presentShareForURL:[NSURL fileURLWithPath:path]
            deleteWhenDone:NO
           preferredWindow:preferredWindow];
}

+ (void)shareBase64:(NSString *)base64
           filename:(NSString *)filename
    preferredWindow:(UIWindow *)preferredWindow {
  if (base64.length == 0) return;
  NSData *bytes =
      [[NSData alloc] initWithBase64EncodedString:base64
                                          options:NSDataBase64DecodingIgnoreUnknownCharacters];
  if (bytes.length == 0) return;

  // Only the last component is used: the name comes from JS and labels the
  // payload — it must never steer the write out of the temporary directory.
  NSString *name = filename.lastPathComponent;
  if (name.length == 0) name = @"image";
  NSURL *url = [[NSURL fileURLWithPath:NSTemporaryDirectory()]
      URLByAppendingPathComponent:name];

  // Silent no-op on a failed write, like the rest of this share affordance.
  if (![bytes writeToURL:url options:NSDataWritingAtomic error:nil]) return;

  [self presentShareForURL:url deleteWhenDone:YES preferredWindow:preferredWindow];
}

// Present the share sheet for a file URL. `deleteWhenDone` removes the file once
// the sheet finishes — used for the temporary copies this module writes itself,
// never for a sandbox file the user is browsing.
+ (void)presentShareForURL:(NSURL *)url
            deleteWhenDone:(BOOL)deleteWhenDone
           preferredWindow:(UIWindow *)preferredWindow {
  UIViewController *presenter = [self presenterForWindow:preferredWindow];
  if (!presenter) {
    if (deleteWhenDone) [[NSFileManager defaultManager] removeItemAtURL:url error:nil];
    return;
  }

  UIActivityViewController *share =
      [[UIActivityViewController alloc] initWithActivityItems:@[ url ]
                                        applicationActivities:nil];

  if (deleteWhenDone) {
    // Fires for both a completed share and a cancel, so the copy goes either way.
    share.completionWithItemsHandler =
        ^(UIActivityType _Nullable activityType, BOOL completed,
          NSArray *_Nullable returnedItems, NSError *_Nullable activityError) {
          [[NSFileManager defaultManager] removeItemAtURL:url error:nil];
        };
  }

  // iPad presents the sheet as a popover; without a source anchor UIKit throws.
  // Anchor it to the center of the presenter's view.
  UIPopoverPresentationController *popover = share.popoverPresentationController;
  if (popover) {
    popover.sourceView = presenter.view;
    popover.sourceRect = CGRectMake(CGRectGetMidX(presenter.view.bounds),
                                    CGRectGetMidY(presenter.view.bounds), 0, 0);
    popover.permittedArrowDirections = 0;
  }

  [presenter presentViewController:share animated:YES completion:nil];
}

// The view controller to present the share sheet on. Prefers `preferredWindow` —
// the drawer's own window, which sits at UIWindowLevelAlert — so the sheet appears
// above the drawer it was launched from; falls back to the app's key window. Walks
// to the top-most already-presented controller so we never present on a
// controller that is busy.
+ (UIViewController *)presenterForWindow:(UIWindow *)preferredWindow {
  UIWindow *window = preferredWindow
      ?: [BesouroWindows appRootView].window
      ?: [BesouroWindows appKeyWindow];
  UIViewController *viewController = window.rootViewController;
  while (viewController.presentedViewController) {
    viewController = viewController.presentedViewController;
  }
  return viewController;
}

@end
