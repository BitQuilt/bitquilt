// The app's own words. The documents name things as the protocol does: a reading, a root, a tracker, standing. A
// person with a phone in their hand needs fewer and plainer ones: an answer, a match, a score. This file says each
// thing the tracker hands the app in the words a page shows, so every page says it the same way: a piece's name and
// state, a field of an answer, the reason an answer is not counted, and the sentences a person asks their Claude with.
// The protocol's words stay in the documents, and nothing here changes what is signed or sent.
import Foundation

enum Plain {
    /// A piece's name as a person reads it: `claim/5` is "Claim 5".
    static func piece(_ name: String) -> String {
        sentence(name.replacingOccurrences(of: "/", with: " "))
    }

    /// A field's name: `page_count` is "Page count".
    static func field(_ name: String) -> String { sentence(name) }

    /// A short answer with its first letter raised, as a label has it: `supports` is "Supports". A value of several
    /// words is somebody's sentence or a quote, and is left as it was given.
    static func value(_ said: String) -> String {
        said.contains(" ") ? said : sentence(said)
    }

    private static func sentence(_ words: String) -> String {
        let spaced = words.replacingOccurrences(of: "_", with: " ").replacingOccurrences(of: "-", with: " ")
        return spaced.prefix(1).uppercased() + spaced.dropFirst()
    }

    /// A piece's state in a word or two, as a legend and a label say it.
    static func state(_ state: String) -> String {
        switch state {
        case "open": return "Open"
        case "in_flight", "sealed": return "Working"
        case "needs_verify": return "Answered"
        case "accepted_provisional": return "Matched"
        case "accepted": return "Final"
        case "disputed": return "Disagreed"
        case "challenged": return "Challenged"
        case "recording": return "Collecting answers"
        case "recorded": return "Recorded"
        case "judging": return "Being ranked"
        case "locked": return "Locked"
        case "unreachable": return "Closed"
        case "inherited": return "Done elsewhere"
        default: return sentence(state)
        }
    }

    /// A piece's state in a sentence: what happened on it, never the rule it is held to.
    static func explain(_ state: String) -> String {
        switch state {
        case "open": return "Open. No answer yet."
        case "in_flight", "sealed": return "An AI is working on it now."
        case "needs_verify": return "Answered. No match yet."
        case "accepted_provisional": return "Matched. AIs from different companies gave the same answer."
        case "accepted": return "Final. The match stood."
        case "disputed": return "Disagreed. AIs gave different answers, and every one is kept."
        case "challenged": return "Challenged. A panel is looking again."
        case "recording": return "Collecting answers. Every one is kept."
        case "recorded": return "Recorded. Every answer is kept."
        case "judging": return "A panel is ranking the answers."
        case "locked": return "Locked until earlier pieces are done."
        case "unreachable": return "Closed. A piece it needs cannot be done."
        case "inherited": return "Done on the problem this one grew from."
        default: return Plain.state(state) + "."
        }
    }

    /// Why an answer is not counted, in plain words. The tracker gives its reason from a closed list
    /// (docs/v2/READING.md section 3); a reason this app does not know is said as the tracker wrote it.
    static func reason(_ why: String?) -> String {
        guard let why else { return "a decision went against it" }
        return reasons[why] ?? why
    }

    private static let reasons = [
        "its root is related to the owner": "it comes from the problem's owner",
        "its root is related to the root of an earlier reading": "it comes from the same person as an earlier answer",
        "its root is related to the root of a reading in the set": "it comes from the same person as a matched answer",
        "an earlier reading from its vendor says the same": "an AI from the same company already said the same",
        "the set holds a reading from its vendor": "the match already has an AI from the same company",
        "it differs from the set on an agree field": "it differs from the matched answer",
        "the set was made before it": "the piece was matched before it came",
        "the set was made without it": "the piece was matched without it",
        "the set was made on another patch": "the match was made on another version",
        "it is not from a person's seat": "the piece asks for a person",
        "the readings the piece asks for stood before it": "the piece already had all the answers it asks for",
        "an earlier candidate gave the same return": "an earlier answer said the same",
        "the candidates were in before it": "the piece had its answers before it came",
        "the panel ranked another first": "a panel ranked another answer first",
        "its panel is void": "its panel did not finish",
        "its piece asks a verifier this reading does not implement": "the piece is checked in a way this answer does not fit",
        "it rests on nothing where another reading rests on the record": "it gives no source where another answer does",
        "a challenge held against its set": "a challenge against its match held",
        "the owner's gold missed its set": "it missed the owner's answer key",
        "the fold without the struck events does not hold it": "an answer it relied on was struck",
    ]

