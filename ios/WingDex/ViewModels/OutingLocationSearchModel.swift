import Foundation
import Observation
import os

private let searchLog = Logger(subsystem: Config.bundleID, category: "LocationSearch")

/// Provides search functionality for places using geocoding.
@MainActor
protocol PlaceSearching: Sendable {
    func search(query: String) async throws -> [GeocodingResult]
}

extension GeocodingService: PlaceSearching {}

/// Default adapter for place searches supporting the `--ui-test-place-search-result` debug flag.
@MainActor
struct DefaultPlaceSearcher: PlaceSearching {
    private let service: PlaceSearching

    init(service: PlaceSearching) {
        self.service = service
    }

    init(auth: AuthService) {
        self.service = GeocodingService(auth: auth)
    }

    func search(query: String) async throws -> [GeocodingResult] {
        #if DEBUG
        if ProcessInfo.processInfo.arguments.contains("--ui-test-place-search-result") {
            return [
                GeocodingResult(
                    label: "Discovery Park",
                    context: "Seattle, Washington",
                    latitude: 47.6573,
                    longitude: -122.4066,
                    stateProvince: "US-WA",
                    countryCode: "US"
                )
            ]
        }
        #endif
        return try await service.search(query: query)
    }
}

/// Injectable clock abstraction for deterministic testing without wall-clock sleeps.
@MainActor
protocol SearchClock: Sendable {
    var now: Date { get }
}

struct SystemSearchClock: SearchClock {
    var now: Date { Date() }
}

/// Injectable sleeper abstraction for debouncing.
@MainActor
protocol SearchSleeper: Sendable {
    func sleep(for duration: Duration) async throws
}

struct SystemSearchSleeper: SearchSleeper {
    func sleep(for duration: Duration) async throws {
        try await Task.sleep(for: duration)
    }
}

/// Represents the search state of OutingLocationSearchModel.
enum OutingLocationSearchState: Equatable, Sendable {
    case idle
    case shortQuery
    case queryTooLong
    case loading
    case results([GeocodingResult])
    case empty(query: String)
    case failed
    case rateLimited(retryAfter: TimeInterval?)

    static func == (lhs: OutingLocationSearchState, rhs: OutingLocationSearchState) -> Bool {
        switch (lhs, rhs) {
        case (.idle, .idle), (.shortQuery, .shortQuery), (.queryTooLong, .queryTooLong), (.loading, .loading), (.failed, .failed):
            return true
        case let (.results(l), .results(r)):
            return l.map(\.id) == r.map(\.id)
        case let (.empty(l), .empty(r)):
            return l == r
        case let (.rateLimited(l), .rateLimited(r)):
            return l == r
        default:
            return false
        }
    }
}

/// Small, deterministic search model managing live place search, debouncing,
/// in-memory cache, in-flight deduplication, and flow-local rate limiting.
@MainActor
@Observable
final class OutingLocationSearchModel {
    private(set) var state: OutingLocationSearchState = .idle
    private(set) var query: String = ""
    private(set) var isSearching: Bool = false
    private(set) var isEditing: Bool = false

