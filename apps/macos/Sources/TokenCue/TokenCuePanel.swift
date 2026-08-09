import AppKit
import TokenCueCore
import Observation
import SwiftUI

enum TokenCueOnboardingState {
    static let completedDefaultsKey = "tokencueOnboardingCompleted"
}

@MainActor
final class TokenCuePanelController: NSObject, NSWindowDelegate {
    private let panel: TokenCuePanel
    private var localEventMonitor: Any?
    private var globalEventMonitor: Any?

    init(
        store: UsageStore,
        settings: SettingsStore,
        openSettings: @escaping @MainActor (SettingsPane) -> Void,
        quit: @escaping @MainActor () -> Void)
    {
        self.panel = TokenCuePanel(
            contentRect: NSRect(
                x: 0,
                y: 0,
                width: TokenCueDesignTokens.trayWidth,
                height: 640),
            styleMask: [.borderless, .nonactivatingPanel],
            backing: .buffered,
            defer: false)
        super.init()

        self.panel.delegate = self
        self.panel.level = .statusBar
        self.panel.isFloatingPanel = true
        self.panel.hidesOnDeactivate = false
        self.panel.hasShadow = true
        self.panel.isOpaque = false
        self.panel.backgroundColor = .clear
        self.panel.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary, .transient]
        self.panel.contentView = NSHostingView(rootView: TokenCuePanelView(
            store: store,
            settings: settings,
            dismiss: { [weak panel = self.panel] in panel?.orderOut(nil) },
            openSettings: openSettings,
            quit: quit))

        self.localEventMonitor = NSEvent.addLocalMonitorForEvents(
            matching: [.keyDown, .leftMouseDown, .rightMouseDown])
        { [weak self] event in
            guard let self, self.panel.isVisible else { return event }
            if event.type == .keyDown, event.keyCode == 53 {
                self.close()
                return nil
            }
            if event.type != .keyDown, event.window !== self.panel {
                self.close()
            }
            return event
        }
        self.globalEventMonitor = NSEvent.addGlobalMonitorForEvents(
            matching: [.leftMouseDown, .rightMouseDown])
        { [weak self] _ in
            Task { @MainActor in self?.close() }
        }
    }

    deinit {
        if let localEventMonitor {
            NSEvent.removeMonitor(localEventMonitor)
        }
        if let globalEventMonitor {
            NSEvent.removeMonitor(globalEventMonitor)
        }
    }

    var isVisible: Bool {
        self.panel.isVisible
    }

    func toggle(relativeTo button: NSStatusBarButton) {
        if self.panel.isVisible {
            self.close()
        } else {
            self.show(relativeTo: button)
        }
    }

    func show(relativeTo button: NSStatusBarButton) {
        guard let buttonWindow = button.window else { return }
        let anchorInWindow = button.convert(button.bounds, to: nil)
        let anchor = buttonWindow.convertToScreen(anchorInWindow)
        let screen = buttonWindow.screen
            ?? NSScreen.screens.first(where: { $0.frame.intersects(anchor) })
            ?? NSScreen.main
        guard let screen else { return }

        let frame = self.panel.frame
        let visible = screen.visibleFrame
        let x = min(
            max(anchor.midX - frame.width / 2, visible.minX + 8),
            visible.maxX - frame.width - 8)
        var y = anchor.minY - frame.height - 7
        if y < visible.minY + 8 {
            y = min(anchor.maxY + 7, visible.maxY - frame.height - 8)
        }
        self.panel.setFrameOrigin(NSPoint(x: x, y: y))
        self.panel.makeKeyAndOrderFront(nil)
    }

    func close() {
        self.panel.orderOut(nil)
    }

    func windowDidResignKey(_: Notification) {
        self.close()
    }
}

private final class TokenCuePanel: NSPanel {
    override var canBecomeKey: Bool { true }
    override var canBecomeMain: Bool { false }
}

private enum TokenCueTrayTab: String, CaseIterable, Identifiable {
    case quota, spend, history, settings
    var id: String { self.rawValue }
    var title: String {
        switch self {
        case .quota: "Quota"
        case .spend: "Spend"
        case .history: "History"
        case .settings: "Settings"
        }
    }

    var systemImage: String {
        switch self {
        case .quota: "rectangle.and.hand.point.up.left"
        case .spend: "chart.bar.xaxis"
        case .history: "clock"
        case .settings: "slider.horizontal.3"
        }
    }
}

