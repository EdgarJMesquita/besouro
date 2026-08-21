#import "BesouroWebView.h"

#ifdef RCT_NEW_ARCH_ENABLED

#import <WebKit/WebKit.h>

#import <React/RCTConversions.h>
#import <react/renderer/components/BesouroSpec/ComponentDescriptors.h>
#import <react/renderer/components/BesouroSpec/EventEmitters.h>
#import <react/renderer/components/BesouroSpec/Props.h>
#import <react/renderer/components/BesouroSpec/RCTComponentViewHelpers.h>

using namespace facebook::react;

@interface BesouroWebView () <RCTBesouroWebViewViewProtocol, WKNavigationDelegate>
@end

@implementation BesouroWebView {
  WKWebView *_webView;
  // What the web view actually displays. `_props` can't answer that: Fabric
  // recycles component views without resetting them, so a reused view still
  // holds the previous mount's props while `prepareForRecycle` has already
  // blanked the page — an identical `source` would then read as "no change".
  std::string _loadedHtml;
  std::string _loadedUri;
}

// Registered with the renderer through the `ios.componentProvider` entry in
// package.json's codegenConfig, which resolves this class by name.
+ (ComponentDescriptorProvider)componentDescriptorProvider {
  return concreteComponentDescriptorProvider<BesouroWebViewComponentDescriptor>();
}

- (instancetype)initWithFrame:(CGRect)frame {
  if (self = [super initWithFrame:frame]) {
    static const auto defaultProps = std::make_shared<const BesouroWebViewProps>();
    _props = defaultProps;

    WKWebViewConfiguration *configuration = [WKWebViewConfiguration new];
    // What loads here is an untrusted response body captured off the wire, so it
    // gets no scripts and nothing shared with the app's own cookies or storage.
    configuration.defaultWebpagePreferences.allowsContentJavaScript = NO;
    configuration.websiteDataStore = [WKWebsiteDataStore nonPersistentDataStore];

    _webView = [[WKWebView alloc] initWithFrame:self.bounds configuration:configuration];
    _webView.navigationDelegate = self;
    // The drawer supplies its own padding; the web view sits flush in its frame.
    _webView.scrollView.contentInsetAdjustmentBehavior = UIScrollViewContentInsetAdjustmentNever;

    // RCTViewComponentView keeps contentView sized to the shadow node's layout.
    self.contentView = _webView;
  }
  return self;
}

#pragma mark - RCTComponentViewProtocol

- (void)updateProps:(const Props::Shared &)props oldProps:(const Props::Shared &)oldProps {
  const auto &newViewProps = *std::static_pointer_cast<const BesouroWebViewProps>(props);

  // Field-wise against what's loaded: codegen only gives the struct an
  // `operator==` under RN_SERIALIZABLE_STATE, so it isn't comparable here.
  if (newViewProps.source.html != _loadedHtml || newViewProps.source.uri != _loadedUri) {
    [self loadSource:newViewProps.source];
  }

  [super updateProps:props oldProps:oldProps];
}

- (void)prepareForRecycle {
  [self blank];
  [super prepareForRecycle];
}

#pragma mark - Loading

- (void)loadSource:(const BesouroWebViewSourceStruct &)source {
  _loadedHtml = source.html;
  _loadedUri = source.uri;

  if (!source.html.empty()) {
    // A nil base url leaves relative subresources unresolvable — a preview can
    // never fire requests of its own, which the Network inspector wouldn't see.
    [_webView loadHTMLString:RCTNSStringFromString(source.html) baseURL:nil];
    return;
  }

  if (!source.uri.empty()) {
    NSURL *url = [NSURL URLWithString:RCTNSStringFromString(source.uri)];
    if (url == nil) {
      [self emitError:@"Invalid uri"];
      return;
    }
    [_webView loadRequest:[NSURLRequest requestWithURL:url]];
    return;
  }

  [self blank];
}

/** Clears the page and the record of what's loaded, so the next source reloads. */
- (void)blank {
  _loadedHtml.clear();
  _loadedUri.clear();
  [_webView loadHTMLString:@"" baseURL:nil];
}

#pragma mark - WKNavigationDelegate

- (void)webView:(WKWebView *)webView
    didFailNavigation:(WKNavigation *)navigation
            withError:(NSError *)error {
  [self emitError:error.localizedDescription];
}

- (void)webView:(WKWebView *)webView
    didFailProvisionalNavigation:(WKNavigation *)navigation
                       withError:(NSError *)error {
  [self emitError:error.localizedDescription];
}

- (void)webViewWebContentProcessDidTerminate:(WKWebView *)webView {
  [self emitError:@"The web content process terminated"];
}

- (void)emitError:(NSString *)message {
  if (!_eventEmitter) {
    return;
  }
  std::static_pointer_cast<const BesouroWebViewEventEmitter>(_eventEmitter)
      ->onError({.message = RCTStringFromNSString(message ?: @"")});
}

@end

#endif
