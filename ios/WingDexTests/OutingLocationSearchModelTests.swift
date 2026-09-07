import CoreLocation
import Observation
import XCTest
@testable import WingDex

// MARK: - Test Doubles

@MainActor
private final class ControlledSearchClock: SearchClock {
    var now: Date

    init(now: Date = Date(timeIntervalSince1970: 1_700_000_000)) {
        self.now = now
    }

    func advance(by interval: TimeInterval) {
        now = now.addingTimeInterval(interval)
    }
}

@MainActor
private final class ControllableSearchSleeper: SearchSleeper {
    private(set) var sleepCalls: [Duration] = []
    var shouldCancel = false
    var customError: Error?
    var onSleep: ((Duration) -> Void)?

    func sleep(for duration: Duration) async throws {
        sleepCalls.append(duration)
        onSleep?(duration)
        if shouldCancel {
            throw CancellationError()
        }
        if let customError {
            throw customError
        }
        await Task.yield()
        try Task.checkCancellation()
    }
}

private final class ThreadSafeCancellationProbe: @unchecked Sendable {
    private let lock = NSLock()
    private var _count = 0

    var count: Int {
        lock.withLock { _count }
    }

    func record() {
        lock.withLock { _count += 1 }
    }
}

private final class ContinuationBox<T: Sendable>: @unchecked Sendable {
    private let lock = NSLock()
    private var continuation: CheckedContinuation<T, Error>?

    func set(_ c: CheckedContinuation<T, Error>?) {
        lock.withLock { continuation = c }
    }

    func resume(with result: Result<T, Error>) {
        let c = lock.withLock { () -> CheckedContinuation<T, Error>? in
            let saved = continuation
            continuation = nil
            return saved
        }
        c?.resume(with: result)
    }
}

@MainActor
private final class ControllablePlaceSearcher: PlaceSearching {
    var searchResult: [GeocodingResult] = []
    var searchError: Error?
    private(set) var searchCalls: [String] = []

    let cancellationProbe = ThreadSafeCancellationProbe()
    var cancellationCount: Int { cancellationProbe.count }

    var onSearchStarted: ((String) -> Void)?
    var onCancellation: (() -> Void)?

    var shouldSuspend = false
    var respondsToCancellation = true
    private let continuationBox = ContinuationBox<[GeocodingResult]>()

    func search(query: String) async throws -> [GeocodingResult] {
        searchCalls.append(query)
        onSearchStarted?(query)

        if shouldSuspend {
            let box = self.continuationBox
            let probe = self.cancellationProbe
            let respondsToCancellation = self.respondsToCancellation
            return try await withTaskCancellationHandler {
                try await withCheckedThrowingContinuation { continuation in
                    box.set(continuation)
                }
            } onCancel: {
                probe.record()
                if respondsToCancellation {
                    box.resume(with: .failure(CancellationError()))
                }
            }
        }

        try Task.checkCancellation()
        if let searchError {
            throw searchError
        }
        return searchResult
    }

    func resumePending(with result: Result<[GeocodingResult], Error>) {
        continuationBox.resume(with: result)
    }
}

// MARK: - Tests

@MainActor
final class OutingLocationSearchModelTests: XCTestCase {
    private var searcher: ControllablePlaceSearcher!
    private var clock: ControlledSearchClock!
    private var sleeper: ControllableSearchSleeper!
    private var model: OutingLocationSearchModel!

    override func setUp() {
        super.setUp()
        searcher = ControllablePlaceSearcher()
        clock = ControlledSearchClock()
        sleeper = ControllableSearchSleeper()
        model = OutingLocationSearchModel(
            placeSearcher: searcher,
            clock: clock,
            sleeper: sleeper
        )
    }

    override func tearDown() {
        model = nil
        sleeper = nil
        clock = nil
        searcher = nil
        super.tearDown()
    }

    private func waitUntil(
        timeout: Duration = .seconds(2),
        predicate: @MainActor () -> Bool
    ) async -> Bool {
        let clock = ContinuousClock()
        let deadline = clock.now + timeout
        while clock.now < deadline {
            if predicate() {
                return true
            }
            await Task.yield()
        }
        return predicate()
    }

    // MARK: - Query Normalization and Character Boundaries