@MainActor
private struct TokenCuePanelView: View {
    @Bindable var store: UsageStore
    @Bindable var settings: SettingsStore
    let dismiss: @MainActor () -> Void
    let openSettings: @MainActor (SettingsPane) -> Void
    let quit: @MainActor () -> Void
    @AppStorage(TokenCueOnboardingState.completedDefaultsKey) private var onboardingCompleted = false
    @State private var tab: TokenCueTrayTab = .quota
    @State private var refreshing = false
    @Environment(\.colorScheme) private var colorScheme

    private var enabledProviders: [ProviderInstanceID] {
        self.store.enabledProvidersForDisplay()
    }

    var body: some View {
        Group {
            if !self.onboardingCompleted, self.enabledProviders.isEmpty {
                TokenCueOnboardingView(
                    store: self.store,
                    settings: self.settings,
                    onComplete: { self.onboardingCompleted = true })
            } else {
                self.dashboard
            }
        }
        .frame(width: TokenCueDesignTokens.trayWidth, height: 640)
        .background(self.panelBackground)
        .clipShape(RoundedRectangle(cornerRadius: TokenCueDesignTokens.trayRadius, style: .continuous))
        .overlay {
            RoundedRectangle(cornerRadius: TokenCueDesignTokens.trayRadius, style: .continuous)
                .stroke(self.borderColor, lineWidth: 1)
        }
        .shadow(color: Color.black.opacity(self.colorScheme == .dark ? 0.45 : 0.18), radius: 30, y: 18)
    }

    private var dashboard: some View {
        VStack(spacing: 0) {
            ZStack {
                HStack(spacing: 8) {
                    Image(nsImage: NSApp.applicationIconImage)
                        .resizable()
                        .frame(width: 20, height: 20)
                        .clipShape(RoundedRectangle(cornerRadius: 6, style: .continuous))
                    Text("TokenCue")
                        .font(.system(size: 20, weight: .semibold, design: .serif))
                }
                HStack(spacing: 10) {
                    Circle().fill(Color.primary.opacity(0.16)).frame(width: 11, height: 11)
                    Circle().fill(Color.primary.opacity(0.16)).frame(width: 11, height: 11)
                    Spacer()
                }
            }
            .padding(.horizontal, 16)
            .padding(.top, 16)
            .padding(.bottom, 12)

            HStack(spacing: 2) {
                ForEach(TokenCueTrayTab.allCases) { tab in
                    Button {
                        self.tab = tab
                    } label: {
                        VStack(spacing: 5) {
                            Image(systemName: tab.systemImage)
                                .font(.system(size: 13, weight: .medium))
                            Text(tab.title)
                                .font(.system(size: 11, weight: self.tab == tab ? .semibold : .medium))
                        }
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 8)
                        .foregroundStyle(self.tab == tab ? self.primaryText : self.secondaryText)
                        .background(
                            RoundedRectangle(cornerRadius: 12, style: .continuous)
                                .fill(self.tab == tab ? self.tabActiveBackground : Color.clear)
                                .overlay {
                                    RoundedRectangle(cornerRadius: 12, style: .continuous)
                                        .stroke(self.tab == tab ? Color.primary.opacity(0.10) : Color.clear, lineWidth: 1)
                                })
                    }
                    .buttonStyle(.plain)
                }
            }
            .padding(.horizontal, 10)
            .padding(.bottom, 10)

            Group {
                switch self.tab {
                case .quota: self.quotaBody
                case .spend: self.spendBody
                case .history: self.historyBody
                case .settings: self.settingsBody
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)

            HStack(spacing: 10) {
                Button {
                    Task { @MainActor in
                        self.refreshing = true
                        await self.store.refresh(forceTokenUsage: true)
                        self.refreshing = false
                    }
                } label: {
                    Image(systemName: "arrow.clockwise")
                        .symbolEffect(.rotate, isActive: self.refreshing)
                }
                .buttonStyle(TokenCueIconButtonStyle())
                .disabled(self.refreshing)
                Text(self.summaryText)
                    .font(.system(size: 12))
                    .foregroundStyle(self.secondaryText)
                    .lineLimit(1)
                Spacer()
                Text("⌘R")
                    .font(.system(size: 11, design: .monospaced))
                    .padding(.horizontal, 10)
                    .padding(.vertical, 4)
                    .background(self.raisedBackground)
                    .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
                    .foregroundStyle(self.secondaryText)
                Menu {
                    Button("Open Settings") {
                        self.dismiss()
                        self.openSettings(.general)
                    }
                    Button("Quit TokenCue", role: .destructive) { self.quit() }
                } label: {
                    Image(systemName: "ellipsis")
                }
                .menuStyle(.borderlessButton)
                .frame(width: 28)
            }
            .padding(.horizontal, 16)
            .frame(height: 48)
            .background(self.footerBackground)
        }
    }

