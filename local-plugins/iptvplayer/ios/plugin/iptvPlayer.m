#import <Capacitor/Capacitor.h>

// Registers the new class name "Iptvplayer"
CAP_PLUGIN(Iptvplayer, "Iptvplayer",
    CAP_PLUGIN_METHOD(play, CAPPluginReturnPromise);
)