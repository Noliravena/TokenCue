import Testing
@testable import TokenCue

struct KeychainMigrationTests {
    @Test
    func `migration list covers known keychain items`() {
        let items = Set(KeychainMigration.itemsToMigrate.map(\.label))
        let expected: Set = [
            "com.tokencue.desktop:codex-cookie",
            "com.tokencue.desktop:claude-cookie",
            "com.tokencue.desktop:cursor-cookie",
            "com.tokencue.desktop:factory-cookie",
            "com.tokencue.desktop:minimax-cookie",
            "com.tokencue.desktop:minimax-api-token",
            "com.tokencue.desktop:augment-cookie",
            "com.tokencue.desktop:copilot-api-token",
            "com.tokencue.desktop:zai-api-token",
            "com.tokencue.desktop:synthetic-api-key",
        ]

        let missing = expected.subtracting(items)
        #expect(missing.isEmpty, "Missing migration entries: \(missing.sorted())")
    }
}