    private var quotaBody: some View {
        Group {
            if self.enabledProviders.isEmpty {
                VStack(spacing: 14) {
                    Image(nsImage: NSApp.applicationIconImage)
                        .resizable()
                        .frame(width: 56, height: 56)
                        .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
                    Text("No providers connected")
                        .font(.system(size: 24, weight: .semibold, design: .serif))
                    Text("Choose providers in Settings to start tracking usage.")
                        .font(.system(size: 13))
                        .foregroundStyle(self.secondaryText)
                        .multilineTextAlignment(.center)
                    Button("Connect a provider →") {
                        self.dismiss()
                        self.openSettings(.general)
                    }
                    .buttonStyle(.bordered)
                }
                .padding(28)
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else {
                ScrollView {
                    LazyVStack(spacing: 10) {
                        ForEach(self.enabledProviders, id: \.self) { instanceID in
                            TokenCueProviderCard(instanceID: instanceID, store: self.store)
                        }
                    }
                    .padding(.horizontal, 14)
                    .padding(.bottom, 18)
                }
            }
        }
    }

    private var spendBody: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 10) {
                VStack(alignment: .leading, spacing: 10) {
                    HStack(alignment: .bottom) {
                        VStack(alignment: .leading, spacing: 4) {
                            Text("TODAY")
                                .font(.system(size: 11, weight: .bold))
                                .tracking(1.2)
                                .foregroundStyle(self.secondaryText)
                            Text(self.spendTodayLabel)
                                .font(.system(size: 30, weight: .semibold, design: .serif))
                                .monospacedDigit()
                        }
                        Spacer()
                        VStack(alignment: .trailing, spacing: 4) {
                            Text("30 DAYS")
                                .font(.system(size: 11, weight: .bold))
                                .tracking(1.2)
                                .foregroundStyle(self.secondaryText)
                            Text(self.spendMonthLabel)
                                .font(.system(size: 20, weight: .semibold, design: .serif))
                                .foregroundStyle(self.secondaryText)
                                .monospacedDigit()
                        }
                    }
                }
                .padding(16)
                .background(self.raisedBackground)
                .clipShape(RoundedRectangle(cornerRadius: TokenCueDesignTokens.cardRadius, style: .continuous))
                .overlay {
                    RoundedRectangle(cornerRadius: TokenCueDesignTokens.cardRadius, style: .continuous)
                        .stroke(Color.primary.opacity(0.09), lineWidth: 1)
                }

                VStack(spacing: 0) {
                    ForEach(self.enabledProviders, id: \.self) { instanceID in
                        if let cost = self.store.snapshot(for: instanceID)?.providerCost {
                            HStack(spacing: 11) {
                                TokenCueProviderIcon(
                                    provider: instanceID.firstPartyProvider,
                                    instanceID: instanceID,
                                    size: 26)
                                Text(self.displayName(for: instanceID))
                                    .font(.system(size: 14, weight: .medium))
                                Spacer()
                                Text(cost.used.formatted(.currency(code: cost.currencyCode)))
                                    .font(.system(size: 14, weight: .semibold))
                                    .monospacedDigit()
                            }
                            .padding(.horizontal, 15)
                            .padding(.vertical, 12)
                            Divider().opacity(0.5)
                        }
                    }
                }
                .background(self.raisedBackground)
                .clipShape(RoundedRectangle(cornerRadius: TokenCueDesignTokens.cardRadius, style: .continuous))
                .overlay {
                    RoundedRectangle(cornerRadius: TokenCueDesignTokens.cardRadius, style: .continuous)
                        .stroke(Color.primary.opacity(0.09), lineWidth: 1)
                }

                Text("Amounts are local estimates; bills from providers may differ.")
                    .font(.system(size: 12))
                    .foregroundStyle(self.secondaryText)
            }
            .padding(.horizontal, 14)
            .padding(.bottom, 18)
        }
    }

    private var historyBody: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 10) {
                Text("RECENT EVENTS")
                    .font(.system(size: 11, weight: .bold))
                    .tracking(1.2)
                    .foregroundStyle(self.secondaryText)
                VStack(spacing: 0) {
                    ForEach(self.historyEvents, id: \.title) { event in
                        HStack(alignment: .top, spacing: 11) {
                            Circle()
                                .fill(event.color)
                                .frame(width: 8, height: 8)
                                .padding(.top, 5)
                            VStack(alignment: .leading, spacing: 2) {
                                Text(event.title)
                                    .font(.system(size: 13.5, weight: .medium))
                                Text(event.detail)
                                    .font(.system(size: 11.5))
                                    .foregroundStyle(self.secondaryText)
                            }
                            Spacer()
                        }
                        .padding(.horizontal, 15)
                        .padding(.vertical, 11)
                        Divider().opacity(0.5)
                    }
                    if self.historyEvents.isEmpty {
                        Text("No recent events yet.")
                            .font(.system(size: 12))
                            .foregroundStyle(self.secondaryText)
                            .padding(15)
                            .frame(maxWidth: .infinity, alignment: .leading)
                    }
                }
                .background(self.raisedBackground)
                .clipShape(RoundedRectangle(cornerRadius: TokenCueDesignTokens.cardRadius, style: .continuous))
                .overlay {
                    RoundedRectangle(cornerRadius: TokenCueDesignTokens.cardRadius, style: .continuous)
                        .stroke(Color.primary.opacity(0.09), lineWidth: 1)
                }
            }
            .padding(.horizontal, 14)
            .padding(.bottom, 18)
        }
    }

    private var settingsBody: some View {
        ScrollView {
            VStack(spacing: 10) {
                VStack(spacing: 0) {
                    Toggle(isOn: Binding(
                        get: { self.settings.quotaWarningNotificationsEnabled },
                        set: { self.settings.quotaWarningNotificationsEnabled = $0 }))
                    {
                        VStack(alignment: .leading, spacing: 2) {
                            Text("Show notifications")
                                .font(.system(size: 14, weight: .semibold))
                            Text("Alert when usage crosses thresholds")
                                .font(.system(size: 11.5))
                                .foregroundStyle(self.secondaryText)
                        }
                    }
                    .toggleStyle(.switch)
                    .tint(TokenCueDesignTokens.accent)
                    .padding(.horizontal, 15)
                    .padding(.vertical, 13)
                    Divider().opacity(0.5)
                    Toggle(isOn: Binding(
                        get: { self.settings.quotaWarningMarkersVisible },
                        set: { self.settings.quotaWarningMarkersVisible = $0 }))
                    {
                        VStack(alignment: .leading, spacing: 2) {
                            Text("Quota warning markers")
                                .font(.system(size: 14, weight: .semibold))
                            Text("Show threshold markers on usage bars")
                                .font(.system(size: 11.5))
                                .foregroundStyle(self.secondaryText)
                        }
                    }
                    .toggleStyle(.switch)
                    .tint(TokenCueDesignTokens.accent)
                    .padding(.horizontal, 15)
                    .padding(.vertical, 13)
                }
                .background(self.raisedBackground)
                .clipShape(RoundedRectangle(cornerRadius: TokenCueDesignTokens.cardRadius, style: .continuous))
                .overlay {
                    RoundedRectangle(cornerRadius: TokenCueDesignTokens.cardRadius, style: .continuous)
                        .stroke(Color.primary.opacity(0.09), lineWidth: 1)
                }

                Button("Open full settings") {
                    self.dismiss()
                    self.openSettings(.general)
                }
                .frame(maxWidth: .infinity)
                .padding(.vertical, 10)
                .background(self.panelBackground)
                .clipShape(Capsule())
                .overlay { Capsule().stroke(Color.primary.opacity(0.12), lineWidth: 1) }
            }
            .padding(.horizontal, 14)
            .padding(.bottom, 18)
        }
    }

    private var spendTodayLabel: String {
        let total = self.enabledProviders.compactMap { self.store.snapshot(for: $0)?.providerCost?.used }.reduce(0, +)
        return total > 0 ? total.formatted(.currency(code: "USD")) : "—"
    }

    private var spendMonthLabel: String {
        self.spendTodayLabel
    }

    private var historyEvents: [(title: String, detail: String, color: Color)] {
        self.enabledProviders.compactMap { id in
            if let error = self.store.errors[id] {
                return (self.displayName(for: id), error, TokenCueDesignTokens.critical)
            }
            if let primary = self.store.snapshot(for: id)?.primary {
                if primary.usedPercent >= Double(TokenCueDesignTokens.criticalThreshold) {
                    return (
                        self.displayName(for: id),
                        "\(Int(primary.usedPercent.rounded()))% used",
                        TokenCueDesignTokens.critical)
                }
                if primary.usedPercent >= Double(TokenCueDesignTokens.warningThreshold) {
                    return (
                        self.displayName(for: id),
                        "\(Int(primary.usedPercent.rounded()))% used",
                        TokenCueDesignTokens.warning)
                }
            }
            return nil
        }
    }

    private func displayName(for instanceID: ProviderInstanceID) -> String {
        instanceID.firstPartyProvider.map { ProviderDescriptorRegistry.descriptor(for: $0).metadata.displayName }
            ?? instanceID.rawValue
    }

    private var summaryText: String {
        let failures = self.enabledProviders.filter { self.store.errors[$0] != nil }.count
        if failures > 0 {
            return "\(self.enabledProviders.count) providers · \(failures) need attention"
        }
        return "\(self.enabledProviders.count) providers"
    }

    private var panelBackground: Color {
        self.colorScheme == .dark ? TokenCueDesignTokens.darkSurface : TokenCueDesignTokens.lightSurface
    }

    private var raisedBackground: Color {
        self.colorScheme == .dark ? TokenCueDesignTokens.darkSurfaceRaised : TokenCueDesignTokens.lightSurfaceRaised
    }

    private var footerBackground: Color {
        self.colorScheme == .dark ? Color(hex: 0x211D16) : Color(hex: 0xF3EAD6)
    }

    private var tabActiveBackground: Color {
        self.colorScheme == .dark ? Color(hex: 0x282319) : Color(hex: 0xF0E6CF)
    }

    private var primaryText: Color {
        self.colorScheme == .dark ? TokenCueDesignTokens.darkText : TokenCueDesignTokens.lightText
    }

    private var secondaryText: Color {
        self.colorScheme == .dark ? TokenCueDesignTokens.darkTextSecondary : TokenCueDesignTokens.lightTextSecondary
    }

    private var borderColor: Color {
        Color.primary.opacity(0.08)
    }
}

