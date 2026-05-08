#!/bin/bash
#
# Setup JJP Salon Revenue Monitor via launchd
# Run once: bash setup-salon-monitor.sh
#

AGENT_DIR="$(cd "$(dirname "$0")" && pwd)"
NODE_BIN="$(which node)"
LAUNCH_DIR="$HOME/Library/LaunchAgents"
PLIST_NAME="com.jjp.salon.monitor"

echo "═══ Salon Revenue Monitor Setup ═══"
echo "Agent dir: $AGENT_DIR"
echo "Node path: $NODE_BIN"
echo ""

# Unload existing
launchctl unload "$LAUNCH_DIR/$PLIST_NAME.plist" 2>/dev/null

# Copy and configure plist
SRC="$AGENT_DIR/plists/$PLIST_NAME.plist"
DEST="$LAUNCH_DIR/$PLIST_NAME.plist"

sed -e "s|NODE_PATH|$NODE_BIN|" \
    -e "s|AGENT_PATH|$AGENT_DIR|" \
    "$SRC" > "$DEST"

launchctl load "$DEST"
echo "✓ Loaded $PLIST_NAME (runs every 60 min)"

echo ""
echo "═══ Salon Monitor Active ═══"
echo "  Checks Square every 60 min during 9 AM - 8 PM ET"
echo "  Milestones: \$500, \$1K, \$1.5K"
echo "  Slow day alert: after 2 PM if under \$200"
echo "  EOD summary: 7 PM daily"
echo "  Weekly wrap: Sunday 6 PM"
echo ""
echo "Check status: launchctl list | grep salon"
echo "View logs:    tail /tmp/jjp-salon-monitor.log"
echo ""

# Send test alert
echo "Sending test alert to Telegram..."
"$NODE_BIN" "$AGENT_DIR/src/salon-monitor.js" test
echo ""
echo "Check Telegram for the test alert!"
