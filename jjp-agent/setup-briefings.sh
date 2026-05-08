#!/bin/bash
#
# Setup JJP Agent briefing schedules via launchd
# Run once: bash setup-briefings.sh
#

AGENT_DIR="$(cd "$(dirname "$0")" && pwd)"
NODE_BIN="$(which node)"
LAUNCH_DIR="$HOME/Library/LaunchAgents"

echo "═══ JJP Agent Briefing Setup ═══"
echo "Agent dir: $AGENT_DIR"
echo "Node path: $NODE_BIN"
echo ""

# Unload existing
for name in morning evening sunday; do
    launchctl unload "$LAUNCH_DIR/com.jjp.briefing.$name.plist" 2>/dev/null
done

# Copy and configure plists
for name in morning evening sunday; do
    SRC="$AGENT_DIR/plists/com.jjp.briefing.$name.plist"
    DEST="$LAUNCH_DIR/com.jjp.briefing.$name.plist"

    sed -e "s|NODE_PATH|$NODE_BIN|" \
        -e "s|AGENT_PATH|$AGENT_DIR|" \
        "$SRC" > "$DEST"

    launchctl load "$DEST"
    echo "✓ Loaded com.jjp.briefing.$name"
done

echo ""
echo "═══ All 3 briefings scheduled ═══"
echo "  5:30 AM daily  → Morning brief"
echo "  8:00 PM daily  → Evening wind-down"
echo "  7:00 AM Sunday → Weekly intel"
echo ""
echo "Check status: launchctl list | grep jjp.briefing"
echo "View logs:    tail /tmp/jjp-briefing-morning.log"
echo ""

# Test: fire morning briefing now to verify
read -p "Send a test briefing now? (y/n) " -n 1 -r
echo ""
if [[ $REPLY =~ ^[Yy]$ ]]; then
    echo "Sending test morning briefing..."
    "$NODE_BIN" "$AGENT_DIR/src/briefing-standalone.js" morning
    echo "Check Telegram!"
fi