@MainActor
private struct TokenCueProviderCard: View {
    let instanceID: ProviderInstanceID
    @Bindable var store: UsageStore
    @Environment(\.colorScheme) private var colorScheme

    private var provider: UsageProvider? { self.instanceID.firstPartyProvider }
    private var snapshot: UsageSnapshot? { self.store.snapshot(for: self.instanceID) }
    private var error: String? { self.store.errors[self.instanceID] }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(spacing: 11) {
                TokenCueProviderIcon(provider: self.provider, instanceID: self.instanceID, size: 32)
                VStack(alignment: .leading, spacing: 2) {
                    Text(self.displayName)
                        .font(.system(size: 15, weight: .semibold))
                    Text(self.subtitle)
                        .font(.system(size: 12, design: .monospaced))
                        .foregroundStyle(self.error == nil ? self.secondaryText : TokenCueDesignTokens.critical)
                        .lineLimit(1)
                }
                Spacer()
                if let primary = self.snapshot?.primary, self.error == nil {
                    VStack(alignment: .trailing, spacing: 2) {
                        HStack(alignment: .firstTextBaseline, spacing: 1) {
                            Text("\(Int(self.displayPercent(for: primary).rounded()))")
                                .font(.system(size: 26, weight: .semibold, design: .serif))
                                .foregroundStyle(self.color(for: primary.usedPercent))
                            Text("%")
                                .font(.system(size: 15, weight: .semibold, design: .serif))
                                .foregroundStyle(self.secondaryText)
                        }
                        Text(self.settingsSuffix)
                            .font(.system(size: 11))
                            .foregroundStyle(self.secondaryText)
                    }
                    .monospacedDigit()
                }
            }

