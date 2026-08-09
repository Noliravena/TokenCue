import TokenCueCore
import Foundation
import Observation

/// Compatibility-only state used by inherited menu rendering code.
///
/// TokenCue deliberately ships without CloudKit, iCloud synchronization, or a
/// fleet-account product surface. These collections therefore remain empty.
@MainActor
@Observable
final class CloudSyncState {
    var fleetDevices: [String: DeviceSyncPayload] = [:]
    var fleetSnapshots: [String: AccountSnapshotSyncPayload] = [:]
}
