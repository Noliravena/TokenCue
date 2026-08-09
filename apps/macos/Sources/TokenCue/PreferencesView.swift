import AppKit
import TokenCueCore
import SwiftUI

/// Destinations of the settings window: top-level app tabs plus one entry per provider.
enum SettingsPane: Hashable {
    case general
    case providers
    case usageSpend
    case notifications
    case menuBar
    case menu
    case advanced
    case hooks
    case plugins
    case about
    case debug
    case provider(ProviderInstanceID)

    static let windowWidth: CGFloat = TokenCueDesignTokens.settingsWidth
    static let windowHeight: CGFloat = TokenCueDesignTokens.settingsHeight
    static let windowMinWidth: CGFloat = 800
    static let windowMinHeight: CGFloat = 540
    static let providersListWidth: CGFloat = 240
    /// Historical sidebar geometry (pre top-tab IA); retained for tests/migrations.
    static let sidebarWidth: CGFloat = 260
    static let sidebarMinWidth: CGFloat = 200
    static let sidebarMaxWidth: CGFloat = 380
    static let sidebarWidthDefaultsKey = "settingsSidebarWidth"
    static let detailMaxWidth: CGFloat = 780

    /// Top icon tabs (Windows warm handoff). Provider detail stays under Providers.
    static func topTabs(debugEnabled: Bool) -> [SettingsPane] {
        var tabs: [SettingsPane] = [
            .general,
            .providers,
            .notifications,
            .menuBar,
            .menu,
            .usageSpend,
            .advanced,
            .hooks,
            .plugins,
            .about,
        ]
        if debugEnabled {
            tabs.append(.debug)
        }
        return tabs
    }

    var title: String {
        switch self {
        case .general: L("tab_general")
        case .providers: L("tab_providers")
        case .usageSpend: L("tab_usage_spend")
        case .notifications: L("tab_notifications")
        case .menuBar: L("tab_menu_bar")
        case .menu: L("tab_menu")
        case .advanced: L("tab_advanced")
        case .hooks: L("tab_hooks")
        case .plugins: L("Plugins")
        case .about: L("tab_about")
        case .debug: L("tab_debug")
        case let .provider(instanceID):
            instanceID.firstPartyProvider
                .map { ProviderDescriptorRegistry.descriptor(for: $0).metadata.displayName }
                ?? instanceID.rawValue
        }
    }

    var topTabSystemImage: String {
        switch self {
        case .general: "gearshape"
        case .providers, .provider: "circle.grid.2x2"
        case .notifications: "bell"
        case .menuBar: "menubar.rectangle"
        case .menu: "square.grid.2x2"
        case .usageSpend: "chart.bar"
        case .advanced: "slider.horizontal.3"
        case .hooks: "bolt.horizontal.circle"
        case .plugins: "puzzlepiece.extension"
        case .about: "info.circle"
        case .debug: "ladybug"
        }
    }

    /// Which top tab is active for the current destination.
    var topTab: SettingsPane {
        switch self {
        case .provider: .providers
        default: self
        }
    }
}

@MainActor
struct PreferencesView: View {
    @Bindable var settings: SettingsStore
    @Bindable var store: UsageStore
    @Bindable var cloudSyncState: CloudSyncState
    let updater: UpdaterProviding
    @Bindable var selection: PreferencesSelection
    let managedCodexAccountCoordinator: ManagedCodexAccountCoordinator
    let codexAccountPromotionCoordinator: CodexAccountPromotionCoordinator
    let runProviderLoginFlow: @MainActor (UsageProvider) async -> Void
    @Environment(\.colorScheme) private var colorScheme

    init(
        settings: SettingsStore,
        store: UsageStore,
        cloudSyncState: CloudSyncState = CloudSyncState(),
        updater: UpdaterProviding,
        selection: PreferencesSelection,
        managedCodexAccountCoordinator: ManagedCodexAccountCoordinator = ManagedCodexAccountCoordinator(),
        codexAccountPromotionCoordinator: CodexAccountPromotionCoordinator? = nil,
        runProviderLoginFlow: @escaping @MainActor (UsageProvider) async -> Void = { _ in })
    {
        self.settings = settings
        self.store = store
        self.cloudSyncState = cloudSyncState
        self.updater = updater
        self.selection = selection
        self.managedCodexAccountCoordinator = managedCodexAccountCoordinator
        self.codexAccountPromotionCoordinator = codexAccountPromotionCoordinator
            ?? CodexAccountPromotionCoordinator(
                settingsStore: settings,
                usageStore: store,
                managedAccountCoordinator: managedCodexAccountCoordinator)
        self.runProviderLoginFlow = runProviderLoginFlow
    }

