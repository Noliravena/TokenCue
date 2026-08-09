import TokenCueCore
import Foundation
import Testing
@testable import TokenCueCLI

struct CLIDiagnoseCommandTests {
    @Test
    func `diagnose help describes generic JSON export`() {
        let help = TokenCueCLI.diagnoseHelp(version: "0.0.0")

        #expect(help.contains("tokencue diagnose --provider <name|all> --format json"))
        #expect(help.contains("tokencue diagnose --provider all --format json"))
        #expect(help.contains("--redact"))
        #expect(help.contains("--output <path>"))
        #expect(help.contains("safe JSON export"))
        #expect(help.contains("raw API tokens"))
    }

    @Test
    func `diagnose output writer creates parent directories`() throws {
        let root = FileManager.default.temporaryDirectory
            .appendingPathComponent("TokenCueDiagnoseTests-\(UUID().uuidString)")
        defer { try? FileManager.default.removeItem(at: root) }

        let output = root.appendingPathComponent("nested/diagnostic.json")
        try TokenCueCLI.writeDiagnosticExport(#"{"provider":"minimax"}"#, to: output.path)

        let contents = try String(contentsOf: output, encoding: .utf8)
        #expect(contents == #"{"provider":"minimax"}"#)
    }

    private func makeSettingsWithMiniMaxCookie(_ manualCookieHeader: String) -> ProviderSettingsSnapshot {
        ProviderSettingsSnapshot.make(
            minimax: ProviderSettingsSnapshot.MiniMaxProviderSettings(
                cookieSource: .manual,
                manualCookieHeader: manualCookieHeader,
                apiRegion: .global))
    }

    @Test
    func `diagnose auth mode uses settings-backed MiniMax manual cookie when env token is absent`() {
        let settings = self.makeSettingsWithMiniMaxCookie("Cookie: session_id=demo-cookie")

        let summary = TokenCueCLI._diagnosticAuthSummaryForTesting(
            provider: .minimax,
            account: nil,
            config: nil,
            environment: [:],
            settings: settings)

        #expect(summary.configured)
        #expect(summary.modes == ["cookie"])
    }

    @Test
    func `diagnose auth mode keeps apiToken precedence over settings cookie`() {
        let settings = self.makeSettingsWithMiniMaxCookie("Cookie: session_id=demo-cookie")

        let summary = TokenCueCLI._diagnosticAuthSummaryForTesting(
            provider: .minimax,
            account: nil,
            config: nil,
            environment: [MiniMaxAPISettingsReader.apiTokenKey: "sk-api-demo-token"],
            settings: settings)

        #expect(summary.configured)
        #expect(summary.modes == ["apiToken"])
    }

    @Test
    func `generic diagnose auth summary detects provider config`() {
        let summary = TokenCueCLI._diagnosticAuthSummaryForTesting(
            provider: .openai,
            account: nil,
            config: ProviderConfig(id: .openai, apiKey: "sk-test"),
            environment: [:],
            settings: nil)

        #expect(summary.configured)
        #expect(summary.modes == ["api"])
    }

    @Test
    func `generic diagnose auth summary detects provider environment credentials`() {
        let summary = TokenCueCLI._diagnosticAuthSummaryForTesting(
            provider: .openai,
            account: nil,
            config: nil,
            environment: [OpenAIAPISettingsReader.apiKeyEnvironmentKey: "sk-test"],
            settings: nil)

        #expect(summary.configured)
        #expect(summary.modes == ["api"])
    }

    @Test
    func `generic diagnose auth summary detects Chutes environment credentials`() {
        let summary = TokenCueCLI._diagnosticAuthSummaryForTesting(
            provider: .chutes,
            account: nil,
            config: nil,
            environment: [ChutesSettingsReader.apiKeyEnvironmentKey: "chutes-test"],
            settings: nil)

        #expect(summary.configured)
        #expect(summary.modes == ["api"])
    }

    @Test
    func `generic diagnose auth summary detects Neuralwatt environment credentials`() {
        let summary = TokenCueCLI._diagnosticAuthSummaryForTesting(
            provider: .neuralwatt,
            account: nil,
            config: nil,
            environment: [NeuralWattSettingsReader.apiKeyEnvironmentKey: "sk-test"],
            settings: nil)

        #expect(summary.configured)
        #expect(summary.modes == ["api"])
    }

    @Test
    func `generic diagnose auth summary requires complete Bedrock credentials`() {
        let partial = TokenCueCLI._diagnosticAuthSummaryForTesting(
            provider: .bedrock,
            account: nil,
            config: ProviderConfig(id: .bedrock, apiKey: "access-only"),
            environment: [BedrockSettingsReader.accessKeyIDKey: "access-only"],
            settings: nil)
        #expect(!partial.configured)
        #expect(partial.modes.isEmpty)

        let complete = TokenCueCLI._diagnosticAuthSummaryForTesting(
            provider: .bedrock,
            account: nil,
            config: nil,
            environment: [
                BedrockSettingsReader.accessKeyIDKey: "access",
                BedrockSettingsReader.secretAccessKeyKey: "secret",
            ],
            settings: nil)
        #expect(complete.configured)
        #expect(complete.modes == ["api"])
    }

    @Test
    func `generic diagnose auth summary does not assume ambient credentials`() {
        let summary = TokenCueCLI._diagnosticAuthSummaryForTesting(
            provider: .codex,
            account: nil,
            config: nil,
            environment: [:],
            settings: nil)

        #expect(!summary.configured)
        #expect(summary.modes.isEmpty)
    }
}