            if let primary = self.snapshot?.primary, self.error == nil {
                TokenCueUsageBar(percent: primary.usedPercent)
            }

            if let plan = self.snapshot?.planName, !plan.isEmpty {
                Text(plan)
                    .font(.system(size: 11, weight: .semibold))
                    .padding(.horizontal, 9)
                    .padding(.vertical, 3)
                    .background(Color.primary.opacity(0.06))
                    .clipShape(Capsule())
                    .foregroundStyle(self.secondaryText)
            }
        }
        .padding(15)
        .background(self.raisedBackground)
        .clipShape(RoundedRectangle(cornerRadius: TokenCueDesignTokens.cardRadius, style: .continuous))
        .overlay {
            RoundedRectangle(cornerRadius: TokenCueDesignTokens.cardRadius, style: .continuous)
                .stroke(
                    self.error == nil
                        ? Color.primary.opacity(0.09)
                        : TokenCueDesignTokens.critical.opacity(0.35),
                    lineWidth: 1)
        }
        .opacity(self.isStale ? 0.72 : 1)
    }

    private var displayName: String {
        self.provider.map { ProviderDescriptorRegistry.descriptor(for: $0).metadata.displayName }
            ?? self.instanceID.rawValue
    }

    private var subtitle: String {
        if let error { return error }
        guard let primary = self.snapshot?.primary else { return "Waiting for first refresh" }
        if let resetsAt = primary.resetsAt {
            return "Resets \(resetsAt.formatted(.relative(presentation: .named)))"
        }
        return "Updated \(self.snapshot?.updatedAt.formatted(.relative(presentation: .named)) ?? "—")"
    }

    private var settingsSuffix: String {
        "left"
    }

    private func displayPercent(for window: RateWindow) -> Double {
        max(0, min(100, 100 - window.usedPercent))
    }

    private var isStale: Bool {
        guard self.error == nil, let updatedAt = self.snapshot?.updatedAt else { return false }
        return Date().timeIntervalSince(updatedAt) > 10 * 60
    }

    private func color(for percent: Double) -> Color {
        if percent >= Double(TokenCueDesignTokens.criticalThreshold) { return TokenCueDesignTokens.critical }
        if percent >= Double(TokenCueDesignTokens.warningThreshold) { return TokenCueDesignTokens.warning }
        return TokenCueDesignTokens.normal
    }

    private var raisedBackground: Color {
        self.colorScheme == .dark ? TokenCueDesignTokens.darkSurfaceRaised : TokenCueDesignTokens.lightSurfaceRaised
    }

    private var secondaryText: Color {
        self.colorScheme == .dark ? TokenCueDesignTokens.darkTextSecondary : TokenCueDesignTokens.lightTextSecondary
    }
}