    /// How many pieces of a problem stand where, in a line: "12 pieces · 5 answered · 1 matched".
    static func progress(pieces: Int, counts: [String: Int]) -> String {
        let n = { (states: [String]) in states.reduce(0) { $0 + (counts[$1] ?? 0) } }
        let answered = n(["needs_verify", "disputed", "challenged", "recording", "judging"])
        let matched = n(["accepted_provisional", "accepted", "recorded"])
        var parts = ["\(pieces) piece\(pieces == 1 ? "" : "s")"]
        if answered > 0 { parts.append("\(answered) answered") }
        if matched > 0 { parts.append("\(matched) matched") }
        return parts.joined(separator: " \u{00B7} ")
    }

    /// A sentence a person asks their Claude with, as a button names it and a line under it says what comes of it.
    /// The tracker's sheet gives each sentence a title and a description written for a list of prompts; a button
    /// wants fewer words. A sentence this app does not know keeps the sheet's own.
    static func ask(_ phrase: Phrase) -> (title: String, about: String) {
        asks[phrase.name] ?? (phrase.title, phrase.about)
    }

    private static let asks: [String: (String, String)] = [
        "find_something_to_do": ("Find me something to do", "Your Claude picks a piece that needs an answer."),
        "who_am_i": ("Who am I on Quilt?", "Your Claude reads back your score and your identity."),
        "how_it_works": ("Explain Quilt to me", "Your Claude says how it works, in plain words."),
        "what_i_asked": ("Do what I saved", "Your Claude does what you saved for it in this app."),
        "my_disputed_return": ("Another AI disagreed", "See both answers with your Claude."),
        "give_verdict": ("Give a verdict", "You were picked to judge a challenge."),
        "rank_panel": ("Rank the answers", "You were picked for a panel."),
        "reveal_my_gold": ("Reveal your answer key", "A piece you hold the answer to has been matched."),
        "open_problem": ("Open a problem", "Your Claude says what the problem asks."),
        "take_piece": ("Take a piece", "Your Claude takes a piece and answers it."),
        "keep_problem": ("Keep a problem", "Your Claude keeps a copy of the problem."),
        "propose_piece": ("Propose a piece", "Your Claude suggests a piece the problem lacks."),
        "search_quilt": ("Search for a problem", "Claude opens with the sentence. Add the words to search for."),
        "piece_for_a_person": ("A piece wants a person", "Your Claude shows you a piece only a person can answer."),
        "call_me": ("Choose my name", "Claude opens with the sentence. Add the name you want."),
        "turn_into_problem": ("Turn this into a problem", "Your Claude drafts a problem from what you tell it."),
        "publish_pattern": ("Publish a pattern", "Your Claude publishes a pattern file from your computer."),
        "pay_workers": ("Pay for answers", "Your Claude sets coin aside for answers on a problem."),
        "transfer_coin": ("Send coin", "Your Claude moves coin to another identity."),
        "redeem_coin": ("Cash out coin", "Your Claude moves coin out to the chain."),
    ]

    /// A group of sentences on the sheet, by the title a page gives it.
    static func group(_ title: String) -> String {
        switch title {
        case "Wanted from you": return "Needs a look"
        case "To start": return "Ask your Claude"
        case "Keeping": return "Problems you keep"
        case "Your gold": return "Your answer keys"
        default: return title
        }
    }
}
