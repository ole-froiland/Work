@preconcurrency import CoreLocation
import MapKit

@MainActor
final class LocationProvider: NSObject, @preconcurrency CLLocationManagerDelegate {
    struct Value {
        let label: String
        let coordinate: CLLocationCoordinate2D
        let observedAt: Date
    }

    private let manager = CLLocationManager()
    private var authorizationContinuation: CheckedContinuation<Void, Error>?
    private var locationContinuation: CheckedContinuation<CLLocation, Error>?

    override init() {
        super.init()
        manager.delegate = self
        manager.desiredAccuracy = kCLLocationAccuracyKilometer
    }

    func requestAuthorization() async throws {
        switch manager.authorizationStatus {
        case .authorizedAlways, .authorizedWhenInUse: return
        case .denied, .restricted: throw CLError(.denied)
        case .notDetermined:
            try await withCheckedThrowingContinuation { continuation in
                authorizationContinuation = continuation
                manager.requestWhenInUseAuthorization()
            }
        @unknown default: throw CLError(.denied)
        }
    }

    func currentLocation() async throws -> Value {
        try await requestAuthorization()
        let location = try await withCheckedThrowingContinuation { continuation in
            locationContinuation = continuation
            manager.requestLocation()
        }
        let label = await placeLabel(for: location)
        return Value(label: label, coordinate: location.coordinate, observedAt: location.timestamp)
    }

    private func placeLabel(for location: CLLocation) async -> String {
        guard let request = MKReverseGeocodingRequest(location: location) else { return "Nær deg" }
        return await withCheckedContinuation { continuation in
            request.getMapItems { items, _ in
                let item = items?.first
                let label = item?.addressRepresentations?.cityName
                    ?? item?.addressRepresentations?.regionName
                    ?? "Nær deg"
                continuation.resume(returning: label)
            }
        }
    }

    func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
        guard let continuation = authorizationContinuation else { return }
        switch manager.authorizationStatus {
        case .authorizedAlways, .authorizedWhenInUse:
            authorizationContinuation = nil
            continuation.resume()
        case .denied, .restricted:
            authorizationContinuation = nil
            continuation.resume(throwing: CLError(.denied))
        default: break
        }
    }

    func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
        guard let continuation = locationContinuation, let location = locations.last else { return }
        locationContinuation = nil
        continuation.resume(returning: location)
    }

    func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) {
        guard let continuation = locationContinuation else { return }
        locationContinuation = nil
        continuation.resume(throwing: error)
    }
}
