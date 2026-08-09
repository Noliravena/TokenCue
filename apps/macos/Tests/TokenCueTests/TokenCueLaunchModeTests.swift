import Testing
@testable import TokenCue

struct TokenCueLaunchModeTests {
    @Test
    func `normal launch starts the application`() {
        #expect(TokenCueLaunchMode.resolve(arguments: ["/Applications/TokenCue"]) == .application)
    }

    @Test
    func `hook event launch skips application initialization`() {
        #expect(TokenCueLaunchMode.resolve(
            arguments: ["/Applications/TokenCue", "--hook-event"]) == .hookEvent)
    }

    @Test
    func `hook event is recognized among other arguments`() {
        #expect(TokenCueLaunchMode.resolve(
            arguments: ["/Applications/TokenCue", "--verbose", "--hook-event"]) == .hookEvent)
    }

    @Test
    func `similar argument still starts the application`() {
        #expect(TokenCueLaunchMode.resolve(
            arguments: ["/Applications/TokenCue", "--hook-events"]) == .application)
    }
}
