import TokenCueCore

extension UsageStore {
    /// Retained as a no-op so upstream refresh paths stay source-compatible
    /// after TokenCue removes WidgetKit and app-group snapshot persistence.
    func persistWidgetSnapshot(reason _: String) {}

    /// Fleet snapshots are unavailable because TokenCue has no iCloud sync.
    func cloudSyncAccountSnapshots() -> [AccountSnapshotSyncPayload] { [] }

    func cloudSyncLocalAccountKeys(for _: UsageProvider) -> Set<String> { [] }
}
