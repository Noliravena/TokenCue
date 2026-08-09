import AppKit
import TokenCueCore
import KeyboardShortcuts
import Observation
import QuartzCore
import SwiftUI

enum TokenCueLaunchMode: Equatable {
    case application
    case hookEvent

    static func resolve(arguments: [String]) -> Self {
        // Other TokenCue installations can leave this app path registered in ~/.codex/hooks.json.
        // Treat those invocations as a no-op before AppKit creates a second set of status items.
        arguments.dropFirst().contains("--hook-event") ? .hookEvent : .application
    }
}

@main
enum TokenCueEntryPoint {
    @MainActor
    static func main() {
        guard TokenCueLaunchMode.resolve(arguments: CommandLine.arguments) == .application else {
            return
        }
        TokenCueApp.main()
    }
}

struct TokenCueApp: App {
    @NSApplicationDelegateAdaptor(AppDelegate.self) private var appDelegate
    @State private var settings: SettingsStore
    @State private var store: UsageStore
    @State private var managedCodexAccountCoordinator: ManagedCodexAccountCoordinator
    @State private var codexAccountPromotionCoordinator: CodexAccountPromotionCoordinator
    private let preferencesSelection: PreferencesSelection
    private let account: AccountInfo

    init() {
        let env = ProcessInfo.processInfo.environment
        let storedLevel = TokenCueLog.parseLevel(UserDefaults.standard.string(forKey: "debugLogLevel")) ?? .verbose
        let level = TokenCueLog.parseLevel(env["TOKENCUE_LOG_LEVEL"]) ?? storedLevel
        TokenCueLog.bootstrapIfNeeded(.init(
            destination: .oslog(subsystem: "com.tokencue.desktop"),
            level: level,
            json: false))

        let version = Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "unknown"
        let build = Bundle.main.object(forInfoDictionaryKey: "CFBundleVersion") as? String ?? "unknown"
        let gitCommit = Bundle.main.object(forInfoDictionaryKey: "CodexGitCommit") as? String ?? "unknown"
        let buildTimestamp = Bundle.main.object(forInfoDictionaryKey: "CodexBuildTimestamp") as? String ?? "unknown"
        TokenCueLog.logger(LogCategories.app).info(
            "TokenCue starting",
            metadata: [
                "version": version,
                "build": build,
                "git": gitCommit,
                "built": buildTimestamp,
            ])

        KeychainAccessGate.isDisabled = UserDefaults.standard.bool(forKey: "debugDisableKeychainAccess")
        KeychainPromptCoordinator.install()
        if MainThreadHangWatchdog.isEnabledForCurrentProcess {
            MainThreadHangWatchdog.shared.start()
        }

        let preferencesSelection = PreferencesSelection()
        let settings = SettingsStore()
        Self.applyLanguagePreference(from: settings)
        configureUsageFormatterLocalizationProvider()
        let managedCodexAccountCoordinator = ManagedCodexAccountCoordinator()
        managedCodexAccountCoordinator.onManagedAccountsDidChange = {
            _ = settings.refreshCodexAccountReconciliationAfterManagedAccountsDidChange()
        }
        _ = settings.persistResolvedCodexActiveSourceCorrectionIfNeeded()
        let fetcher = UsageFetcher()
        let browserDetection = BrowserDetection(cacheTTL: BrowserDetection.defaultCacheTTL)
        let account = fetcher.loadAccountInfo()
        let store = UsageStore(fetcher: fetcher, browserDetection: browserDetection, settings: settings)
        let codexAccountPromotionCoordinator = CodexAccountPromotionCoordinator(
            settingsStore: settings,
            usageStore: store,
            managedAccountCoordinator: managedCodexAccountCoordinator)
        self.preferencesSelection = preferencesSelection
        _settings = State(wrappedValue: settings)
        _store = State(wrappedValue: store)
        _managedCodexAccountCoordinator = State(wrappedValue: managedCodexAccountCoordinator)
        _codexAccountPromotionCoordinator = State(wrappedValue: codexAccountPromotionCoordinator)
        self.account = account
        TokenCueLog.setLogLevel(settings.debugLogLevel)
        self.appDelegate.configure(.init(
            store: store,
            settings: settings,
            account: account,
            selection: preferencesSelection,
            managedCodexAccountCoordinator: managedCodexAccountCoordinator,
            codexAccountPromotionCoordinator: codexAccountPromotionCoordinator))
    }