private struct TokenCueUsageBar: View {
    let percent: Double

    var body: some View {
        GeometryReader { proxy in
            ZStack(alignment: .leading) {
                Capsule().fill(Color.primary.opacity(0.08))
                Capsule()
                    .fill(self.color)
                    .frame(width: proxy.size.width * min(max(self.percent, 0), 100) / 100)
            }
        }
        .frame(height: 7)
        .accessibilityLabel("Usage")
        .accessibilityValue("\(Int(self.percent.rounded())) percent")
    }

    private var color: Color {
        if self.percent >= Double(TokenCueDesignTokens.criticalThreshold) { return TokenCueDesignTokens.critical }
        if self.percent >= Double(TokenCueDesignTokens.warningThreshold) { return TokenCueDesignTokens.warning }
        return TokenCueDesignTokens.normal
    }
}

private struct TokenCueUsageDetailRow: View {
    let title: String
    let window: RateWindow

    var body: some View {
        HStack {
            VStack(alignment: .leading, spacing: 2) {
                Text(self.title)
                if let resetsAt = self.window.resetsAt {
                    Text("Resets \(resetsAt.formatted(.relative(presentation: .named)))")
                        .foregroundStyle(.secondary)
                }
            }
            Spacer()
            Text("\(Int(self.window.usedPercent.rounded()))% used")
                .monospacedDigit()
        }
        .font(.system(size: 11))
    }
}

private struct TokenCueProviderIcon: View {
    let provider: UsageProvider?
    let instanceID: ProviderInstanceID
    var size: CGFloat = 26

