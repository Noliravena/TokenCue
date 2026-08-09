import TokenCueCore
import Testing
@testable import TokenCue

struct KeychainPromptCoordinatorTests {
    @Test
    func `detects raw SwiftPM debug executable`() {
        #expect(KeychainPromptCoordinator.isUnbundledTokenCueExecutable(
            "/Users/me/TokenCue/.build/arm64-apple-macosx/debug/TokenCue"))
        #expect(KeychainPromptCoordinator.isUnbundledTokenCueExecutable(
            "/Users/me/TokenCue/.build/debug/TokenCue"))
    }

    @Test
    func `detects raw SwiftPM release executable`() {
        #expect(KeychainPromptCoordinator.isUnbundledTokenCueExecutable(
            "/Users/me/TokenCue/.build/arm64-apple-macosx/release/TokenCue"))
    }

    @Test
    func `detects custom SwiftPM scratch path`() {
        #expect(KeychainPromptCoordinator.isUnbundledTokenCueExecutable(
            "/tmp/tokencue-build/arm64-apple-macosx/debug/TokenCue"))
    }

    @Test
    func `keeps packaged app keychain behavior`() {
        #expect(!KeychainPromptCoordinator.isUnbundledTokenCueExecutable(
            "/Applications/TokenCue.app/Contents/MacOS/TokenCue"))
        #expect(!KeychainPromptCoordinator.isUnbundledTokenCueExecutable(
            "/Users/me/TokenCue/.build/package/TokenCue.app/Contents/MacOS/TokenCue"))
    }

    @Test
    func `ignores unrelated executable paths`() {
        #expect(!KeychainPromptCoordinator.isUnbundledTokenCueExecutable(
            "/Users/me/TokenCue/.build/debug/TokenCueCLI"))
        #expect(!KeychainPromptCoordinator.isUnbundledTokenCueExecutable(""))
        #expect(!KeychainPromptCoordinator.isUnbundledTokenCueExecutable("TokenCue"))
    }

    @Test
    func `browser cookie alert explains password handling and opt out`() {
        let model = KeychainPromptCoordinator.browserCookieAlertModel(label: "Chrome Safe Storage")

        #expect(model.title == "Keychain Access Required")
        #expect(model.message.contains("Chrome Safe Storage"))
        #expect(model.message.contains("macOS—not TokenCue—handles any Mac login password entry"))
        #expect(model.message.contains("Settings → Advanced"))
        #expect(model.primaryButtonTitle == "OK")
        #expect(model.learnMoreButtonTitle == "Learn More…")
        #expect(model.documentationURL.hasSuffix("/docs/keychain-prompts.md"))
    }

    @Test
    func `provider alert preserves the requested keychain purpose`() {
        let context = KeychainPromptContext(
            kind: .claudeOAuth,
            service: "Claude Code-credentials",
            account: nil)

        let model = KeychainPromptCoordinator.alertModel(for: context)

        #expect(model.message.contains("Claude Code OAuth token"))
        #expect(model.message.contains("fetch your Claude usage"))
        #expect(model.learnMoreButtonTitle == "Learn More…")
    }
}