    @SceneBuilder
    var body: some Scene {
        // Hidden 1×1 window to keep SwiftUI's lifecycle alive so `Settings` scene
        // shows the native toolbar tabs even though the UI is AppKit-based.
        WindowGroup("TokenCueLifecycleKeepalive") {
            HiddenWindowView()
        }
        .defaultSize(width: 20, height: 20)
        .windowStyle(.hiddenTitleBar)

        Settings {
            PreferencesView(
                settings: self.settings,
                store: self.store,
                cloudSyncState: self.appDelegate.cloudSyncState,
                updater: self.appDelegate.updaterController,
                selection: self.preferencesSelection,
                managedCodexAccountCoordinator: self.managedCodexAccountCoordinator,
                codexAccountPromotionCoordinator: self.codexAccountPromotionCoordinator,
                runProviderLoginFlow: { provider in
                    await self.appDelegate.runProviderLoginFlow(provider)
                })
        }
        .defaultSize(width: SettingsPane.windowWidth, height: SettingsPane.windowHeight)
        .windowResizability(.contentMinSize)
    }

    private func openSettings(pane: SettingsPane) {
        self.preferencesSelection.pane = pane
        NSApp.activate(ignoringOtherApps: true)
        let outcome = SettingsWindowOpener.live().open(preferred: .appKit)
        let logger = TokenCueLog.logger(LogCategories.app)
        switch outcome {
        case .preferred:
            break
        case .fallback:
            logger.warning("Settings AppKit action was not handled; used notification fallback")
        case .failed:
            logger.error("Failed to open Settings; AppKit action and notification fallback unavailable")
        }
    }

    private static func applyLanguagePreference(from settings: SettingsStore) {
        AppLanguagePreferenceMigration.clearLegacyOverrideIfOwned(storedAppLanguage: settings.appLanguage)
        resetTokenCueLocalizationCache()
    }
}

// MARK: - Updater abstraction

@MainActor
protocol UpdaterProviding: AnyObject {
    var automaticallyChecksForUpdates: Bool { get set }
    var automaticallyDownloadsUpdates: Bool { get set }
    var isAvailable: Bool { get }
    var unavailableReason: String? { get }
    var updateStatus: UpdateStatus { get }
    func checkForUpdates(_ sender: Any?)
    func installUpdate()
}

/// No-op updater used by the source-only TokenCue build.
final class DisabledUpdaterController: UpdaterProviding {
    var automaticallyChecksForUpdates: Bool = false
    var automaticallyDownloadsUpdates: Bool = false
    let isAvailable: Bool = false
    let unavailableReason: String?
    let updateStatus = UpdateStatus()

    init(unavailableReason: String? = nil) {
        self.unavailableReason = unavailableReason
    }

    func checkForUpdates(_ sender: Any?) {}
    func installUpdate() {}
}

@MainActor
@Observable
final class UpdateStatus {
    static let disabled = UpdateStatus()
    var isUpdateReady: Bool

    init(isUpdateReady: Bool = false) {
        self.isUpdateReady = isUpdateReady
    }
}

private func makeUpdaterController() -> UpdaterProviding {
    DisabledUpdaterController(unavailableReason: "Automatic updates are outside this source-only build.")
}

@MainActor
final class AppDelegate: NSObject, NSApplicationDelegate {
    struct Dependencies {
        let store: UsageStore
        let settings: SettingsStore
        let account: AccountInfo
        let selection: PreferencesSelection
        let managedCodexAccountCoordinator: ManagedCodexAccountCoordinator
        let codexAccountPromotionCoordinator: CodexAccountPromotionCoordinator
    }

    let updaterController: UpdaterProviding = makeUpdaterController()
    let cloudSyncState = CloudSyncState()
    private let confettiOverlayController = ScreenConfettiOverlayController()
    private let confettiLogger = TokenCueLog.logger(LogCategories.confetti)
    private lazy var memoryPressureMonitor = MemoryPressureMonitor(trimAppCaches: { [weak self] in
        self?.trimRebuildableCachesForMemoryPressure() ?? MemoryPressureCacheTrimSummary()
    })

    private var statusController: StatusItemControlling?
    private var store: UsageStore?
    private var settings: SettingsStore?
    private var account: AccountInfo?
    private var preferencesSelection: PreferencesSelection?
    private var managedCodexAccountCoordinator: ManagedCodexAccountCoordinator?
    private var codexAccountPromotionCoordinator: CodexAccountPromotionCoordinator?
    private var hasInstalledLimitResetObservers = false
    #if DEBUG
    private var debugMemoryPressureObserver: NSObjectProtocol?
    #endif
    var terminateActiveProcessesForAppShutdown: () -> Void = {
        TTYCommandRunner.terminateActiveProcessesForAppShutdown()
    }

