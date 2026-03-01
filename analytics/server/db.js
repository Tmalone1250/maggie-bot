/**
 * Stable JSON Data Provider for Analytics Dashboard
 */
const fs = require('fs');
const path = require('path');

// Point to the bot's JSON log
const jsonPath = path.resolve(__dirname, '../../bot/logs/execution_analytics.json');

const getLogs = () => {
    try {
        if (!fs.existsSync(jsonPath)) {
            return [];
        }
        const raw = fs.readFileSync(jsonPath, 'utf8');
        return JSON.parse(raw);
    } catch (e) {
        console.error('[DB] Failed to read JSON telemetry:', e.message);
        return [];
    }
};

module.exports = { getLogs };