    var body: some View {
        Group {
            if let image = self.image {
                Image(nsImage: image)
                    .resizable()
                    .scaledToFit()
            } else {
                Image(systemName: "circle.grid.2x2.fill")
                    .resizable()
                    .scaledToFit()
                    .foregroundStyle(.white.opacity(0.92))
            }
        }
        .frame(width: self.size * 0.6, height: self.size * 0.6)
        .frame(width: self.size, height: self.size)
        .background(TokenCueDesignTokens.accent.opacity(0.9))
        .clipShape(RoundedRectangle(cornerRadius: self.size > 28 ? 10 : 8, style: .continuous))
        .accessibilityLabel(self.instanceID.rawValue)
    }

    private var image: NSImage? {
        guard let provider,
              let url = Bundle.module.url(
                  forResource: "ProviderIcon-\(provider.rawValue)",
                  withExtension: "svg")
        else { return nil }
        return NSImage(contentsOf: url)
    }
}

@MainActor
private struct TokenCueOnboardingView: View {
    @Bindable var store: UsageStore
    @Bindable var settings: SettingsStore
    let onComplete: @MainActor () -> Void
    @State private var step = 0
    @State private var selected: Set<UsageProvider> = []
    @State private var sourceByProvider: [UsageProvider: ProviderSourceMode] = [:]
    @State private var browserConsent = false
    @State private var search = ""

    private var visibleProviders: [UsageProvider] {
        let query = self.search.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        return UsageProvider.allCases.filter { provider in
            guard !query.isEmpty else { return true }
            let name = ProviderDescriptorRegistry.descriptor(for: provider).metadata.displayName.lowercased()
            return name.contains(query) || provider.rawValue.contains(query)
        }
    }

    private var allSourcesChosen: Bool {
        self.selected.allSatisfy { self.sourceByProvider[$0] != nil }
    }

    private var usesBrowser: Bool {
        self.sourceByProvider.values.contains(.web)
    }

