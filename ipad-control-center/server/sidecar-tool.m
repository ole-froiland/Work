// Kobler en iPad til/fra som Sidecar-skjerm uten Kontrollsenter-klikking.
// Bygges automatisk av mac-action-service.mjs:
//   clang -fobjc-arc -framework Foundation -o .cache/sidecar-tool sidecar-tool.m
// Bruk: sidecar-tool list | connect <navn> | disconnect <navn> | toggle <navn>

#import <Foundation/Foundation.h>
#import <dlfcn.h>
#import <objc/runtime.h>
#import <objc/message.h>

static id sharedManager(void) {
  Class managerClass = objc_getClass("SidecarDisplayManager");
  if (!managerClass) return nil;
  return ((id (*)(id, SEL))objc_msgSend)(managerClass, sel_registerName("sharedManager"));
}

static NSArray *deviceList(id manager, SEL selector) {
  return ((NSArray *(*)(id, SEL))objc_msgSend)(manager, selector);
}

static NSString *deviceName(id device) {
  return ((NSString *(*)(id, SEL))objc_msgSend)(device, sel_registerName("name"));
}

static BOOL matchesName(id device, NSString *wanted) {
  NSString *name = deviceName(device);
  if (!name) return NO;
  return [name localizedCaseInsensitiveContainsString:wanted];
}

static id findDevice(NSArray *devices, NSString *wanted) {
  for (id device in devices) if (matchesName(device, wanted)) return device;
  return nil;
}

// Kjører en connect/disconnect og venter på completion-blokken.
static int runWithCompletion(id manager, SEL selector, id device, NSString *verb) {
  __block BOOL finished = NO;
  __block NSError *failure = nil;
  void (^completion)(NSError *) = ^(NSError *error) {
    failure = error;
    finished = YES;
  };
  ((void (*)(id, SEL, id, id))objc_msgSend)(manager, selector, device, completion);

  NSDate *deadline = [NSDate dateWithTimeIntervalSinceNow:30];
  while (!finished && [deadline timeIntervalSinceNow] > 0) {
    [[NSRunLoop currentRunLoop] runMode:NSDefaultRunLoopMode beforeDate:[NSDate dateWithTimeIntervalSinceNow:0.1]];
  }
  if (!finished) {
    fprintf(stderr, "Tidsavbrudd under %s\n", verb.UTF8String);
    return 3;
  }
  if (failure) {
    fprintf(stderr, "%s\n", failure.localizedDescription.UTF8String);
    return 4;
  }
  printf("{\"device\":\"%s\",\"state\":\"%s\"}\n", deviceName(device).UTF8String, verb.UTF8String);
  return 0;
}

int main(int argc, const char *argv[]) {
  @autoreleasepool {
    if (!dlopen("/System/Library/PrivateFrameworks/SidecarCore.framework/SidecarCore", RTLD_NOW)) {
      fprintf(stderr, "Fant ikke SidecarCore på denne Mac-en\n");
      return 2;
    }
    id manager = sharedManager();
    if (!manager) {
      fprintf(stderr, "Sidecar er ikke tilgjengelig på denne Mac-en\n");
      return 2;
    }

    NSString *command = argc > 1 ? @(argv[1]) : @"list";
    NSString *wanted = argc > 2 ? @(argv[2]) : @"iPad";

    NSArray *devices = deviceList(manager, sel_registerName("devices"));
    NSArray *connected = deviceList(manager, sel_registerName("connectedDevices"));

    if ([command isEqualToString:@"list"]) {
      NSMutableArray *rows = [NSMutableArray array];
      for (id device in devices) {
        [rows addObject:@{ @"name": deviceName(device) ?: @"", @"connected": @([connected containsObject:device]) }];
      }
      NSData *json = [NSJSONSerialization dataWithJSONObject:rows options:0 error:nil];
      fwrite(json.bytes, 1, json.length, stdout);
      printf("\n");
      return 0;
    }

    id connectedMatch = findDevice(connected, wanted);
    if ([command isEqualToString:@"disconnect"]) {
      if (!connectedMatch) {
        fprintf(stderr, "«%s» er ikke tilkoblet\n", wanted.UTF8String);
        return 5;
      }
      return runWithCompletion(manager, sel_registerName("disconnectFromDevice:completion:"), connectedMatch, @"disconnected");
    }
    if ([command isEqualToString:@"toggle"] && connectedMatch) {
      return runWithCompletion(manager, sel_registerName("disconnectFromDevice:completion:"), connectedMatch, @"disconnected");
    }
    if ([command isEqualToString:@"connect"] || [command isEqualToString:@"toggle"]) {
      id device = findDevice(devices, wanted);
      if (!device) {
        fprintf(stderr, "Fant ingen Sidecar-enhet som heter «%s». Sjekk at iPad-en er på, låst opp og på samme Apple-konto.\n", wanted.UTF8String);
        return 5;
      }
      return runWithCompletion(manager, sel_registerName("connectToDevice:completion:"), device, @"connected");
    }

    fprintf(stderr, "Ukjent kommando: %s\n", command.UTF8String);
    return 1;
  }
}
