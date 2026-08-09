import TokenCueCore
import Foundation

extension Notification.Name {
    static let tokencueOpenSettings = Notification.Name("tokencueOpenSettings")
    static let tokencueDebugBlinkNow = Notification.Name("tokencueDebugBlinkNow")
    #if DEBUG
    static let tokencueDebugSimulateMemoryPressure =
        Notification.Name("com.tokencue.desktop.debug.simulateMemoryPressure")
    #endif
    static let tokencueSessionLimitReset = Notification.Name("tokencueSessionLimitReset")
    static let tokencueWeeklyLimitReset = Notification.Name("tokencueWeeklyLimitReset")
    static let tokencueProviderConfigDidChange = Notification.Name("tokencueProviderConfigDidChange")
    static let tokencueLocalConfigFileDidChange = Notification.Name("tokencueLocalConfigFileDidChange")
    static let tokencueUsageSnapshotsDidChange = Notification.Name("tokencueUsageSnapshotsDidChange")
    static let tokencueQuotaWarningDidPost = Notification.Name("tokencueQuotaWarningDidPost")
}

final class UsageSnapshotsDidChangeEvent: NSObject, @unchecked Sendable {
    let snapshots: [AccountSnapshotSyncPayload]

    init(snapshots: [AccountSnapshotSyncPayload]) {
        self.snapshots = snapshots
    }
}

@MainActor
final class SessionLimitResetEvent: NSObject {
    let provider: UsageProvider
    let accountIdentifier: String
    let accountLabel: String?
    let usedPercent: Double

    init(provider: UsageProvider, accountIdentifier: String, accountLabel: String?, usedPercent: Double) {
        self.provider = provider
        self.accountIdentifier = accountIdentifier
        self.accountLabel = accountLabel
        self.usedPercent = usedPercent
    }
}

@MainActor
final class WeeklyLimitResetEvent: NSObject {
    let provider: UsageProvider
    let accountIdentifier: String
    let accountLabel: String?
    let usedPercent: Double

    init(provider: UsageProvider, accountIdentifier: String, accountLabel: String?, usedPercent: Double) {
        self.provider = provider
        self.accountIdentifier = accountIdentifier
        self.accountLabel = accountLabel
        self.usedPercent = usedPercent
    }
}

@MainActor
final class QuotaWarningPostedEvent: NSObject {
    let provider: UsageProvider
    let window: QuotaWarningWindow
    let threshold: Int
    let postedAt: Date

    init(provider: UsageProvider, window: QuotaWarningWindow, threshold: Int, postedAt: Date) {
        self.provider = provider
        self.window = window
        self.threshold = threshold
        self.postedAt = postedAt
    }
}