    func testQueryNormalizationTrimsAndCollapsesWhitespace() {
        XCTAssertEqual(OutingLocationSearchModel.normalize("   Discovery   Park   Seattle  \n"), "Discovery Park Seattle")
        XCTAssertEqual(OutingLocationSearchModel.normalize("Green   Lake"), "Green Lake")
        XCTAssertEqual(OutingLocationSearchModel.normalize("   "), "")
    }

    func testManualNameTrimsOnlyOuterWhitespace() {
        model.updateQuery("  Discovery   Park  ")
        XCTAssertEqual(model.manualName, "Discovery   Park")
        XCTAssertEqual(model.normalizedQuery, "Discovery Park")
    }

    func testEmptyQueryTransitionsToIdle() {
        model.updateQuery("")
        XCTAssertEqual(model.state, .idle)
        XCTAssertFalse(model.isSearching)
        XCTAssertTrue(searcher.searchCalls.isEmpty)
    }

    func testLiveQueryUTF16Boundaries() async {
        // UTF-16 count 1: shortQuery
        model.updateQuery("a")
        XCTAssertEqual(model.state, .shortQuery)
        XCTAssertFalse(model.isSearching)
        XCTAssertTrue(searcher.searchCalls.isEmpty)

        // UTF-16 count 2 (ascii): shortQuery
        model.updateQuery("ab")
        XCTAssertEqual(model.state, .shortQuery)
        XCTAssertFalse(model.isSearching)
        XCTAssertTrue(searcher.searchCalls.isEmpty)

        // UTF-16 count 2 (surrogate pair emoji): shortQuery
        model.updateQuery("🦅")
        XCTAssertEqual(model.state, .shortQuery)
        XCTAssertFalse(model.isSearching)
        XCTAssertTrue(searcher.searchCalls.isEmpty)

        // UTF-16 count 3: triggers debounce and search
        model.updateQuery("abc")
        let searched3 = await waitUntil { self.searcher.searchCalls == ["abc"] }
        XCTAssertTrue(searched3)

        // UTF-16 count 200: boundary allowed
        let exact200 = String(repeating: "a", count: 200)
        model.updateQuery(exact200)
        let searched200 = await waitUntil { self.searcher.searchCalls.contains(exact200) }
        XCTAssertTrue(searched200)

        // UTF-16 count 201: queryTooLong
        let over200 = String(repeating: "a", count: 201)
        model.updateQuery(over200)
        XCTAssertEqual(model.state, .queryTooLong)
        XCTAssertFalse(model.isSearching)
        XCTAssertEqual(model.manualName.count, 201)
    }

    func testExplicitSearchUTF16Boundaries() async {
        let sample = GeocodingResult(
            label: "WA",
            context: "United States",
            latitude: 47.0,
            longitude: -120.0,
            stateProvince: "US-WA",
            countryCode: "US"
        )
        searcher.searchResult = [sample]

        // Explicit search with count 1: shortQuery
        model.updateQuery("a")
        model.submitSearch()
        XCTAssertEqual(model.state, .shortQuery)
        XCTAssertTrue(searcher.searchCalls.isEmpty)

        // Explicit search with count 2 (ascii): allowed
        model.updateQuery("WA")
        model.submitSearch()
        let searched2 = await waitUntil { self.model.state == .results([sample]) }
        XCTAssertTrue(searched2)
        XCTAssertEqual(model.state, .results([sample]))

        // Explicit search with count 2 (emoji with 2 UTF-16 code units): allowed
        model.updateQuery("🦅")
        model.submitSearch()
        let searchedEmoji = await waitUntil { self.searcher.searchCalls.contains("🦅") }
        XCTAssertTrue(searchedEmoji)

        // Explicit search with count 200: allowed
        let exact200 = String(repeating: "b", count: 200)
        model.updateQuery(exact200)
        model.submitSearch()
        let searched200 = await waitUntil { self.searcher.searchCalls.contains(exact200) }
        XCTAssertTrue(searched200)

        // Explicit search with count 201: queryTooLong
        let over200 = String(repeating: "b", count: 201)
        model.updateQuery(over200)
        model.submitSearch()
        XCTAssertEqual(model.state, .queryTooLong)
        XCTAssertFalse(model.isSearching)
    }

