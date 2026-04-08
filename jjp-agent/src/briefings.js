/**
 * Briefings — Now handled by launchd (external to agent process)
 *
 * The 3 briefing schedules run via macOS launchd plists:
 *   com.jjp.briefing.morning  → 5:30 AM daily
 *   com.jjp.briefing.evening  → 8:00 PM daily
 *   com.jjp.briefing.sunday   → 7:00 AM Sunday
 *
 * Each plist triggers: node src/briefing-standalone.js <type>
 * This runs independently of the main agent — survives restarts,
 * Mac sleep, and agent crashes.
 *
 * Setup: bash setup-briefings.sh
 */

export function startBriefings() {
  console.log("[BRIEFINGS] Briefings run via launchd (independent of agent):");
  console.log("  - 5:30 AM ET daily → Morning brief");
  console.log("  - 8:00 PM ET daily → Evening wind-down");
  console.log("  - 7:00 AM ET Sunday → Weekly intel");
  console.log("[BRIEFINGS] Run 'bash setup-briefings.sh' if not yet configured.");
}