    private var warmSurface: Color {
        self.colorScheme == .dark ? TokenCueDesignTokens.darkSurface : TokenCueDesignTokens.lightSurface
    }

    private var warmCanvas: Color {
        self.colorScheme == .dark ? TokenCueDesignTokens.darkCanvas : TokenCueDesignTokens.lightCanvas
    }

    var body: some View {
        VStack(spacing: 0) {
            SettingsTopTabBar(
                tabs: SettingsPane.topTabs(debugEnabled: self.settings.debugMenuEnabled),
                selected: self.selection.pane.topTab,
                onSelect: { tab in self.selectTopTab(tab) })
                .padding(.horizontal, 12)
                .padding(.top, 10)
                .padding(.bottom, 8)
                .background(self.warmSurface)

            Group {
                if self.selection.pane.topTab == .providers {
                    self.providersSplit
                } else {
                    self.detailView
                        .frame(
                            maxWidth: SettingsPane.detailMaxWidth,
                            maxHeight: .infinity,
                            alignment: .topLeading)
                        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
                }
            }
            .background(self.warmSurface)
        }
        .frame(
            minWidth: SettingsPane.windowMinWidth,
            idealWidth: SettingsPane.windowWidth,
            maxWidth: .infinity,
            minHeight: SettingsPane.windowMinHeight,
            idealHeight: SettingsPane.windowHeight,
            maxHeight: .infinity)
        .background(self.warmSurface)
        .tint(TokenCueDesignTokens.accent)
        .id(self.settings.appLanguage)
        .background {
            SettingsWindowAppearanceBridge(
                colorScheme: self.colorScheme,
                windowTitle: self.selection.pane.topTab == .providers
                    ? L("tab_providers")
                    : self.selection.pane.title)
                .allowsHitTesting(false)
        }
        .onAppear {
            self.ensureValidSelection()
        }
        .onChange(of: self.settings.debugMenuEnabled) { _, _ in
            self.ensureValidSelection()
        }
        .onChange(of: self.settings.shouldRequestAdaptiveActivityScanConsent) { _, shouldRequest in
            guard shouldRequest else { return }
            AdaptiveActivityConsentPresenter.presentIfNeeded(settings: self.settings)
        }
    }

    private var providersSplit: some View {
        HStack(spacing: 0) {
            SettingsProvidersListView(
                settings: self.settings,
                store: self.store,
                selection: self.$selection.pane)
                .frame(width: SettingsPane.providersListWidth)
                .background(self.warmCanvas)

            Rectangle()
                .fill(Color.primary.opacity(0.08))
                .frame(width: 1)

            self.providersDetail
                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
                .background(self.warmSurface)
        }
    }

    @ViewBuilder
    private var providersDetail: some View {
        switch self.selection.pane {
        case let .provider(instanceID):
            if let provider = instanceID.firstPartyProvider {
                ProvidersPane(
                    provider: provider,
                    settings: self.settings,
                    store: self.store,
                    managedCodexAccountCoordinator: self.managedCodexAccountCoordinator,
                    codexAccountPromotionCoordinator: self.codexAccountPromotionCoordinator,
                    runProviderLoginFlow: self.runProviderLoginFlow)
                    .id(instanceID)
            } else {
                ContentUnavailableView(
                    L("tab_providers"),
                    systemImage: "circle.grid.2x2",
                    description: Text(L("No matching providers")))
            }
        default:
            ContentUnavailableView(
                L("tab_providers"),
                systemImage: "circle.grid.2x2",
                description: Text(L("No matching providers")))
        }
    }

    @ViewBuilder
    private var detailView: some View {
        switch self.selection.pane {
        case .general:
            GeneralPane(settings: self.settings)
        case .providers:
            // Hub only — providersSplit hosts the list; keep empty here.
            EmptyView()
        case .usageSpend:
            SpendDashboardPane(settings: self.settings, store: self.store)
        case .notifications:
            NotificationsPane(settings: self.settings)
        case .menuBar:
            MenuBarPane(settings: self.settings, store: self.store)
        case .menu:
            MenuPane(settings: self.settings, store: self.store)
        case .advanced:
            AdvancedPane(settings: self.settings, store: self.store)
        case .hooks:
            HooksPane(settings: self.settings)
        case .plugins:
            PluginsPane(settings: self.settings, store: self.store)
        case .about:
            AboutPane(updater: self.updater)
        case .debug:
            DebugPane(settings: self.settings, store: self.store)
        case .provider:
            EmptyView()
        }
    }