    var body: some View {
        VStack(spacing: 0) {
            HStack {
                Text("TokenCue")
                    .font(.system(size: 15, weight: .semibold))
                Spacer()
                Text("\(self.step + 1) / 3")
                    .font(.system(size: 11))
                    .foregroundStyle(.secondary)
            }
            .padding(.horizontal, 16)
            .frame(height: 48)
            Divider()

            Group {
                switch self.step {
                case 0: self.welcome
                case 1: self.providerPicker
                default: self.sourcePicker
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)

            Divider()
            HStack {
                Button("Back") { self.step = max(0, self.step - 1) }
                    .disabled(self.step == 0)
                Spacer()
                if self.step < 2 {
                    Button(self.step == 0 ? "Get Started" : "Continue") { self.step += 1 }
                        .buttonStyle(.borderedProminent)
                        .tint(TokenCueDesignTokens.accent)
                        .disabled(self.step == 1 && self.selected.isEmpty)
                } else {
                    Button("Enable Providers") { self.finish() }
                        .buttonStyle(.borderedProminent)
                        .tint(TokenCueDesignTokens.accent)
                        .disabled(!self.allSourcesChosen || (self.usesBrowser && !self.browserConsent))
                }
            }
            .padding(.horizontal, 16)
            .frame(height: 58)
        }
    }

    private var welcome: some View {
        VStack(alignment: .leading, spacing: 16) {
            Spacer()
            Text("PRIVATE BY DEFAULT")
                .font(.system(size: 10, weight: .bold))
                .tracking(1.1)
                .foregroundStyle(TokenCueDesignTokens.accent)
            Text("Every AI limit,\nat a glance.")
                .font(.system(size: 24, weight: .semibold))
            Text("TokenCue keeps usage snapshots and spend history on this Mac. It detects available login sources without reading browser cookies or enabling providers.")
                .font(.system(size: 13))
                .foregroundStyle(.secondary)
                .lineSpacing(4)
            VStack(alignment: .leading, spacing: 10) {
                Label("Local cache and history", systemImage: "internaldrive")
                Label("Explicit provider authorization", systemImage: "hand.raised")
                Label("Credentials stored in TokenCue Keychain", systemImage: "key")
            }
            .font(.system(size: 12))
            Spacer()
        }
        .padding(24)
    }

    private var providerPicker: some View {
        VStack(spacing: 10) {
            TextField("Search providers", text: self.$search)
                .textFieldStyle(.roundedBorder)
                .padding(.horizontal, 16)
                .padding(.top, 14)
            ScrollView {
                LazyVGrid(columns: [.init(.flexible()), .init(.flexible())], spacing: 8) {
                    ForEach(self.visibleProviders, id: \.self) { provider in
                        let descriptor = ProviderDescriptorRegistry.descriptor(for: provider)
                        Toggle(isOn: Binding(
                            get: { self.selected.contains(provider) },
                            set: { enabled in
                                if enabled {
                                    self.selected.insert(provider)
                                } else {
                                    self.selected.remove(provider)
                                    self.sourceByProvider.removeValue(forKey: provider)
                                }
                            }))
                        {
                            VStack(alignment: .leading, spacing: 2) {
                                Text(descriptor.metadata.displayName)
                                    .font(.system(size: 11, weight: .medium))
                                    .lineLimit(1)
                                Text(self.settings.detectedProviderCandidates.contains(provider) ? "Detected" : provider.rawValue)
                                    .font(.system(size: 9))
                                    .foregroundStyle(.secondary)
                            }
                        }
                        .toggleStyle(.checkbox)
                        .padding(8)
                        .background(Color.primary.opacity(0.035))
                        .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
                    }
                }
                .padding(12)
            }
        }
    }

    private var sourcePicker: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 10) {
                Text("Choose what TokenCue may read")
                    .font(.system(size: 17, weight: .semibold))
                Text("No authorization method is selected for you.")
                    .font(.system(size: 11))
                    .foregroundStyle(.secondary)

                ForEach(Array(self.selected).sorted(by: { $0.rawValue < $1.rawValue }), id: \.self) { provider in
                    let descriptor = ProviderDescriptorRegistry.descriptor(for: provider)
                    VStack(alignment: .leading, spacing: 8) {
                        Text(descriptor.metadata.displayName)
                            .font(.system(size: 12, weight: .semibold))
                        Picker("Source", selection: Binding(
                            get: { self.sourceByProvider[provider] },
                            set: { self.sourceByProvider[provider] = $0 }))
                        {
                            Text("Select…").tag(ProviderSourceMode?.none)
                            ForEach(self.explicitSources(for: provider), id: \.self) { source in
                                Text(self.label(for: source)).tag(ProviderSourceMode?.some(source))
                            }
                        }
                        .labelsHidden()
                    }
                    .padding(10)
                    .background(Color.primary.opacity(0.035))
                    .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
                }

                if self.usesBrowser {
                    Toggle(
                        "I authorize TokenCue to read browser cookies for the providers set to Browser Session after I click Enable Providers.",
                        isOn: self.$browserConsent)
                        .toggleStyle(.checkbox)
                        .font(.system(size: 11))
                        .padding(10)
                        .background(TokenCueDesignTokens.warning.opacity(0.1))
                        .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
                }
            }
            .padding(16)
        }
    }

    private func explicitSources(for provider: UsageProvider) -> [ProviderSourceMode] {
        let modes = ProviderDescriptorRegistry.descriptor(for: provider).fetchPlan.sourceModes
        let order: [ProviderSourceMode] = [.cli, .oauth, .api, .web]
        return order.filter(modes.contains)
    }

    private func label(for source: ProviderSourceMode) -> String {
        switch source {
        case .cli: "Local CLI"
        case .oauth: "OAuth"
        case .api: "API Key"
        case .web: "Browser Session"
        case .auto: "Automatic"
        }
    }

    private func finish() {
        for provider in self.selected {
            guard let source = self.sourceByProvider[provider] else { continue }
            self.settings.updateProviderConfig(provider: provider) { entry in
                entry.source = source
                entry.enabled = true
            }
        }
        self.onComplete()
        Task { @MainActor in await self.store.refresh(forceTokenUsage: true) }
    }
}

private struct TokenCueIconButtonStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .frame(width: 28, height: 28)
            .background(Color.primary.opacity(configuration.isPressed ? 0.12 : 0.06))
            .clipShape(RoundedRectangle(cornerRadius: 7, style: .continuous))
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
extension StatusItemController {
    func installTokenCuePanelAction(on item: NSStatusItem) {
        item.menu = nil
        guard let button = item.button else { return }
        button.target = self
        button.action = #selector(self.toggleTokenCuePanel(_:))
        button.sendAction(on: [.leftMouseUp, .rightMouseUp])
    }

    @objc func toggleTokenCuePanel(_ sender: NSStatusBarButton) {
        self.tokenCuePanelController.toggle(relativeTo: sender)
    }
}
