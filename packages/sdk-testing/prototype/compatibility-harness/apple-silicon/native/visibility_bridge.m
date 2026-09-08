#import <AppKit/AppKit.h>
#import <Foundation/Foundation.h>

static NSString *EvidencePath(void) {
    const char *directory = getenv("SDK_BRIDGE_DIR");
    if (directory == NULL) {
        return nil;
    }
    return [[NSString stringWithUTF8String:directory]
        stringByAppendingPathComponent:@"visibility-bridge.jsonl"];
}

static void AppendEvidence(NSDictionary *value) {
    NSString *path = EvidencePath();
    if (path == nil) {
        return;
    }
    NSError *error = nil;
    NSData *json = [NSJSONSerialization dataWithJSONObject:value options:0 error:&error];
    if (json == nil || error != nil) {
        return;
    }
    NSMutableData *line = [json mutableCopy];
    [line appendData:[@"\n" dataUsingEncoding:NSUTF8StringEncoding]];
    if (![[NSFileManager defaultManager] fileExistsAtPath:path]) {
        [line writeToFile:path atomically:YES];
        return;
    }
    NSFileHandle *handle = [NSFileHandle fileHandleForWritingAtPath:path];
    [handle seekToEndOfFile];
    [handle writeData:line];
    [handle closeFile];
}

static void EnforceBackground(void) {
    @autoreleasepool {
        NSApplication *application = [NSApplication sharedApplication];
        BOOL policyChanged = NO;
        if (application.activationPolicy != NSApplicationActivationPolicyAccessory) {
            policyChanged = [application setActivationPolicy:NSApplicationActivationPolicyAccessory];
        }
        BOOL wasHidden = application.hidden;
        BOOL wasActive = application.active;
        if (!wasHidden || wasActive) {
            [application hide:nil];
        }

        NSMutableArray *orderedOut = [NSMutableArray array];
        for (NSWindow *window in application.windows) {
            if (!window.visible) {
                continue;
            }
            NSRect frame = window.frame;
            [orderedOut addObject:@{
                @"number": @(window.windowNumber),
                @"frame": @{
                    @"x": @(frame.origin.x),
                    @"y": @(frame.origin.y),
                    @"width": @(frame.size.width),
                    @"height": @(frame.size.height),
                },
            }];
            [window orderOut:nil];
        }

        if (policyChanged || !wasHidden || wasActive || orderedOut.count > 0) {
            AppendEvidence(@{
                @"time": @([[NSDate date] timeIntervalSince1970]),
                @"pid": @([[NSProcessInfo processInfo] processIdentifier]),
                @"policyChanged": @(policyChanged),
                @"wasHidden": @(wasHidden),
                @"wasActive": @(wasActive),
                @"hiddenAfter": @(application.hidden),
                @"activeAfter": @(application.active),
                @"orderedOut": orderedOut,
                @"emitsKeyboardInput": @NO,
                @"emitsPointerInput": @NO,
                @"activatesApplication": @NO,
            });
        }
    }
}

__attribute__((constructor)) static void InitializeVisibilityBridge(void) {
    AppendEvidence(@{
        @"time": @([[NSDate date] timeIntervalSince1970]),
        @"pid": @([[NSProcessInfo processInfo] processIdentifier]),
        @"phase": @"loaded",
    });
    dispatch_async(dispatch_get_main_queue(), ^{
        static dispatch_source_t timer;
        timer = dispatch_source_create(DISPATCH_SOURCE_TYPE_TIMER, 0, 0, dispatch_get_main_queue());
        dispatch_source_set_timer(
            timer,
            dispatch_time(DISPATCH_TIME_NOW, 0),
            10 * NSEC_PER_MSEC,
            1 * NSEC_PER_MSEC
        );
        dispatch_source_set_event_handler(timer, ^{
            EnforceBackground();
        });
        dispatch_resume(timer);
    });
}
