# Tunes rollout

The current candidate has Classic, Dinner Set, Manual DJ and an included licensed automatic pack. Treat automated rehearsal, physical-device acceptance and a live pilot as separate release milestones.

| Stage | What the candidate provides | Gate before expanding |
| --- | --- | --- |
| Dependable Classic | Immediate leave and rejoin, secure seats, controller handoff, audio pauses, restart checkpoints, final reveal and transactional results. | Pass the two-phone matrix, including an iPhone lock or call, audio recovery and a server restart in each phase. Confirm the table preserves the phase, recording, correct scores and clock. |
| A friend can host | Account-free Manual DJ, QR and invite links, rotating or dedicated DJ, a sourced recording catalogue, and gap placement on mobile. | A newcomer gets two guests into the room and starts audible music unassisted within the 90-second pilot target. Verify touch and screen-reader placement. |
| Dinner Set | Private picks, shared reveal and points, complete DJ rotations, opt-in rematches, and private saved tables. | Run six to eight tables of four to six. Count voluntary same-mode rematches, switches and stops before choosing a default. |
| Wider hosting | Automatic playback with the bundled independent instrumental pack and support for operator-supplied licensed packs. | Confirm each pack's recording list, terms, territory, attribution and speaker delivery. Compare cost per completed game, review concurrency diagnostics and choose rollout scope. |

See the test instructions, acceptance checklist and measurement fields in the [project README](README.md#pilot-acceptance-checklist).

## Release sequence

1. Run the locked Node 24 build, unit and real socket tests, production rehearsal and container smoke test. Back up the existing volume and verify migration and restore on a disposable copy.
2. Start with a small Classic trial. Use the Dinner Set and licensed-playback flags to control new starts by deployment while allowing compatible active games to recover.
3. Complete the physical matrix and newcomer trial before expanding. Hold a release for lost games, incorrect winners, duplicate scoring, or music that cannot be reliably recovered on the pilot speaker.
4. Run the comparative dinner trial. Prioritize the recorded pain points before adding more scoring mechanics.
5. Keep the single-server SQLite deployment for the pilot. Review timed starts by source, reconnect and completion rates, checkpoint latency and event-loop delay before deciding whether to change infrastructure.

The pilot catalogue pairs independently sourced familiar recording facts with externally cued audio for Manual DJ. The bundled automatic pack contains independent instrumentals with its own credits. Broader familiar-song automatic hosting depends on a written rights and delivery decision for each territory. [Bundled music credits](app/public/music-credits.html)
