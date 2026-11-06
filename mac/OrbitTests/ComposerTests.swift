import XCTest

final class ComposerTests: XCTestCase {
    func testModelsAvailabilityDecodes() throws {
        let json = #"{"ok":true,"modelsAvailable":false,"models":[]}"#
        let result = try JSONDecoder().decode(ModelsResponse.self, from: Data(json.utf8))
        XCTAssertFalse(result.modelsAvailable)
        XCTAssertTrue(result.models.isEmpty)
    }

    private let skills = [
        SlashSkill(name: "kurze-zusammenfassung", description: "Fasst Texte zusammen", source: "orbit"),
        SlashSkill(name: "rezept", description: "Kochen im Brain", source: "brain"),
    ]

    func testSlashQueryOnlyWithoutWhitespace() {
        XCTAssertEqual(SlashMenuLogic.query(in: "/"), "")
        XCTAssertEqual(SlashMenuLogic.query(in: "/kurz"), "kurz")
        XCTAssertNil(SlashMenuLogic.query(in: "/kurz text"))
        XCTAssertNil(SlashMenuLogic.query(in: "Hallo /kurz"))
        XCTAssertNil(SlashMenuLogic.query(in: ""))
    }

    func testSlashFilterMatchesNameAndDescriptionCaseInsensitive() {
        XCTAssertEqual(SlashMenuLogic.filter(skills, query: "").count, 2)
        XCTAssertEqual(SlashMenuLogic.filter(skills, query: "KURZ").map(\.name), ["kurze-zusammenfassung"])
        XCTAssertEqual(SlashMenuLogic.filter(skills, query: "kochen").map(\.name), ["rezept"])
        XCTAssertTrue(SlashMenuLogic.filter(skills, query: "zzz").isEmpty)
    }

    func testNewSkillCommand() {
        XCTAssertEqual(SlashMenuLogic.newSkillName(in: "/skill neu mein-skill"), "mein-skill")
        XCTAssertNil(SlashMenuLogic.newSkillName(in: "/skill neu X"))
    }

    // Phase 1: kein Freigabe-Modus mehr. Metadaten alter Antworten (mit unbekannten Schlüsseln wie approvalMode) laden ohne Absturz, cachedTokens kommt an.
    func testMetadataToleratesOldKeysAndReadsCache() throws {
        let json = #"{"model":"m","approvalMode":"plan","inputTokens":100,"cachedTokens":40,"outputTokens":5}"#
        let meta = try JSONDecoder().decode(ChatMetadata.self, from: Data(json.utf8))
        XCTAssertEqual(meta.cachedTokens, 40)
        XCTAssertEqual(TokenText.line(input: meta.inputTokens, cached: meta.cachedTokens, output: meta.outputTokens), "Eingabe 100 (Cache 40) · Ausgabe 5")
    }

    func testByteFormatLikeWeb() {
        XCTAssertEqual(AttachmentRules.formatBytes(900), "900 B")
        XCTAssertEqual(AttachmentRules.formatBytes(2048), "2 KB")
        XCTAssertEqual(AttachmentRules.formatBytes(2 * 1024 * 1024), "2,0 MB")
    }

    func testFileCardInBubbleShowsKindNotMime() {
        // Figma 02/teil-14: „Angebot_2026.pdf · PDF · 1,2 MB“ statt „application/pdf“.
        XCTAssertEqual(FileCardRules.kind(mediaType: "application/pdf", filename: "Angebot_2026.pdf"), "PDF")
        XCTAssertEqual(FileCardRules.symbol(mediaType: "application/pdf", filename: "Angebot_2026.pdf"), "doc.richtext")
        XCTAssertEqual(AttachmentRules.formatBytes(1_258_291), "1,2 MB")
    }

    func testAttachmentLimits() {
        if case .failure(let failure) = AttachmentRules.prepare(data: Data(count: AttachmentRules.maxAddBytes + 1), filename: "a.bin", mediaType: "application/octet-stream") {
            XCTAssertEqual(failure, .tooBig(name: "a.bin"))
        } else { XCTFail("25 MB + 1 müsste scheitern") }
        // 2 MB + 1: wird hinzugefügt, erst das Senden lehnt ab (wie im Web).
        if case .success(let big) = AttachmentRules.prepare(data: Data(count: AttachmentRules.maxSendBytes + 1), filename: "b.bin", mediaType: "application/octet-stream") {
            XCTAssertEqual(AttachmentRules.oversize([big])?.filename, "b.bin")
            XCTAssertEqual(AttachmentRules.Failure.tooBigToSend(name: "b.bin").text, "b.bin ist zu groß (max. 2,0 MB).")
        } else { XCTFail("2 MB + 1 müsste sich hinzufügen lassen") }
        if case .success(let attachment) = AttachmentRules.prepare(data: Data("x".utf8), filename: "c.txt", mediaType: "text/plain") {
            XCTAssertEqual(attachment.mediaType, "text/plain")
        } else { XCTFail("kleine Textdatei müsste passen") }
    }

    func testModelDefaultEffortPrefersMid() {
        let full = ModelInfo(id: "m", label: "M", description: "", provider: "anthropic", efforts: ["low", "medium", "high"])
        let none = ModelInfo(id: "n", label: "N", description: "", provider: "google", efforts: [])
        XCTAssertEqual(full.defaultEffort, "medium")
        XCTAssertNil(none.defaultEffort)
    }
}
