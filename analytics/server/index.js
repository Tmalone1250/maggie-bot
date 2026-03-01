const express = require('express');
const cors = require('cors');
const { getLogs } = require('./db');

const app = express();
app.use(cors());

const PORT = process.env.PORT || 3001;

// Health check
app.get('/health', (req, res) => {
    const logs = getLogs();
    res.json({ status: 'ok', logsCount: logs.length });
});

// GET /summary -> aggregate ratios and PnL
app.get('/api/summary', (req, res) => {
    const logs = getLogs();
    
    try {
        const summary = logs.reduce((acc, row) => {
            acc.total_trades++;
            
            const realGasUsd = (Number(row.real_gas_used) * Number(row.real_base_fee_gwei) * 1e9 / 1e18) * 3000;
            const simGasUsd = (Number(row.simulated_gas_used) * Number(row.simulated_base_fee_gwei) * 1e9 / 1e18) * 3000;
            
            if (row.live_success) {
                acc.net_pnl_usd += (Number(row.real_profit_usd) - realGasUsd);
                acc.successful_trades++;
                acc.total_real_profit += Number(row.real_profit_usd);
                acc.total_real_gas += Number(row.real_gas_used);
            }
            
            acc.sim_pnl_usd += (Number(row.simulated_profit_usd) - simGasUsd);
            acc.total_simulated_profit += Number(row.simulated_profit_usd);
            acc.total_simulated_gas += Number(row.simulated_gas_used);
            
            if (!row.live_success && row.fork_passed) {
                acc.failed_live_trades++;
            }
            
            if (row.dropped_reason && row.dropped_reason.includes('Net profit')) {
                acc.profit_floor_drops++;
            }
            
            return acc;
        }, {
            total_trades: 0,
            net_pnl_usd: 0,
            sim_pnl_usd: 0,
            total_real_profit: 0,
            total_simulated_profit: 0,
            total_real_gas: 0,
            total_simulated_gas: 0,
            successful_trades: 0,
            failed_live_trades: 0,
            profit_floor_drops: 0
        });

        const profit_ratio = summary.total_simulated_profit > 0 ? (summary.total_real_profit / summary.total_simulated_profit) : 1.0;
        const gas_ratio = summary.total_simulated_gas > 0 ? (summary.total_real_gas / summary.total_simulated_gas) : 1.0;
        const total_attempts = summary.successful_trades + summary.failed_live_trades;
        const win_rate = total_attempts > 0 ? (summary.successful_trades / total_attempts) : 0.0;

        res.json({
            summary: {
                total_opportunities: summary.total_trades,
                net_pnl_usd: summary.net_pnl_usd,
                sim_pnl_usd: summary.sim_pnl_usd,
                profit_ratio,
                gas_ratio,
                win_rate,
                profit_floor_drops: summary.profit_floor_drops
            }
        });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// GET /inclusion -> distribution of block inclusion delays
app.get('/api/inclusion', (req, res) => {
    const logs = getLogs();
    
    try {
        const successful = logs.filter(l => l.live_success);
        const distributionMap = successful.reduce((acc, row) => {
            const delta = row.inclusion_delta || 0;
            acc[delta] = (acc[delta] || 0) + 1;
            return acc;
        }, {});
        
        const distribution = Object.entries(distributionMap).map(([delta, count]) => ({
            inclusion_delta: parseInt(delta),
            count
        })).sort((a, b) => a.inclusion_delta - b.inclusion_delta);
        
        const dropped_attempts = logs.filter(l => !l.live_success && l.fork_passed).length;

        res.json({
            distribution,
            dropped_attempts
        });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// GET /profit-scatter -> paired arrays of real vs sim profit + drift vectors
app.get('/api/profit-scatter', (req, res) => {
    const logs = getLogs();
    
    try {
        const trades = logs
            .filter(l => l.live_success)
            .slice(-100) // Last 100 for scatter
            .map(l => ({
                id: l.id,
                route_hash: l.route_hash,
                simulated_profit_usd: l.simulated_profit_usd,
                real_profit_usd: l.real_profit_usd
            }));
        res.json({ trades });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// GET /deviation-timeseries -> Real vs Sim over time limits
app.get('/api/deviation-timeseries', (req, res) => {
    const logs = getLogs();
    
    try {
        const timeline = logs
            .filter(l => l.live_success)
            .slice(-100) // Last 100
            .map(l => ({
                id: l.id,
                timestamp_utc: l.timestamp_utc,
                profit_deviation_usd: l.real_profit_usd - l.simulated_profit_usd,
                gas_deviation_units: l.real_gas_used - l.simulated_gas_used
            }));
        res.json({ timeline });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.listen(PORT, () => {
    console.log(`🚀 Maggie Analytics API observing off port ${PORT} (JSON Mode)`);
});
