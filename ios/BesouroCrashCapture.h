#import <Foundation/Foundation.h>

/// Records a native crash into the spool file the next launch reads back into the
/// Console tab. See BesouroCrashCapture.mm for the mechanics — most of the
/// design lives in what a signal handler is allowed to do.
@interface BesouroCrashCapture : NSObject

/// Install the handlers (once per process) and record which session is live.
///
/// Called on every session start rather than at module load, so an app that never
/// initializes the library keeps its handler chain untouched, and a crash before
/// the library is up can't produce a record with no session to attach it to.
/// Later calls only update the session id.
+ (void)installWithSessionId:(NSString *)sessionId;

@end