    func testRejectedInvalidQueryCancelsPendingAndMakesNoSearchCalls() async {
        model.updateQuery("Valid")
        XCTAssertTrue(model.isSearching)
        XCTAssertEqual(model.state, .loading)

        // Reject with short query
        model.updateQuery("a")
        XCTAssertFalse(model.isSearching)
        XCTAssertEqual(model.state, .shortQuery)

        await Task.yield()
        XCTAssertTrue(searcher.searchCalls.isEmpty)

        // Reject with query too long
        model.updateQuery(String(repeating: "x", count: 201))
        XCTAssertFalse(model.isSearching)
        XCTAssertEqual(model.state, .queryTooLong)

        await Task.yield()
        XCTAssertTrue(searcher.searchCalls.isEmpty)
    }

    // MARK: - Debounce and Sleeper

    func testDebounceSleepDurationIs500ms() async {
        model.updateQuery("Discovery")
        let slept = await waitUntil { !self.sleeper.sleepCalls.isEmpty }
        XCTAssertTrue(slept)
        XCTAssertEqual(sleeper.sleepCalls, [.milliseconds(500)])
    }

    func testCanceledSleepExitsWithoutSearching() async {
        sleeper.shouldCancel = true
        model.updateQuery("Discovery")

        let canceled = await waitUntil { !self.model.isSearching }
        XCTAssertTrue(canceled)
        XCTAssertTrue(searcher.searchCalls.isEmpty)
        XCTAssertFalse(model.isSearching)
    }

    func testSleeperErrorSetsFailedState() async {
        struct TestSleepError: Error {}
        sleeper.customError = TestSleepError()
        model.updateQuery("Discovery")

        let failed = await waitUntil { self.model.state == .failed }
        XCTAssertTrue(failed)
        XCTAssertFalse(model.isSearching)
    }

    func testRapidEditsCancelEarlierTasksAndOnlyPerformLatestSearch() async {
        model.updateQuery("Disc")
        model.updateQuery("Disco")
        model.updateQuery("Discov")

        let completed = await waitUntil { self.searcher.searchCalls == ["Discov"] }
        XCTAssertTrue(completed)
        XCTAssertEqual(searcher.searchCalls, ["Discov"])
    }

    // MARK: - Session Lifecycle (beginEditing / endEditing / Reopen)

    func testBeginEditingPrefillsWithoutSearching() {
        model.beginEditing(initialName: "Discovery Park")

        XCTAssertEqual(model.query, "Discovery Park")
        XCTAssertFalse(model.isEditing)
        XCTAssertEqual(model.state, .idle)
        XCTAssertFalse(model.isSearching)
        XCTAssertTrue(searcher.searchCalls.isEmpty)
    }

    func testExplicitSearchOnUnchangedPrefillWorks() async {
        let sample = GeocodingResult(
            label: "Discovery Park",
            context: "Seattle, Washington",
            latitude: 47.6573,
            longitude: -122.4066,
            stateProvince: "US-WA",
            countryCode: "US"
        )
        searcher.searchResult = [sample]

        model.beginEditing(initialName: "Discovery Park")
        XCTAssertTrue(searcher.searchCalls.isEmpty)

        model.submitSearch()
        let completed = await waitUntil { self.model.state == .results([sample]) }
        XCTAssertTrue(completed)
        XCTAssertEqual(searcher.searchCalls, ["Discovery Park"])
    }

    func testEndEditingResetsQueryAndStateWhilePreservingCacheAndBudget() async {
        let sample = GeocodingResult(
            label: "Discovery Park",
            context: "Seattle, Washington",
            latitude: 47.6573,
            longitude: -122.4066,
            stateProvince: "US-WA",
            countryCode: "US"
        )
        searcher.searchResult = [sample]

        model.updateQuery("Discovery Park")
        let done = await waitUntil { self.model.state == .results([sample]) }
        XCTAssertTrue(done)
        XCTAssertEqual(searcher.searchCalls.count, 1)

        // Dismiss picker session
        model.endEditing()
        XCTAssertEqual(model.query, "")
        XCTAssertEqual(model.state, .idle)
        XCTAssertFalse(model.isSearching)
        XCTAssertFalse(model.isEditing)

        // Reopen picker session
        model.beginEditing(initialName: "Discovery Park")
        XCTAssertEqual(model.query, "Discovery Park")
        XCTAssertEqual(model.state, .idle)

        // Explicit search uses cached result without network call
        model.submitSearch()
        let cached = await waitUntil { self.model.state == .results([sample]) }
        XCTAssertTrue(cached)
        XCTAssertEqual(searcher.searchCalls.count, 1)
    }