    func configure(_ dependencies: Dependencies) {
        self.store = dependencies.store
        self.settings = dependencies.settings
        self.account = dependencies.account
        self.preferencesSelection = dependencies.selection
        self.managedCodexAccountCoordinator = dependencies.managedCodexAccountCoordinator
        self.codexAccountPromotionCoordinator = dependencies.codexAccountPromotionCoordinator
    }

    func applicationWillFinishLaunching(_ notification: Notification) {
        self.configureTokenCueAppIcon()
    }

    func applicationDidFinishLaunching(_ notification: Notification) {
        self.memoryPressureMonitor.start()
        #if DEBUG
        self.installDebugMemoryPressureObserverIfNeeded()
        #endif
        self.ensureStatusController()
        Task { @MainActor [weak self] in
            await Task.yield()
            guard let settings = self?.settings else { return }
            AdaptiveActivityConsentPresenter.presentIfNeeded(settings: settings)
            AppNotifications.shared.requestAuthorizationOnStartup()
        }
        KeyboardShortcuts.onKeyUp(for: .openMenu) { [weak self] in
            // KeyboardShortcuts dispatches both normal and menu-tracking hotkeys on the main event loop.
            MainActor.assumeIsolated {
                self?.statusController?.openMenuFromShortcut()
            }
        }
        if !self.hasInstalledLimitResetObservers {
            NotificationCenter.default.addObserver(
                self,
                selector: #selector(self.handleSessionLimitResetNotification(_:)),
                name: .tokencueSessionLimitReset,
                object: nil)
            NotificationCenter.default.addObserver(
                self,
                selector: #selector(self.handleWeeklyLimitResetNotification(_:)),
                name: .tokencueWeeklyLimitReset,
                object: nil)
            self.hasInstalledLimitResetObservers = true
        }
    }

    func applicationWillTerminate(_ notification: Notification) {
        self.memoryPressureMonitor.stop()
        #if DEBUG
        self.removeDebugMemoryPressureObserver()
        #endif
        self.statusController?.prepareForAppShutdown()
        self.confettiOverlayController.dismiss()
        self.dismissAppKitWindowsForShutdown()
        self.terminateActiveProcessesForAppShutdown()
    }

    func runProviderLoginFlow(_ provider: UsageProvider) async {
        self.ensureStatusController()
        guard let statusController else { return }
        await statusController.runLoginFlowFromSettings(provider: provider)
    }

    @objc private func handleSessionLimitResetNotification(_ notification: Notification) {
        guard let event = notification.object as? SessionLimitResetEvent else { return }
        guard self.settings?.confettiOnSessionLimitResetsEnabled == true else { return }
        self.playLimitResetConfetti(
            provider: event.provider,
            accountIdentifier: event.accountIdentifier,
            resetKind: "session")
    }

    @objc private func handleWeeklyLimitResetNotification(_ notification: Notification) {
        guard let event = notification.object as? WeeklyLimitResetEvent else { return }
        guard self.settings?.confettiOnWeeklyLimitResetsEnabled == true else { return }
        self.playLimitResetConfetti(
            provider: event.provider,
            accountIdentifier: event.accountIdentifier,
            resetKind: "weekly")
    }

    private func playLimitResetConfetti(
        provider: UsageProvider,
        accountIdentifier: String,
        resetKind: String)
    {
        let origin = self.statusController?.celebrationOriginPoint(for: provider)
        let palette = ProviderDescriptorRegistry.descriptor(for: provider).branding.confettiPalette
        self.confettiLogger.info(
            "Triggering confetti",
            metadata: [
                "provider": provider.rawValue,
                "accountIdentifier": accountIdentifier,
                "resetKind": resetKind,
                "originKnown": origin == nil ? "0" : "1",
            ])
        self.confettiOverlayController.play(originInScreen: origin, colors: palette)
    }

    private func configureTokenCueAppIcon() {
        guard let icon = Self.loadTokenCueIcon() else { return }
        NSApp.applicationIconImage = icon
    }

    private static func loadTokenCueIcon() -> NSImage? {
        guard let url = Bundle.module.url(forResource: "TokenCueIcon", withExtension: "png"),
              let image = NSImage(contentsOf: url)
        else {
            return nil
        }
        return image
    }

