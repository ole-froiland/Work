import XCTest

final class PermissionFlowTests: XCTestCase {
    @MainActor
    func testConnectAndGrantRequestedPermissions() throws {
        continueAfterFailure = false

        let app = XCUIApplication()
        addUIInterruptionMonitor(withDescription: "Panelkobling permissions") { alert in
            let preferredButtons = [
                "Allow Full Access", "Gi full tilgang",
                "Allow While Using App", "Tillat ved bruk av appen",
                "Allow", "Tillat", "Continue", "Fortsett", "OK"
            ]
            for label in preferredButtons where alert.buttons[label].exists {
                alert.buttons[label].tap()
                return true
            }
            if let button = alert.buttons.allElementsBoundByIndex.last {
                button.tap()
                return true
            }
            return false
        }

        app.launch()
        let connect = app.buttons["Koble til og synkroniser"]
        XCTAssertTrue(connect.waitForExistence(timeout: 10))
        connect.tap()

        // Trigger interruption monitors after each system sheet appears.
        for _ in 0..<12 {
            app.tap()
            if app.staticTexts.matching(identifier: "Klar").count == 3 { break }
            Thread.sleep(forTimeInterval: 1)
        }

        XCTAssertTrue(app.staticTexts["Klar"].firstMatch.waitForExistence(timeout: 30))
    }
}