    // MARK: - In-Flight Deduplication and Task Cancellation

    func testSameQueryExplicitInFlightDeduplication() async {
        searcher.shouldSuspend = true
        searcher.searchResult = []

        model.updateQuery("Discovery")
        let started = await waitUntil { self.searcher.searchCalls == ["Discovery"] }
        XCTAssertTrue(started)
        XCTAssertTrue(model.isSearching)

        // Duplicate explicit submit while active search is in-flight must not trigger a second request
        model.submitSearch()
        XCTAssertEqual(searcher.searchCalls.count, 1)

        searcher.resumePending(with: .success([]))
        let finished = await waitUntil { !self.model.isSearching }
        XCTAssertTrue(finished)
        XCTAssertEqual(searcher.searchCalls.count, 1)
    }

    func testSameQueryLiveUpdateWhileInFlightDoesNotRestart() async {
        searcher.shouldSuspend = true
        let sample = GeocodingResult(
            label: "Discovery Park", context: nil,
            latitude: 47.6, longitude: -122.4,
            stateProvince: "US-WA", countryCode: "US"
        )
        searcher.searchResult = [sample]

        model.updateQuery("Discovery")
        let started = await waitUntil { self.searcher.searchCalls == ["Discovery"] }
        XCTAssertTrue(started)

        // Typing whitespace that normalizes to the same query updates raw query for manual naming but does not restart in-flight search
        model.updateQuery("  Discovery  ")
        XCTAssertEqual(model.query, "  Discovery  ")
        XCTAssertEqual(model.manualName, "Discovery")
        XCTAssertEqual(searcher.searchCalls.count, 1)

        searcher.resumePending(with: .success([sample]))
        let finished = await waitUntil { !self.model.isSearching }
        XCTAssertTrue(finished)
        XCTAssertEqual(searcher.searchCalls.count, 1)
        XCTAssertEqual(model.state, .results([sample]))
    }

    func testCanceledNetworkTaskObservedViaCancellationHandler() async {
        searcher.shouldSuspend = true
        model.updateQuery("Discovery")

        let started = await waitUntil { self.searcher.searchCalls == ["Discovery"] }
        XCTAssertTrue(started)

        model.cancelWork()

        let cancelled = await waitUntil { self.searcher.cancellationCount == 1 }
        XCTAssertTrue(cancelled)
        XCTAssertFalse(model.isSearching)
    }

    func testLateSuccessIgnoredAfterQueryChanged() async {
        searcher.shouldSuspend = true
        searcher.respondsToCancellation = false
        model.updateQuery("FirstQuery")

        let started = await waitUntil { self.searcher.searchCalls == ["FirstQuery"] }
        XCTAssertTrue(started)

        // User switches query to SecondQuery
        searcher.shouldSuspend = false
        let secondResult = GeocodingResult(
            label: "Second Place", context: nil,
            latitude: 47.5, longitude: -122.5,
            stateProvince: "US-WA", countryCode: "US"
        )
        searcher.searchResult = [secondResult]
        model.updateQuery("SecondQuery")

        let secondDone = await waitUntil { self.model.state == .results([secondResult]) }
        XCTAssertTrue(secondDone)

        // Late response arrives from FirstQuery
        let firstResult = GeocodingResult(
            label: "First Place", context: nil,
            latitude: 47.1, longitude: -122.1,
            stateProvince: "US-WA", countryCode: "US"
        )
        let unchanged = expectNoStateChange()
        searcher.resumePending(with: .success([firstResult]))

        await fulfillment(of: [unchanged], timeout: 0.1)
        XCTAssertEqual(model.state, .results([secondResult]))
    }