    /// Cleaned query for manual naming (outer whitespace trimmed only).
    var manualName: String {
        query.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    /// Normalized query for server search (trimmed and collapsed internal whitespace).
    var normalizedQuery: String {
        Self.normalize(query)
    }

    // Collaborators
    private let placeSearcher: PlaceSearching
    private let clock: SearchClock
    private let sleeper: SearchSleeper

    // Debounce & generation tracking
    private var searchTask: Task<Void, Never>?
    private var currentGeneration: Int = 0

    // Active in-flight network execution: one active search at a time with cancellation propagation
    private var activeSearchTask: Task<[GeocodingResult], Error>?
    private var activeSearchQuery: String?

    // Deduplication & caching
    private var cache: [String: [GeocodingResult]] = [:]
    private var cacheOrder: [String] = []
    private let maxCacheEntries: Int = 30

    // Flow-local rate budget: 20 outgoing requests per 60 seconds rolling window
    private var requestTimestamps: [Date] = []
    private let maxRequestsPerWindow: Int = 20
    private let windowDuration: TimeInterval = 60.0

    // Rate-limited cooldown
    private var rateLimitedUntil: Date?

    init(
        placeSearcher: PlaceSearching,
        clock: SearchClock = SystemSearchClock(),
        sleeper: SearchSleeper = SystemSearchSleeper()
    ) {
        self.placeSearcher = placeSearcher
        self.clock = clock
        self.sleeper = sleeper
    }

    /// Normalizes a query by trimming outer whitespace and collapsing consecutive whitespace into a single space.
    static func normalize(_ raw: String) -> String {
        let trimmed = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.components(separatedBy: .whitespacesAndNewlines)
            .filter { !$0.isEmpty }
            .joined(separator: " ")
    }

    // MARK: - Session Lifecycle

    /// Begins an editing session with prefilled text without kicking off a network search.
    func beginEditing(initialName: String) {
        cancelPendingWork()
        currentGeneration += 1
        query = initialName
        isEditing = false
        state = .idle
        isSearching = false
    }

    /// Ends the editing session, resetting query and temporary state while retaining cache and budget.
    func endEditing() {
        cancelPendingWork()
        currentGeneration += 1
        query = ""
        isEditing = false
        state = .idle
        isSearching = false
    }

    // MARK: - Query Updates

    /// Called on user text edit. Debounces by 500ms; starts search at 3 normalized characters.
    func updateQuery(_ newQuery: String) {
        query = newQuery
        isEditing = true
        let normalized = normalizedQuery

        if isSearching && activeSearchQuery == normalized {
            return
        }

        cancelPendingWork()
        currentGeneration += 1
        let generation = currentGeneration

        if normalized.isEmpty {
            state = .idle
            isSearching = false
            return
        }

        if normalized.utf16.count < 3 {
            state = .shortQuery
            isSearching = false
            return
        }

        if normalized.utf16.count > 200 {
            state = .queryTooLong
            isSearching = false
            return
        }

        if let cached = cache[normalized] {
            if cached.isEmpty {
                state = .empty(query: normalized)
            } else {
                state = .results(cached)
            }
            isSearching = false
            return
        }

        isSearching = true
        state = .loading

        searchTask = Task { [weak self] in
            do {
                guard let self else { return }
                try await self.sleeper.sleep(for: .milliseconds(500))
                try Task.checkCancellation()
                guard self.currentGeneration == generation else { return }

                await self.performSearch(normalized: normalized, generation: generation)
            } catch is CancellationError {
                guard let self, self.currentGeneration == generation else { return }
                self.state = .idle
                self.isSearching = false
                return
            } catch {
                guard let self, self.currentGeneration == generation, !Task.isCancelled else { return }
                searchLog.error("Place search debounce failed: \(error.localizedDescription)")
                self.state = .failed
                self.isSearching = false
            }
        }
    }

    /// Explicit search submission (e.g. keyboard Submit/Search or button tap).
    /// Bypasses the 500ms debounce, supports min 2 normalized characters, but respects rate limits and deduplication.
    func submitSearch() {
        isEditing = true
        let normalized = normalizedQuery

        // If already actively searching the exact same query, do not cancel or re-run
        if isSearching && activeSearchQuery == normalized {
            return
        }

        cancelPendingWork()
        currentGeneration += 1
        let generation = currentGeneration

        if normalized.isEmpty {
            state = .idle
            isSearching = false
            return
        }

        if normalized.utf16.count < 2 {
            state = .shortQuery
            isSearching = false
            return
        }

        if normalized.utf16.count > 200 {
            state = .queryTooLong
            isSearching = false
            return
        }

        if let cached = cache[normalized] {
            if cached.isEmpty {
                state = .empty(query: normalized)
            } else {
                state = .results(cached)
            }
            isSearching = false
            return
        }

        isSearching = true
        state = .loading

        searchTask = Task { [weak self] in
            guard let self else { return }
            await self.performSearch(normalized: normalized, generation: generation)
        }
    }

    /// Clears the query and returns to idle.
    func clear() {
        cancelPendingWork()
        currentGeneration += 1
        query = ""
        isEditing = true
        state = .idle
        isSearching = false
    }

    /// Cancels all picker-local search work without clearing cache or rate limit budget.
    func cancelWork() {
        cancelPendingWork()
        currentGeneration += 1
        isSearching = false
    }

    private func cancelPendingWork() {
        searchTask?.cancel()
        searchTask = nil
        activeSearchTask?.cancel()
        activeSearchTask = nil
        activeSearchQuery = nil
    }

    // MARK: - Search Execution

    private func performSearch(normalized: String, generation: Int) async {
        // Initial check before taking any action or recording budget
        guard currentGeneration == generation, !Task.isCancelled else { return }

        let now = clock.now

        // 1. Check rate-limit cooldown
        if let cooldownUntil = rateLimitedUntil {
            if now < cooldownUntil {
                let remaining = cooldownUntil.timeIntervalSince(now)
                let sanitizedRemaining = sanitizeCooldown(remaining)
                guard currentGeneration == generation, !Task.isCancelled else { return }
                state = .rateLimited(retryAfter: sanitizedRemaining)
                isSearching = false
                return
            } else {
                rateLimitedUntil = nil
            }
        }

        // 2. Check rolling window rate budget
        pruneOldTimestamps(now: now)
        if requestTimestamps.count >= maxRequestsPerWindow {
            let earliest = requestTimestamps.first ?? now
            let rawRetry = windowDuration - now.timeIntervalSince(earliest)
            let sanitizedRetry = sanitizeCooldown(rawRetry)
            rateLimitedUntil = now.addingTimeInterval(sanitizedRetry)
            guard currentGeneration == generation, !Task.isCancelled else { return }
            state = .rateLimited(retryAfter: sanitizedRetry)
            isSearching = false
            return
        }

        // 3. Kick off network request
        guard currentGeneration == generation, !Task.isCancelled else { return }

        requestTimestamps.append(now)
        let searcher = placeSearcher
        let task = Task<[GeocodingResult], Error> {
            try await searcher.search(query: normalized)
        }
        activeSearchTask = task
        activeSearchQuery = normalized

        do {
            let results = try await task.value

            if currentGeneration == generation {
                activeSearchTask = nil
                activeSearchQuery = nil
            }

            try Task.checkCancellation()
            guard currentGeneration == generation, !Task.isCancelled else { return }

            let trimmedResults = Array(results.prefix(5))
            saveToCache(query: normalized, results: trimmedResults)

            if trimmedResults.isEmpty {
                state = .empty(query: normalized)
            } else {
                state = .results(trimmedResults)
            }
            isSearching = false
        } catch is CancellationError {
            if currentGeneration == generation {
                activeSearchTask = nil
                activeSearchQuery = nil
            }
            return
        } catch let error as GeocodingServiceError {
            if currentGeneration == generation {
                activeSearchTask = nil
                activeSearchQuery = nil
            }
            guard currentGeneration == generation, !Task.isCancelled else { return }

            if case let .server(statusCode, _, retryAfter) = error, statusCode == 429 {
                let cooldownSeconds = sanitizeCooldown(retryAfter)
                rateLimitedUntil = clock.now.addingTimeInterval(cooldownSeconds)
                state = .rateLimited(retryAfter: cooldownSeconds)
            } else {
                state = .failed
            }
            isSearching = false
        } catch {
            if currentGeneration == generation {
                activeSearchTask = nil
                activeSearchQuery = nil
            }
            guard currentGeneration == generation, !Task.isCancelled else { return }
            searchLog.error("Place search failed: \(error.localizedDescription)")
            state = .failed
            isSearching = false
        }
    }

    private func pruneOldTimestamps(now: Date) {
        let cutoff = now.addingTimeInterval(-windowDuration)
        requestTimestamps.removeAll { $0 <= cutoff }
    }

    private func sanitizeCooldown(_ seconds: TimeInterval?) -> TimeInterval {
        guard let seconds, seconds.isFinite, seconds > 0 else {
            return windowDuration
        }
        return seconds
    }

    private func saveToCache(query: String, results: [GeocodingResult]) {
        if cache[query] == nil {
            if cacheOrder.count >= maxCacheEntries {
                let oldest = cacheOrder.removeFirst()
                cache.removeValue(forKey: oldest)
            }
            cacheOrder.append(query)
        }
        cache[query] = results
    }
}