    private func selectTopTab(_ tab: SettingsPane) {
        if tab == .providers {
            if case .provider = self.selection.pane {
                return
            }
            if let first = self.settings.orderedProviders().compactMap(\.firstPartyProvider).first {
                self.selection.pane = .provider(first.instanceID)
            } else {
                self.selection.pane = .providers
            }
            return
        }
        self.selection.pane = tab
    }

    private func ensureValidSelection() {
        if !self.settings.debugMenuEnabled, self.selection.pane == .debug {
            self.selection.pane = .general
        }
        if self.selection.pane == .providers {
            if let first = self.settings.orderedProviders().compactMap(\.firstPartyProvider).first {
                self.selection.pane = .provider(first.instanceID)
            }
        }
    }
}

// MARK: - Top tab bar

@MainActor
private struct SettingsTopTabBar: View {
    let tabs: [SettingsPane]
    let selected: SettingsPane
    let onSelect: (SettingsPane) -> Void
    @Environment(\.colorScheme) private var colorScheme

    var body: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 4) {
                ForEach(self.tabs, id: \.self) { tab in
                    Button {
                        self.onSelect(tab)
                    } label: {
                        VStack(spacing: 5) {
                            Image(systemName: tab.topTabSystemImage)
                                .font(.system(size: 14, weight: .medium))
                            Text(tab.title)
                                .font(.system(size: 11, weight: self.selected == tab ? .semibold : .medium))
                                .lineLimit(1)
                        }
                        .foregroundStyle(self.selected == tab ? self.primaryText : self.secondaryText)
                        .padding(.horizontal, 12)
                        .padding(.vertical, 8)
                        .background(
                            RoundedRectangle(cornerRadius: 12, style: .continuous)
                                .fill(self.selected == tab ? self.activeBackground : Color.clear)
                                .overlay {
                                    RoundedRectangle(cornerRadius: 12, style: .continuous)
                                        .stroke(
                                            self.selected == tab ? Color.primary.opacity(0.10) : Color.clear,
                                            lineWidth: 1)
                                })
                    }
                    .buttonStyle(.plain)
                }
            }
            .frame(maxWidth: .infinity)
        }
    }

    private var activeBackground: Color {
        self.colorScheme == .dark ? Color(nsColor: NSColor(calibratedWhite: 0.16, alpha: 1)) : Color(hex: 0xF0E6CF)
    }

    private var primaryText: Color {
        self.colorScheme == .dark ? TokenCueDesignTokens.darkText : TokenCueDesignTokens.lightText
    }

    private var secondaryText: Color {
        self.colorScheme == .dark ? TokenCueDesignTokens.darkTextSecondary : TokenCueDesignTokens.lightTextSecondary
    }
}

private extension Color {
    init(hex: UInt32) {
        self.init(
            .sRGB,
            red: Double((hex >> 16) & 0xFF) / 255,
            green: Double((hex >> 8) & 0xFF) / 255,
            blue: Double(hex & 0xFF) / 255,
            opacity: 1)
    }
}

@MainActor
enum SettingsWindowSizing {
    static func enforceMinimumSize(_ window: NSWindow) {
        let toolbarHeight = max(0, window.frame.height - window.contentLayoutRect.height)
        let minimumSize = NSSize(
            width: SettingsPane.windowMinWidth,
            height: SettingsPane.windowMinHeight + toolbarHeight)
        window.minSize = minimumSize

        if window.frame.width < minimumSize.width || window.frame.height < minimumSize.height {
            var frame = window.frame
            let repairedSize = NSSize(
                width: max(frame.width, minimumSize.width),
                height: max(frame.height, minimumSize.height))
            frame.origin.y += frame.height - repairedSize.height
            frame.size = repairedSize
            window.setFrame(frame, display: true)
        }
    }
}