    func testLateErrorIgnoredAfterQueryChangedOrNewSession() async {
        searcher.shouldSuspend = true
        searcher.respondsToCancellation = false
        model.updateQuery("FirstQuery")

        let started = await waitUntil { self.searcher.searchCalls == ["FirstQuery"] }
        XCTAssertTrue(started)

        // End editing session
        model.endEditing()
        XCTAssertEqual(model.state, .idle)

        // Late 429 error arrives from FirstQuery
        let unchanged = expectNoStateChange()
        searcher.resumePending(with: .failure(GeocodingServiceError.server(
            statusCode: 429,
            traceID: "stale-429",
            retryAfter: 30.0
        )))

        await fulfillment(of: [unchanged], timeout: 0.1)
        // Stale error must not transition current idle session to rateLimited
        XCTAssertEqual(model.state, .idle)
    }

    func testLateSuccessIgnoredAfterBeginEditing() async {
        searcher.shouldSuspend = true
        searcher.respondsToCancellation = false
        model.updateQuery("FirstQuery")

        let started = await waitUntil { self.searcher.searchCalls == ["FirstQuery"] }
        XCTAssertTrue(started)

        // Begin editing with new initial text increments generation
        model.beginEditing(initialName: "Prefilled Spot")
        XCTAssertEqual(model.query, "Prefilled Spot")
        XCTAssertEqual(model.state, .idle)

        // Stale response arrives from FirstQuery
        let staleResult = GeocodingResult(
            label: "Stale Place", context: nil,
            latitude: 47.1, longitude: -122.1,
            stateProvince: "US-WA", countryCode: "US"
        )
        let unchanged = expectNoStateChange()
        searcher.resumePending(with: .success([staleResult]))

        await fulfillment(of: [unchanged], timeout: 0.1)
        XCTAssertEqual(model.state, .idle)
    }

    private func expectNoStateChange() -> XCTestExpectation {
        let unchanged = expectation(description: "Canceled search cannot change picker state")
        unchanged.isInverted = true
        withObservationTracking {
            _ = model.state
        } onChange: {
            unchanged.fulfill()
        }
        return unchanged
    }

    // MARK: - In-Memory Cache

    func testSuccessfulResultIsCachedAndReusedWithoutNewSearch() async {
        let sample = GeocodingResult(
            label: "Discovery Park",
            context: "Seattle, Washington",
            latitude: 47.6573,
            longitude: -122.4066,
            stateProvince: "US-WA",
            countryCode: "US"
        )
        searcher.searchResult = [sample]

        model.updateQuery("Discovery")
        let done = await waitUntil { self.model.state == .results([sample]) }
        XCTAssertTrue(done)
        XCTAssertEqual(searcher.searchCalls, ["Discovery"])

        // Clear query then re-enter same normalized query
        model.clear()
        XCTAssertEqual(model.state, .idle)

        model.updateQuery("  Discovery  ")
        XCTAssertEqual(model.state, .results([sample]))
        XCTAssertEqual(searcher.searchCalls.count, 1)
    }

    func testEmptyResultsAreCachedAsEmpty() async {
        searcher.searchResult = []

        model.updateQuery("NowherePlace")
        let done = await waitUntil { self.model.state == .empty(query: "NowherePlace") }
        XCTAssertTrue(done)
        XCTAssertEqual(searcher.searchCalls, ["NowherePlace"])

        // Re-enter query hits cache immediately
        model.updateQuery("NowherePlace")
        XCTAssertEqual(model.state, .empty(query: "NowherePlace"))
        XCTAssertEqual(searcher.searchCalls.count, 1)
    }

    func testLimitsResultsToUpToFive() async {
        let results = (1...10).map { i in
            GeocodingResult(
                label: "Place \(i)",
                context: "Context",
                latitude: 47.0 + Double(i) * 0.01,
                longitude: -122.0,
                stateProvince: "US-WA",
                countryCode: "US"
            )
        }
        searcher.searchResult = results

        model.updateQuery("Park")
        let done = await waitUntil {
            if case .results(let places) = self.model.state {
                return places.count == 5
            }
            return false
        }
        XCTAssertTrue(done)

        if case .results(let places) = model.state {
            XCTAssertEqual(places.map(\.label), ["Place 1", "Place 2", "Place 3", "Place 4", "Place 5"])
        } else {
            XCTFail("Expected .results state")
        }
    }

