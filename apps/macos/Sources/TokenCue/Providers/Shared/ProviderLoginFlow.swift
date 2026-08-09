import AppKit
import TokenCueCore

@MainActor
extension StatusItemController {
    /// Runs the provider-specific login flow.
    /// - Returns: Whether TokenCue should refresh after the flow completes.
    func runLoginFlow(provider: UsageProvider) async -> Bool {
        guard let impl = ProviderCatalog.implementation(for: provider) else { return false }
        return await impl.runLoginFlow(context: ProviderLoginContext(controller: self))
    }
}