@MainActor
enum SettingsWindowAppearance {
    typealias ResetAction = @MainActor @Sendable () -> Void
    typealias ResetScheduler = @MainActor @Sendable (@escaping ResetAction) -> Void

    static func refresh(
        _ window: NSWindow,
        application: NSApplication = NSApp,
        scheduleReset: ResetScheduler = Self.scheduleReset)
    {
        SettingsWindowSizing.enforceMinimumSize(window)
        window.appearanceSource = application
        // Pulse the exact effective appearance so the native toolbar redraws without
        // dropping inherited accessibility attributes, then restore KVO inheritance.
        window.appearance = application.effectiveAppearance
        scheduleReset { [weak window] in
            if let window {
                SettingsWindowSizing.enforceMinimumSize(window)
            }
            window?.appearance = nil
            window?.viewsNeedDisplay = true
        }
    }

    static func scheduleReset(_ action: @escaping ResetAction) {
        Task { @MainActor in
            await Task.yield()
            action()
        }
    }
}

@MainActor
struct SettingsWindowAppearanceBridge: NSViewRepresentable {
    let colorScheme: ColorScheme
    let windowTitle: String

    func makeNSView(context: Context) -> SettingsWindowAppearanceView {
        SettingsWindowAppearanceView()
    }

    func updateNSView(_ nsView: SettingsWindowAppearanceView, context: Context) {
        nsView.refreshWindowAppearance(for: self.colorScheme, windowTitle: self.windowTitle)
    }
}

@MainActor
final class SettingsWindowAppearanceView: NSView {
    private let scheduleReset: SettingsWindowAppearance.ResetScheduler
    private var colorScheme: ColorScheme?
    private var windowTitle: String?

    init(scheduleReset: @escaping SettingsWindowAppearance.ResetScheduler = SettingsWindowAppearance.scheduleReset) {
        self.scheduleReset = scheduleReset
        super.init(frame: .zero)
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) {
        fatalError("init(coder:) has not been implemented")
    }

    deinit {
        NotificationCenter.default.removeObserver(self)
    }

    override func viewDidMoveToWindow() {
        super.viewDidMoveToWindow()
        NotificationCenter.default.removeObserver(self, name: NSWindow.didUpdateNotification, object: nil)
        if let window {
            NotificationCenter.default.addObserver(
                self,
                selector: #selector(self.windowDidUpdate(_:)),
                name: NSWindow.didUpdateNotification,
                object: window)
        }
        self.configureWindowStyle()
        self.refreshWindowAppearance()
    }

    @objc private func windowDidUpdate(_ notification: Notification) {
        self.configureWindowStyle()
    }

    func refreshWindowAppearance(for colorScheme: ColorScheme, windowTitle: String? = nil) {
        let colorSchemeChanged = self.colorScheme != colorScheme
        let windowTitleChanged = self.windowTitle != windowTitle
        guard colorSchemeChanged || windowTitleChanged else { return }
        self.colorScheme = colorScheme
        self.windowTitle = windowTitle

        guard let window else { return }
        self.configureWindowStyle()
        if windowTitleChanged, let windowTitle {
            window.title = windowTitle
        }
        if colorSchemeChanged {
            SettingsWindowAppearance.refresh(window, scheduleReset: self.scheduleReset)
        }
    }

    private func refreshWindowAppearance() {
        guard let window else { return }
        self.configureWindowStyle()
        if let windowTitle {
            window.title = windowTitle
        }
        SettingsWindowAppearance.refresh(window, scheduleReset: self.scheduleReset)
    }

    override func layout() {
        super.layout()
        self.configureWindowStyle()
    }

    private func configureWindowStyle() {
        guard let window else { return }
        if !window.styleMask.contains(.resizable) {
            window.styleMask.insert(.resizable)
        }
        if !window.titlebarAppearsTransparent {
            window.titlebarAppearsTransparent = true
        }
        if window.titleVisibility != .visible {
            window.titleVisibility = .visible
        }
        if window.titlebarSeparatorStyle != .none {
            window.titlebarSeparatorStyle = .none
        }
        if window.toolbar != nil {
            window.toolbar = nil
        }
        // Full-size content lets the sidebar material extend behind the titlebar so the
        // edge-to-edge sidebar reaches the top of the window; content stays below the
        // titlebar via the safe area.
        if !window.styleMask.contains(.fullSizeContentView) {
            window.styleMask.insert(.fullSizeContentView)
        }
    }
}