    func testCacheEvictsOldestWhenExceedingThirtyEntries() async {
        searcher.searchResult = []

        // Fill cache with 30 entries (Query 0 through Query 29)
        for i in 0..<30 {
            model.updateQuery("Query \(i)")
            model.submitSearch()
            let completed = await waitUntil { self.model.state == .empty(query: "Query \(i)") }
            XCTAssertTrue(completed)
            clock.advance(by: 4)
        }
        XCTAssertEqual(searcher.searchCalls.count, 30)

        // Query 0 is currently cached; hitting it must not call search
        model.updateQuery("Query 0")
        XCTAssertEqual(searcher.searchCalls.count, 30)

        // Add 31st entry (Query 30); this must evict Query 0 (the oldest inserted)
        model.updateQuery("Query 30")
        model.submitSearch()
        let thirtyFirst = await waitUntil { self.model.state == .empty(query: "Query 30") }
        XCTAssertTrue(thirtyFirst)
        clock.advance(by: 4)

        // Query 0 should now be evicted from cache; submitting it triggers network call #32
        model.updateQuery("Query 0")
        model.submitSearch()
        let evictedSearch = await waitUntil { self.model.state == .empty(query: "Query 0") }
        XCTAssertTrue(evictedSearch)

        // Reinserting Query 0 also evicted Query 1; Query 2 remains cached.
        model.updateQuery("Query 2")
        XCTAssertEqual(searcher.searchCalls.count, 32)
    }

    // MARK: - Rate Limiting & Cooldown

    func testRolling20RequestBudgetEnforcesRateLimit() async {
        searcher.searchResult = []

        for i in 1...20 {
            model.updateQuery("Query \(i)")
            model.submitSearch()
            let completed = await waitUntil { self.searcher.searchCalls.count == i }
            XCTAssertTrue(completed)
            clock.advance(by: 1.0)
        }
        XCTAssertEqual(searcher.searchCalls.count, 20)

        // 21st query within window should be rate-limited
        model.updateQuery("Query 21")
        model.submitSearch()
        let rateLimited = await waitUntil {
            if case .rateLimited = self.model.state { return true }
            return false
        }
        XCTAssertTrue(rateLimited)
        XCTAssertEqual(searcher.searchCalls.count, 20)

        // Advance past window (60s)
        clock.advance(by: 61.0)

        model.updateQuery("Query 22")
        model.submitSearch()
        let allowed = await waitUntil { self.searcher.searchCalls.count == 21 }
        XCTAssertTrue(allowed)
    }

    func testRollingWindowCountsCanceledSentRequests() async {
        searcher.shouldSuspend = true
        model.updateQuery("CanceledQuery")
        model.submitSearch()

        let started = await waitUntil { self.searcher.searchCalls == ["CanceledQuery"] }
        XCTAssertTrue(started)

        // Cancel the in-flight request
        model.cancelWork()
        XCTAssertFalse(model.isSearching)

        searcher.shouldSuspend = false
        searcher.searchResult = []

        // Send 19 more requests (making 20 total sent within window)
        for i in 2...20 {
            clock.advance(by: 1.0)
            model.updateQuery("Query \(i)")
            model.submitSearch()
            let completed = await waitUntil { self.searcher.searchCalls.count == i }
            XCTAssertTrue(completed)
        }
        XCTAssertEqual(searcher.searchCalls.count, 20)

        // 21st query at T = 20s must be rate limited because the 1st canceled sent request was counted
        clock.advance(by: 1.0)
        model.updateQuery("Query 21")
        model.submitSearch()

        let rateLimited = await waitUntil {
            if case .rateLimited = self.model.state { return true }
            return false
        }
        XCTAssertTrue(rateLimited)
        XCTAssertEqual(searcher.searchCalls.count, 20)
    }

    func testExact60SecondBoundaryPruning() async {
        searcher.searchResult = []

        for i in 1...20 {
            model.updateQuery("Query \(i)")
            model.submitSearch()
            let completed = await waitUntil { self.searcher.searchCalls.count == i }
            XCTAssertTrue(completed)
        }
        XCTAssertEqual(searcher.searchCalls.count, 20)

        // At T = 59.9s, still rate limited
        clock.advance(by: 59.9)
        model.updateQuery("Query 21")
        model.submitSearch()
        let rateLimited = await waitUntil {
            if case .rateLimited = self.model.state { return true }
            return false
        }
        XCTAssertTrue(rateLimited)
        XCTAssertEqual(searcher.searchCalls.count, 20)

        // Advance 0.1s to reach exact 60.0s boundary: initial timestamps are pruned
        clock.advance(by: 0.1)
        model.updateQuery("Query 22")
        model.submitSearch()
        let allowed = await waitUntil { self.searcher.searchCalls.count == 21 }
        XCTAssertTrue(allowed)
        XCTAssertEqual(searcher.searchCalls.count, 21)
    }

