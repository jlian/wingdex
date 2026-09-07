import MapKit
import SwiftUI

struct OutingMapLocation: Equatable {
    let name: String
    let latitude: Double
    let longitude: Double
    let sourceDescription: String

    init?(name: String, coordinate: CLLocationCoordinate2D?, sourceDescription: String) {
        guard let coordinate, CLLocationCoordinate2DIsValid(coordinate) else { return nil }
        self.name = name.isEmpty ? "Outing" : name
        latitude = coordinate.latitude
        longitude = coordinate.longitude
        self.sourceDescription = sourceDescription
    }

    var coordinate: CLLocationCoordinate2D {
        CLLocationCoordinate2D(latitude: latitude, longitude: longitude)
    }

    var cameraPosition: MapCameraPosition {
        .camera(MapCamera(centerCoordinate: coordinate, distance: 3000))
    }
}

struct OutingLocationMapPreview: View {
    let location: OutingMapLocation
    let onOpen: () -> Void
    @State private var camera: MapCameraPosition

    init(location: OutingMapLocation, onOpen: @escaping () -> Void) {
        self.location = location
        self.onOpen = onOpen
        _camera = State(initialValue: location.cameraPosition)
    }

    var body: some View {
        Button(action: onOpen) {
            ZStack {
                Map(position: $camera, interactionModes: []) {
                    Marker(location.name, coordinate: location.coordinate)
                }
                .allowsHitTesting(false)
                Color.clear
            }
            .frame(height: 200)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityElement(children: .ignore)
        .accessibilityAddTraits(.isButton)
        .accessibilityLabel("View location on map")
        .accessibilityValue(location.name)
        .accessibilityHint("Opens a map you can pan and zoom.")
        .accessibilityIdentifier("outing.mapPreview")
        .onChange(of: location) { _, updated in
            camera = updated.cameraPosition
        }
    }
}

struct OutingLocationMapView: View {
    let location: OutingMapLocation
    @Environment(\.dismiss) private var dismiss
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var camera: MapCameraPosition
    @State private var showMapsError = false
    #if DEBUG
    @State private var observedCameraValue = ""
    #endif

    init(location: OutingMapLocation) {
        self.location = location
        _camera = State(initialValue: location.cameraPosition)
    }

    var body: some View {
        Map(position: $camera, interactionModes: [.pan, .zoom]) {
            Marker(location.name, coordinate: location.coordinate)
        }
        .mapFeatureSelectionDisabled { _ in true }
        .mapControls {
            MapScaleView()
        }
        #if DEBUG
        .onMapCameraChange { context in
            if ProcessInfo.processInfo.arguments.contains("--ui-test-observe-map-camera") {
                observedCameraValue = "\(context.camera.centerCoordinate.latitude),\(context.camera.centerCoordinate.longitude),\(context.camera.distance)"
            }
        }
        #endif
        .accessibilityIdentifier("outing.map")
        .ignoresSafeArea(edges: .bottom)
        .overlay(alignment: .bottom) {
            Button("Open in Apple Maps") {
                showMapsError = !openInMaps(
                    locationName: location.name,
                    coordinate: location.coordinate
                )
            }
            .buttonStyle(.glass)
            .controlSize(.large)
            .accessibilityIdentifier("outing.openAppleMaps")
            #if DEBUG
            .accessibilityValue(observedCameraValue)
            #endif
            .padding(.bottom, 16)
        }
        .navigationTitle("Location")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .cancellationAction) {
                Button("Close", systemImage: "xmark") { dismiss() }
                    .labelStyle(.iconOnly)
                    .accessibilityIdentifier("outing.mapClose")
            }
            ToolbarItem(placement: .primaryAction) {
                Button("Recenter", systemImage: "scope") {
                    withAnimation(reduceMotion ? nil : .default) {
                        camera = location.cameraPosition
                    }
                }
                // Native toolbar buttons do not consistently expose accessibilityValue.
                .accessibilityLabel("Recenter on \(location.name). \(location.sourceDescription). (\(location.latitude, specifier: "%.4f"), \(location.longitude, specifier: "%.4f"))")
                .accessibilityIdentifier("outing.mapRecenter")
            }
        }
        .alert("Could Not Open Apple Maps", isPresented: $showMapsError) {
            Button("OK", role: .cancel) {}
        } message: {
            Text("Try again, or continue viewing the location here.")
        }
        .onChange(of: location) { previous, updated in
            if previous.latitude != updated.latitude || previous.longitude != updated.longitude {
                camera = updated.cameraPosition
            }
        }
    }
}

#if DEBUG
private let previewMapLocation = OutingMapLocation(
    name: "Carkeek Park",
    coordinate: CLLocationCoordinate2D(latitude: 47.7115123, longitude: -122.3717456),
    sourceDescription: "GPS detected"
)!

#Preview("Outing Map Preview") {
    NavigationStack {
        Form {
            OutingLocationMapPreview(location: previewMapLocation, onOpen: {})
        }
    }
}

#Preview("Outing Map Detail") {
    NavigationStack {
        OutingLocationMapView(location: previewMapLocation)
    }
}

#Preview("Outing Map Long Name") {
    NavigationStack {
        OutingLocationMapView(location: OutingMapLocation(
            name: "Discovery Park North Beach and Lighthouse Birding Area",
            coordinate: CLLocationCoordinate2D(latitude: 47.6587, longitude: -122.4050),
            sourceDescription: "Location set from search"
        )!)
    }
    .environment(\.dynamicTypeSize, .accessibility2)
}
#endif
