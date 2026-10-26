import Capacitor

// App-local plugins are not discovered from npm's packageClassList by Capacitor 7.
// Register them on the actual storyboard bridge, after Capacitor initializes it.
final class OpenGymBridgeViewController: CAPBridgeViewController {
    override func capacitorDidLoad() {
        bridge?.registerPluginInstance(HealthKitPlugin())
        bridge?.registerPluginInstance(PrintPlugin())
    }
}