    func testHTTP429PositiveRetryAfter() async {
        searcher.searchError = GeocodingServiceError.server(
            statusCode: 429,
            traceID: "trace-429",
            retryAfter: 15.0
        )

        model.updateQuery("Discovery")
        let rateLimited = await waitUntil {
            if case let .rateLimited(retryAfter) = self.model.state {
                return retryAfter == 15.0
            }
            return false
        }
        XCTAssertTrue(rateLimited)
    }

    func testHTTP429SanitizesNilZeroNegativeNaNAndInfiniteRetryAfter() async {
        let testCases: [TimeInterval?] = [nil, 0.0, -10.0, Double.nan, Double.infinity]

        for (index, retry) in testCases.enumerated() {
            searcher.searchError = GeocodingServiceError.server(
                statusCode: 429,
                traceID: "trace-\(index)",
                retryAfter: retry
            )
            model.updateQuery("ErrorQuery \(index)")
            model.submitSearch()

            let isRateLimited = await waitUntil {
                if case let .rateLimited(retryAfter) = self.model.state {
                    return retryAfter == 60.0
                }
                return false
            }
            XCTAssertTrue(isRateLimited, "Failed for retryAfter: \(String(describing: retry))")
            clock.advance(by: 65.0)
        }
    }

    func testNoAutomaticBacklogWhenRateLimited() async {
        searcher.searchError = GeocodingServiceError.server(
            statusCode: 429,
            traceID: "trace-backlog",
            retryAfter: 30.0
        )

        model.updateQuery("Discovery")
        model.submitSearch()
        let rateLimited = await waitUntil {
            if case .rateLimited = self.model.state { return true }
            return false
        }
        XCTAssertTrue(rateLimited)
        XCTAssertEqual(searcher.searchCalls.count, 1)

        // Advance clock past cooldown
        clock.advance(by: 40.0)
        await Task.yield()

        // Rate-limited state does not auto-fire; remains rateLimited until explicit user action
        XCTAssertEqual(model.state, .rateLimited(retryAfter: 30.0))
        XCTAssertEqual(searcher.searchCalls.count, 1)

        // User action triggers new request
        searcher.searchError = nil
        searcher.searchResult = []
        model.submitSearch()
        let searched = await waitUntil { self.searcher.searchCalls.count == 2 }
        XCTAssertTrue(searched)
    }

    func testNetworkFailureSetsFailedStateNotStateEmpty() async {
        searcher.searchError = GeocodingServiceError.server(
            statusCode: 500,
            traceID: "trace-500",
            retryAfter: nil
        )

        model.updateQuery("Discovery")
        let failed = await waitUntil { self.model.state == .failed }
        XCTAssertTrue(failed)
        XCTAssertFalse(model.isSearching)
        XCTAssertNotEqual(model.state, .empty(query: "Discovery"))

        // Reset error, test that empty results yield .empty instead of .failed
        searcher.searchError = nil
        searcher.searchResult = []
        model.updateQuery("OtherQuery")
        let empty = await waitUntil { self.model.state == .empty(query: "OtherQuery") }
        XCTAssertTrue(empty)
        XCTAssertNotEqual(model.state, .failed)
    }

    func testClearResetsStateAndQuery() {
        model.updateQuery("Some Query")
        model.clear()

        XCTAssertEqual(model.query, "")
        XCTAssertTrue(model.isEditing)
        XCTAssertEqual(model.state, .idle)
        XCTAssertFalse(model.isSearching)
    }

    func testCancelWorkCancelsWithoutClearingQuery() async {
        searcher.shouldSuspend = true
        model.updateQuery("Discovery")
        let started = await waitUntil { self.searcher.searchCalls == ["Discovery"] }
        XCTAssertTrue(started)

        model.cancelWork()

        XCTAssertFalse(model.isSearching)
        XCTAssertEqual(model.query, "Discovery")
    }
}
