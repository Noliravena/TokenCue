import Foundation

public enum TokenCueConfigStoreError: LocalizedError {
    case invalidURL
    case decodeFailed(String)
    case encodeFailed(String)

    public var errorDescription: String? {
        switch self {
        case .invalidURL:
            "Invalid TokenCue config path."
        case let .decodeFailed(details):
            "Failed to decode TokenCue config: \(details)"
        case let .encodeFailed(details):
            "Failed to encode TokenCue config: \(details)"
        }
    }
}

public struct TokenCueConfigStore: @unchecked Sendable {
    public static let pathEnvironmentKey = "TOKENCUE_CONFIG"
    public static let xdgConfigHomeEnvironmentKey = "XDG_CONFIG_HOME"

    public let fileURL: URL
    private let fileManager: FileManager

    public init(fileURL: URL = Self.defaultURL(), fileManager: FileManager = .default) {
        self.fileURL = fileURL
        self.fileManager = fileManager
    }

    public func load() throws -> TokenCueConfig? {
        guard self.fileManager.fileExists(atPath: self.fileURL.path) else { return nil }
        let data = try Data(contentsOf: self.fileURL)
        let decoder = JSONDecoder()
        do {
            let decoded = try decoder.decode(TokenCueConfig.self, from: data)
            return decoded.normalized()
        } catch {
            throw TokenCueConfigStoreError.decodeFailed(error.localizedDescription)
        }
    }

    public func loadOrCreateDefault() throws -> TokenCueConfig {
        if let existing = try self.load() {
            return existing
        }
        let config = TokenCueConfig.makeDefault()
        try self.save(config)
        return config
    }

    public func save(_ config: TokenCueConfig) throws {
        let data = try self.encodedData(for: config)
        try self.saveEncodedData(data)
    }

    public func encodedData(for config: TokenCueConfig) throws -> Data {
        let normalized = config.normalized()
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
        do {
            return try encoder.encode(normalized)
        } catch {
            throw TokenCueConfigStoreError.encodeFailed(error.localizedDescription)
        }
    }

    public func saveEncodedData(_ data: Data) throws {
        let directory = self.fileURL.deletingLastPathComponent()
        if !self.fileManager.fileExists(atPath: directory.path) {
            try self.fileManager.createDirectory(at: directory, withIntermediateDirectories: true)
        }
        try data.write(to: self.fileURL, options: [.atomic])
        try self.applySecurePermissionsIfNeeded()
    }

    public func deleteIfPresent() throws {
        guard self.fileManager.fileExists(atPath: self.fileURL.path) else { return }
        try self.fileManager.removeItem(at: self.fileURL)
    }

    public static func defaultURL(
        home: URL = FileManager.default.homeDirectoryForCurrentUser,
        environment: [String: String] = ProcessInfo.processInfo.environment,
        fileManager: FileManager = .default) -> URL
    {
        if let override = environment[pathEnvironmentKey]?.trimmingCharacters(in: .whitespacesAndNewlines),
           !override.isEmpty
        {
            let expanded = (override as NSString).expandingTildeInPath
            return URL(fileURLWithPath: expanded)
        }

        if let xdgConfigHome = environment[xdgConfigHomeEnvironmentKey]?
            .trimmingCharacters(in: .whitespacesAndNewlines),
            !xdgConfigHome.isEmpty
        {
            let expanded = (xdgConfigHome as NSString).expandingTildeInPath
            if (expanded as NSString).isAbsolutePath {
                return URL(fileURLWithPath: expanded, isDirectory: true)
                    .appendingPathComponent("tokencue", isDirectory: true)
                    .appendingPathComponent("config.json")
            }
        }

        let xdgDefault = home
            .appendingPathComponent(".config", isDirectory: true)
            .appendingPathComponent("tokencue", isDirectory: true)
            .appendingPathComponent("config.json")
        if fileManager.fileExists(atPath: xdgDefault.path) {
            return xdgDefault
        }

        let legacy = home
            .appendingPathComponent(".tokencue", isDirectory: true)
            .appendingPathComponent("config.json")
        if fileManager.fileExists(atPath: legacy.path) {
            return legacy
        }

        return xdgDefault
    }

    private func applySecurePermissionsIfNeeded() throws {
        #if os(macOS) || os(Linux)
        try self.fileManager.setAttributes([
            .posixPermissions: NSNumber(value: Int16(0o600)),
        ], ofItemAtPath: self.fileURL.path)
        #endif
    }
}
