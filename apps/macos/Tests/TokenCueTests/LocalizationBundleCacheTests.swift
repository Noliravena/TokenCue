import Foundation
import Testing
@testable import TokenCue

/// Regression coverage for the localized-bundle caching added for #1347.
///
/// The cache is process-global and these tests run in a parallel suite, so identity (`===`) assertions
/// would race against any other test that resolves a different language. Instead these assert the
/// concurrency-safe property that matters for correctness: every call resolves to the right `.lproj`
/// regardless of what is currently cached, so a language switch (and switch-back) is always honored and
/// the cache can never serve a stale localization.
struct LocalizationBundleCacheTests {
    @Test
    func `resolves the correct lproj per language and re-resolves on switch`() {
        resetTokenCueLocalizationCacheForTesting()

        let fr = TokenCueLocalizationOverride.$appLanguage.withValue("fr") {
            tokenCueLocalizedBundleForTesting()
        }
        #expect(fr.bundleURL.lastPathComponent == "fr.lproj")

        // Switching language must re-resolve rather than return the cached French bundle.
        let es = TokenCueLocalizationOverride.$appLanguage.withValue("es") {
            tokenCueLocalizedBundleForTesting()
        }
        #expect(es.bundleURL.lastPathComponent == "es.lproj")

        // Switching back must still produce the French bundle (cache key is the language).
        let frAgain = TokenCueLocalizationOverride.$appLanguage.withValue("fr") {
            tokenCueLocalizedBundleForTesting()
        }
        #expect(frAgain.bundleURL.lastPathComponent == "fr.lproj")
    }

    @Test
    func `repeated same-language calls keep resolving the same lproj`() {
        resetTokenCueLocalizationCacheForTesting()

        for _ in 0..<5 {
            let bundle = TokenCueLocalizationOverride.$appLanguage.withValue("es") {
                tokenCueLocalizedBundleForTesting()
            }
            #expect(bundle.bundleURL.lastPathComponent == "es.lproj")
        }
    }

    @Test
    func `unknown language falls back to en lproj`() {
        resetTokenCueLocalizationCacheForTesting()

        let bundle = TokenCueLocalizationOverride.$appLanguage.withValue("zz-unknown") {
            tokenCueLocalizedBundleForTesting()
        }
        #expect(bundle.bundleURL.lastPathComponent == "en.lproj")
    }

    @Test
    func `format locale follows the resolved resource bundle`() {
        let english = TokenCueLocalizationOverride.$appLanguage.withValue("en") {
            tokenCueLocalizedResourceLocale()
        }
        #expect(english.language.languageCode?.identifier == "en")

        let fallback = TokenCueLocalizationOverride.$appLanguage.withValue("zz-unknown") {
            tokenCueLocalizedResourceLocale()
        }
        #expect(fallback.language.languageCode?.identifier == "en")
    }

    @Test
    func `resource locale expands English stringsdict singular forms`() {
        let rendered = TokenCueLocalizationOverride.$appLanguage.withValue("en") {
            String(
                format: L("≈%d full 5h windows of weekly left · %d windows until reset"),
                locale: tokenCueLocalizedResourceLocale(),
                arguments: [1, 1])
        }

        #expect(rendered == "≈1 full 5h window of weekly left · 1 window until reset")
    }

    @Test
    func `resolution survives an explicit cache reset`() {
        let first = TokenCueLocalizationOverride.$appLanguage.withValue("uk") {
            tokenCueLocalizedBundleForTesting()
        }
        #expect(first.bundleURL.lastPathComponent == "uk.lproj")

        resetTokenCueLocalizationCacheForTesting()

        let afterReset = TokenCueLocalizationOverride.$appLanguage.withValue("uk") {
            tokenCueLocalizedBundleForTesting()
        }
        #expect(afterReset.bundleURL.lastPathComponent == "uk.lproj")
    }
}
