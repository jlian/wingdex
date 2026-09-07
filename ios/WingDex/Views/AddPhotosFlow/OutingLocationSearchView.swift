import CoreLocation
import SwiftUI

/// Sheet-local query stays separate from the accepted outing until a selection is made.
struct OutingLocationSearchView: View {
    @Bindable var reviewModel: OutingLocationReviewModel
    @Bindable var searchModel: OutingLocationSearchModel
    var onDismiss: () -> Void

    @Environment(\.dismiss) private var dismiss
    @State private var searchText: String = ""

    /// Initializes OutingLocationSearchView with review model, search model, and an optional dismissal callback.
    init(
        reviewModel: OutingLocationReviewModel,
        searchModel: OutingLocationSearchModel,
        onDismiss: @escaping () -> Void = {}
    ) {
        self.reviewModel = reviewModel
        self.searchModel = searchModel
        self.onDismiss = onDismiss
    }

    var body: some View {
        List {
            // Common visible status area for model errors (e.g., rejected invalid coordinates)
            if let err = reviewModel.currentLocationError {
                Section {
                    Text(err)
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                        .accessibilityIdentifier("outing.currentLocationError")
                }
            }

            // 1. Initial State: Current selection, suggestions, and restore actions (when search text is unchanged or empty)
            if isShowingInitialSuggestions {
                initialSuggestionsSection
            }

            // 2. Explicit Manual Name Row (visible whenever user entered a non-empty query)
            if shouldShowManualNameRow {
                manualNameSection
            }

            // 3. Search Results or State Messages (when query is being searched)
            if !searchModel.normalizedQuery.isEmpty {
                searchResultsSection
            }

            // 4. Provider Attribution Footer
            Section {
                EmptyView()
            } footer: {
                locationAttributionFooter
            }
        }
        .listStyle(.insetGrouped)
        .scrollContentBackground(.hidden)
        .background(Color.pageBg.ignoresSafeArea())
        .scrollDismissesKeyboard(.interactively)
        .navigationTitle("Adjust Location")
        .navigationBarTitleDisplayMode(.inline)
        .safeAreaInset(edge: .top, spacing: 0) {
            LocationSearchField(text: $searchText, onSubmit: searchModel.submitSearch)
                .padding(.horizontal)
                .padding(.vertical, 8)
                .background(Color.pageBg)
        }
        .toolbar {
            ToolbarItem(placement: .cancellationAction) {
                Button("Close", systemImage: "xmark") {
                    handleDisappear()
                    dismiss()
                }
                .labelStyle(.iconOnly)
                .accessibilityIdentifier("outing.locationClose")
            }
        }
        .onAppear {
            setupInitialState()
        }
        .onChange(of: searchText) { oldValue, newValue in
            handleSearchTextChange(from: oldValue, to: newValue)
        }
        .onDisappear {
            handleDisappear()
        }
    }

    // MARK: - Initial State & Suggestion Sections

    private var isShowingInitialSuggestions: Bool {
        // Show initial suggestions before any user edit, or when query is cleared
        !searchModel.isEditing || searchModel.query.isEmpty
    }

    @ViewBuilder
    private var initialSuggestionsSection: some View {
        // Current Selection (if named)
        if !reviewModel.acceptedSelection.name.isEmpty {
            Section {
                HStack {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(reviewModel.acceptedSelection.name)
                        Text(reviewModel.sourceStatusSummary)
                            .font(.subheadline)
                            .foregroundStyle(.secondary)
                    }
                    Spacer()
                    Image(systemName: "checkmark")
                        .foregroundStyle(Color.accentColor)
                }
                .accessibilityIdentifier("outing.currentSelectionRow")
            } header: {
                Text("Current Selection")
            }
        }

