#if os(macOS)
import SweetCookieKit

public typealias BrowserCookieImportOrder = [Browser]

public enum TokenCueBrowserPolicy {
    /// Cross-platform browser set shared with Windows. Safari-only storage is
    /// intentionally outside TokenCue's product contract.
    public static let supportedCookieSources: BrowserCookieImportOrder = [
        .chrome,
        .edge,
        .brave,
        .firefox,
    ]

    public static func supports(_ browser: Browser) -> Bool {
        self.supportedCookieSources.contains(browser)
    }
}
#else
public struct Browser: Sendable, Hashable {
    public init() {}
}

public typealias BrowserCookieImportOrder = [Browser]

public enum TokenCueBrowserPolicy {
    public static let supportedCookieSources: BrowserCookieImportOrder = []
    public static func supports(_: Browser) -> Bool { false }
}
#endif

extension [Browser] {
    /// Filters a browser list to sources worth attempting for cookie imports.
    ///
    /// This is intentionally stricter than "app installed": it aims to avoid unnecessary Keychain prompts.
    public func cookieImportCandidates(using detection: BrowserDetection) -> [Browser] {
        let candidates = self.filter { browser in
            guard TokenCueBrowserPolicy.supports(browser) else { return false }
            if KeychainAccessGate.isDisabled, browser.usesKeychainForCookieDecryption {
                return false
            }
            return detection.isCookieSourceAvailable(browser)
        }
        return candidates.filter { BrowserCookieAccessGate.shouldAttempt($0) }
    }

    /// Filters a browser list to sources with usable profile data on disk.
    public func browsersWithProfileData(using detection: BrowserDetection) -> [Browser] {
        self.filter { detection.hasUsableProfileData($0) }
    }
}

#if os(macOS)
extension Browser {
    var usesKeychainForCookieDecryption: Bool {
        switch self {
        case .safari, .firefox, .firefoxBeta, .firefoxDeveloperEdition, .firefoxNightly, .zen:
            return false
        case .chrome, .chromeBeta, .chromeCanary,
             .arc, .arcBeta, .arcCanary,
             .chatgptAtlas,
             .chromium,
             .brave, .braveBeta, .braveNightly,
             .edge, .edgeBeta, .edgeCanary,
             .helium,
             .vivaldi,
             .dia,
             .yandex,
             .comet:
            return true
        @unknown default:
            return true
        }
    }
}
#else
extension Browser {
    var usesKeychainForCookieDecryption: Bool {
        false
    }
}
#endif