    private func dismissAppKitWindowsForShutdown() {
        guard let app = NSApp else { return }
        for window in app.windows {
            window.orderOut(nil)
        }
    }

    private func ensureStatusController() {
        if self.statusController != nil {
            return
        }

        if let store,
           let settings,
           let account,
           let selection = self.preferencesSelection,
           let managedCodexAccountCoordinator,
           let codexAccountPromotionCoordinator
        {
            self.statusController = StatusItemController.factory(
                store,
                settings,
                account,
                self.updaterController,
                selection,
                managedCodexAccountCoordinator,
                codexAccountPromotionCoordinator)
            if let statusController = self.statusController as? StatusItemController {
                MenuSwitchFlickerProbe.startIfRequested(controller: statusController)
            }
            return
        }

        // Defensive fallback: this should not be hit in normal app lifecycle.
        TokenCueLog.logger(LogCategories.app)
            .error("StatusItemController fallback path used; settings/store mismatch likely.")
        assertionFailure("StatusItemController fallback path used; check app lifecycle wiring.")
        let fallbackSettings = SettingsStore()
        let fetcher = UsageFetcher()
        let browserDetection = BrowserDetection(cacheTTL: BrowserDetection.defaultCacheTTL)
        let fallbackAccount = fetcher.loadAccountInfo()
        let fallbackStore = UsageStore(fetcher: fetcher, browserDetection: browserDetection, settings: fallbackSettings)
        let fallbackManagedCodexAccountCoordinator = ManagedCodexAccountCoordinator()
        let fallbackCodexAccountPromotionCoordinator = CodexAccountPromotionCoordinator(
            settingsStore: fallbackSettings,
            usageStore: fallbackStore,
            managedAccountCoordinator: fallbackManagedCodexAccountCoordinator)
        self.statusController = StatusItemController.factory(
            fallbackStore,
            fallbackSettings,
            fallbackAccount,
            self.updaterController,
            PreferencesSelection(),
            fallbackManagedCodexAccountCoordinator,
            fallbackCodexAccountPromotionCoordinator)
    }

    private func trimRebuildableCachesForMemoryPressure() -> MemoryPressureCacheTrimSummary {
        var summary = MemoryPressureCacheTrimSummary()
        let statusSummary = self.statusController?.trimRebuildableCachesForMemoryPressure()
            ?? MemoryPressureCacheTrimSummary()
        let storeSummary = self.store?.trimRebuildableCachesForMemoryPressure()
            ?? MemoryPressureCacheTrimSummary()
        summary.merge(statusSummary)
        summary.merge(storeSummary)
        return summary
    }

    #if DEBUG
    private func installDebugMemoryPressureObserverIfNeeded() {
        guard self.debugMemoryPressureObserver == nil else { return }
        self.debugMemoryPressureObserver = DistributedNotificationCenter.default().addObserver(
            forName: .tokencueDebugSimulateMemoryPressure,
            object: nil,
            queue: .main)
        { [weak self] notification in
            let rawLevel = notification.userInfo?["level"] as? String
            let shouldSeedCaches = notification.userInfo?["seedCaches"] as? String == "1"
            MainActor.assumeIsolated {
                self?.handleDebugMemoryPressureNotification(
                    rawLevel: rawLevel,
                    shouldSeedCaches: shouldSeedCaches)
            }
        }
    }

    private func removeDebugMemoryPressureObserver() {
        guard let observer = self.debugMemoryPressureObserver else { return }
        DistributedNotificationCenter.default().removeObserver(observer)
        self.debugMemoryPressureObserver = nil
    }

    private func handleDebugMemoryPressureNotification(rawLevel: String?, shouldSeedCaches: Bool) {
        let isCritical = rawLevel?.caseInsensitiveCompare("critical") == .orderedSame
        if shouldSeedCaches {
            OpenAIDashboardFetcher.seedCachedWebViewsForMemoryPressureProof()
            self.statusController?.seedRebuildableCachesForMemoryPressureProof()
            self.store?.seedRebuildableCachesForMemoryPressureProof()
        }
        TokenCueLog.logger(LogCategories.memoryPressure).info(
            "Debug memory pressure notification received",
            metadata: [
                "level": isCritical ? "critical" : "warning",
                "seedCaches": shouldSeedCaches ? "1" : "0",
            ])
        self.memoryPressureMonitor.handleMemoryPressureForTesting(isWarning: !isCritical, isCritical: isCritical)
    }
    #endif

    deinit {
        NotificationCenter.default.removeObserver(self)
    }
}