        // Current Location (ONLY when no coordinates exist)
        if reviewModel.canRequestCurrentLocation || reviewModel.isLocatingCurrentLocation {
            Section {
                if reviewModel.isLocatingCurrentLocation {
                    HStack(spacing: 8) {
                        ProgressView()
                            .controlSize(.small)
                        Text("Getting current location...")
                            .font(.subheadline)
                            .foregroundStyle(.secondary)
                        Spacer()
                        Button("Cancel") {
                            reviewModel.cancelAllWork()
                        }
                        .accessibilityIdentifier("outing.currentLocationCancel")
                    }
                    .frame(minHeight: 44)
                } else {
                    Button {
                        reviewModel.requestCurrentLocation {
                            finishAndDismiss()
                        }
                    } label: {
                        Label("Use current location", systemImage: "location")
                    }
                    .accessibilityIdentifier("outing.useCurrentLocation")
                }
            }
        }

        // Restore Source Suggestion (if different from accepted)
        if shouldShowRestoreSuggestion, let suggestion = reviewModel.sourceSuggestion {
            Section {
                Button {
                    reviewModel.restoreSourceSuggestion()
                    finishAndDismiss()
                } label: {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(suggestion.source == .currentLocation
                             ? "Use current location: \(suggestion.name)"
                             : "Use GPS: \(suggestion.name)")
                            .foregroundStyle(Color.accentColor)
                        if let region = formattedRegion(state: suggestion.stateProvince, country: suggestion.countryCode) {
                            Text(region)
                                .font(.subheadline)
                                .foregroundStyle(.secondary)
                        }
                    }
                }
                .accessibilityIdentifier("outing.locationRestore")
            }
        }

        // Nearby Places (from source reverse lookup)
        if let nearby = reviewModel.sourceSuggestion?.nearbyPlaces, !nearby.isEmpty {
            let filteredNearby = nearby.filter { place in
                place.label != reviewModel.acceptedSelection.name
                    && (!shouldShowRestoreSuggestion || place.label != reviewModel.sourceSuggestion?.name)
            }
            if !filteredNearby.isEmpty {
                Section {
                    ForEach(filteredNearby) { place in
                        Button {
                            reviewModel.commitNearbySelection(place)
                            finishAndDismiss()
                        } label: {
                            VStack(alignment: .leading, spacing: 2) {
                                Text(place.label)
                                if let context = place.context {
                                    Text(context)
                                        .font(.subheadline)
                                        .foregroundStyle(.secondary)
                                }
                            }
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .contentShape(Rectangle())
                        }
                        .buttonStyle(.plain)
                        .accessibilityIdentifier("outing.locationNearbyResult")
                    }
                } header: {
                    Text(reviewModel.sourceSuggestion?.source == .currentLocation
                         ? "Near your current location"
                         : "Near your photos")
                }
            }
        }
    }

    private var shouldShowRestoreSuggestion: Bool {
        guard let suggestion = reviewModel.sourceSuggestion else { return false }
        return suggestion.name != reviewModel.acceptedSelection.name ||
               suggestion.source != reviewModel.acceptedSelection.source ||
               suggestion.coordinate.latitude != reviewModel.acceptedSelection.coordinate?.latitude ||
               suggestion.coordinate.longitude != reviewModel.acceptedSelection.coordinate?.longitude
    }

    // MARK: - Manual Name Section

    private var shouldShowManualNameRow: Bool {
        let manual = searchModel.manualName
        guard !manual.isEmpty else { return false }
        return manual != reviewModel.acceptedSelection.name
    }

    private var manualNameSection: some View {
        Section {
            Button {
                reviewModel.commitManualName(searchModel.manualName)
                finishAndDismiss()
            } label: {
                VStack(alignment: .leading, spacing: 2) {
                    Text("Use \"\(searchModel.manualName)\"")
                        .font(.body.weight(.medium))
                        .foregroundStyle(Color.accentColor)
                    Text(reviewModel.validCoordinate != nil
                         ? "Keep existing coordinates"
                         : "Name only (no GPS)")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityIdentifier("outing.useEnteredName")
        }
    }

    // MARK: - Search Results Section

    @ViewBuilder
    private var searchResultsSection: some View {
        switch searchModel.state {
        case .idle, .shortQuery:
            EmptyView()

        case .queryTooLong:
            Section {
                Text("Search query exceeds 200 characters. Use entered name above for manual naming.")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                    .padding(.vertical, 4)
            }

        case .loading:
            Section {
                HStack(spacing: 8) {
                    ProgressView()
                        .controlSize(.small)
                    Text("Searching places...")
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                }
                .frame(maxWidth: .infinity, alignment: .center)
                .padding(.vertical, 8)
                .accessibilityIdentifier("outing.placeSearchLoading")
            }

        case .results(let places):
            Section {
                ForEach(places) { place in
                    Button {
                        if reviewModel.commitPlaceSearchSelection(place) {
                            finishAndDismiss()
                        }
                    } label: {
                        VStack(alignment: .leading, spacing: 2) {
                            Text(place.label)
                            if let context = place.context {
                                Text(context)
                                    .font(.subheadline)
                                    .foregroundStyle(.secondary)
                            }
                        }
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    .accessibilityIdentifier("outing.locationResult")
                }
            } header: {
                Text("Search Results")
            }

        case .empty(let query):
            Section {
                Text("No places found for \"\(query)\".")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                    .frame(maxWidth: .infinity, alignment: .center)
                    .padding(.vertical, 8)
                    .accessibilityIdentifier("outing.placeSearchEmpty")
            }

        case .failed:
            Section {
                VStack(spacing: 8) {
                    Text("Couldn't search for places.")
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                    Button("Retry") {
                        searchModel.submitSearch()
                    }
                    .buttonStyle(.bordered)
                    .accessibilityIdentifier("outing.placeSearchRetry")
                }
                .frame(maxWidth: .infinity, alignment: .center)
                .padding(.vertical, 8)
                .accessibilityIdentifier("outing.placeSearchFailed")
            }

        case .rateLimited:
            Section {
                VStack(alignment: .leading, spacing: 4) {
                    Text("Search temporarily paused.")
                        .font(.subheadline.weight(.medium))
                    Text("Try again shortly, or use the entered name.")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                    Button("Retry") {
                        searchModel.submitSearch()
                    }
                    .buttonStyle(.bordered)
                    .padding(.top, 4)
                }
                .padding(.vertical, 4)
                .accessibilityIdentifier("outing.placeSearchRateLimited")
            }
        }
    }

    // MARK: - Attribution Footer

    private var locationAttributionFooter: some View {
        Text("Powered by [Geoapify](https://www.geoapify.com/) and [OpenStreetMap](https://www.openstreetmap.org/copyright)")
            .font(.footnote)
            .foregroundStyle(.secondary)
            .tint(Color.accentColor)
            .accessibilityIdentifier("outing.locationAttribution")
    }

    // MARK: - Helpers

    private func setupInitialState() {
        let initialName = reviewModel.acceptedSelection.name
        searchText = initialName
        searchModel.beginEditing(initialName: initialName)
    }

    private func handleSearchTextChange(from oldValue: String, to newValue: String) {
        // If query was cleared
        if newValue.isEmpty {
            reviewModel.cancelAllWork()
            searchModel.clear()
            return
        }

        // Before user has edited, if searchText changes but matches prefilled initialName and model is not editing, don't trigger search
        if !searchModel.isEditing && newValue == searchModel.query {
            return
        }

        // Actual user edit: cancel competing review reverse geocode or current location work,
        // then update search model with debounce
        reviewModel.cancelAllWork()
        searchModel.updateQuery(newValue)
    }

    private func handleDisappear() {
        searchModel.endEditing()
        reviewModel.cancelAllWork()
    }

    private func finishAndDismiss() {
        searchModel.endEditing()
        onDismiss()
        dismiss()
    }

    private func formattedRegion(state: String?, country: String?) -> String? {
        let parts = [state, country].compactMap { $0 }.filter { !$0.isEmpty }
        return parts.isEmpty ? nil : parts.joined(separator: ", ")
    }
}

// A native search field keeps the query at the top without a second modal Cancel control.
private struct LocationSearchField: UIViewRepresentable {
    @Binding var text: String
    let onSubmit: () -> Void

    func makeCoordinator() -> Coordinator { Coordinator(parent: self) }

    func makeUIView(context: Context) -> FocusedSearchTextField {
        let field = FocusedSearchTextField()
        field.placeholder = "Search places"
        field.accessibilityIdentifier = "outing.locationQuery"
        field.accessibilityTraits.insert(.searchField)
        field.returnKeyType = .search
        field.autocorrectionType = .no
        field.font = .preferredFont(forTextStyle: .body)
        field.adjustsFontForContentSizeCategory = true
        field.clearButtonMode = .whileEditing
        field.delegate = context.coordinator
        field.addTarget(context.coordinator, action: #selector(Coordinator.changed(_:)), for: .editingChanged)
        return field
    }

    func updateUIView(_ field: FocusedSearchTextField, context: Context) {
        context.coordinator.parent = self
        if field.text != text { field.text = text }
    }

    func sizeThatFits(_ proposal: ProposedViewSize, uiView: FocusedSearchTextField, context: Context) -> CGSize? {
        CGSize(width: proposal.width ?? 0, height: max(44, uiView.intrinsicContentSize.height))
    }

    final class FocusedSearchTextField: UISearchTextField {
        private var hasFocused = false

        override func didMoveToWindow() {
            super.didMoveToWindow()
            if window != nil && !hasFocused {
                hasFocused = true
                becomeFirstResponder()
            }
        }
    }

    final class Coordinator: NSObject, UITextFieldDelegate {
        var parent: LocationSearchField

        init(parent: LocationSearchField) { self.parent = parent }

        @objc func changed(_ field: UITextField) {
            parent.text = field.text ?? ""
        }

        func textFieldShouldReturn(_ textField: UITextField) -> Bool {
            parent.onSubmit()
            return false
        }
    }
}

// MARK: - Previews

#if DEBUG
private final class PreviewPlaceSearcher: PlaceSearching {
    func search(query: String) async throws -> [GeocodingResult] {
        if ProcessInfo.processInfo.arguments.contains("--ui-test-place-search-result") {
            return [
                GeocodingResult(
                    label: "Discovery Park",
                    context: "Seattle, Washington",
                    latitude: 47.6573,
                    longitude: -122.4066,
                    stateProvince: "Washington",
                    countryCode: "US"
                )
            ]
        }
        return [
            GeocodingResult(
                label: "Discovery Park",
                context: "Seattle, Washington",
                latitude: 47.6573,
                longitude: -122.4066,
                stateProvince: "US-WA",
                countryCode: "US"
            ),
            GeocodingResult(
                label: "Green Lake",
                context: "Seattle, Washington",
                latitude: 47.68,
                longitude: -122.33,
                stateProvince: "US-WA",
                countryCode: "US"
            )
        ]
    }
}

private final class PreviewReverseLookup: LocationReverseGeocodingLookup {
    func reverse(
        latitude: Double,
        longitude: Double
    ) async throws -> (result: GeocodingResult?, nearby: [GeocodingResult], regionCodes: GeocodingService.RegionCodes?, timeZone: String?) {
        let sample = GeocodingResult(
            label: "Carkeek Park",
            context: "Seattle, Washington",
            latitude: latitude,
            longitude: longitude,
            stateProvince: "US-WA",
            countryCode: "US"
        )
        return (sample, [sample], .init(stateProvince: "US-WA", countryCode: "US"), "America/Los_Angeles")
    }
}

#Preview("Initial Suggestions with GPS") {
    NavigationStack {
        let reviewModel = OutingLocationReviewModel(geocodingLookup: PreviewReverseLookup())
        let cluster = PhotoCluster(
            photos: [],
            startTime: Date(),
            endTime: Date(),
            centerLat: 47.7115,
            centerLon: -122.3717
        )
        let searchModel = OutingLocationSearchModel(placeSearcher: PreviewPlaceSearcher())
        OutingLocationSearchView(reviewModel: reviewModel, searchModel: searchModel)
            .onAppear {
                reviewModel.configure(for: cluster, useGeoContext: false)
            }
    }
}

#Preview("No GPS - Current Location Available") {
    NavigationStack {
        let reviewModel = OutingLocationReviewModel(geocodingLookup: PreviewReverseLookup())
        let searchModel = OutingLocationSearchModel(placeSearcher: PreviewPlaceSearcher())
        OutingLocationSearchView(reviewModel: reviewModel, searchModel: searchModel)
            .onAppear {
                reviewModel.configure(for: nil, useGeoContext: false)
            }
    }
}
#endif
