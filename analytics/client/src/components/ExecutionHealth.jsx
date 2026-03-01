import React, { useEffect, useState } from 'react';
import axios from 'axios';
import { Activity, DollarSign, Target, TrendingUp, AlertTriangle } from 'lucide-react';

const ExecutionHealth = () => {
    const [stats, setStats] = useState(null);

    useEffect(() => {
        const fetchSummary = async () => {
            try {
                const res = await axios.get('http://localhost:3001/api/summary');
                setStats(res.data.summary);
            } catch (err) {
                console.error("Failed to fetch summary metrics:", err);
            }
        };
        fetchSummary();
        const interval = setInterval(fetchSummary, 5000);
        return () => clearInterval(interval);
    }, []);

    if (!stats) return <div className="text-gray-400 p-4 animate-pulse">Loading engine telemetry...</div>;

    const winRateColor = stats.win_rate >= 0.8 ? 'text-green-400' : (stats.win_rate >= 0.5 ? 'text-yellow-400' : 'text-red-400');
    const profitRatioColor = stats.profit_ratio >= 0.9 ? 'text-green-400' : (stats.profit_ratio >= 0.75 ? 'text-yellow-400' : 'text-red-400');
    const pnlColor = stats.net_pnl_usd >= 0 ? 'text-green-400' : 'text-red-400';

    return (
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
            
            <div className="bg-gray-800 border border-gray-700 p-4 rounded-xl shadow-md flex flex-col justify-between">
                <div className="text-gray-400 text-xs font-semibold uppercase flex items-center mb-2"><Activity className="w-4 h-4 mr-1" /> Total Trades</div>
                <div className="text-2xl font-bold text-gray-100">{stats.total_opportunities}</div>
            </div>

            <div className="bg-gray-800 border border-gray-700 p-4 rounded-xl shadow-md flex flex-col justify-between">
                <div className="text-gray-400 text-xs font-semibold uppercase flex items-center mb-2"><DollarSign className="w-4 h-4 mr-1" /> Net Realized PnL</div>
                <div className={`text-2xl font-bold ${pnlColor}`}>${stats.net_pnl_usd.toFixed(4)}</div>
                <div className="text-xs text-gray-500 mt-1">Sim: ${stats.sim_pnl_usd.toFixed(4)}</div>
            </div>

            <div className="bg-gray-800 border border-gray-700 p-4 rounded-xl shadow-md flex flex-col justify-between">
                <div className="text-gray-400 text-xs font-semibold uppercase flex items-center mb-2"><Target className="w-4 h-4 mr-1" /> Win Rate</div>
                <div className={`text-2xl font-bold ${winRateColor}`}>{(stats.win_rate * 100).toFixed(1)}%</div>
            </div>

            <div className="bg-gray-800 border border-gray-700 p-4 rounded-xl shadow-md flex flex-col justify-between">
                <div className="text-gray-400 text-xs font-semibold uppercase flex items-center mb-2"><TrendingUp className="w-4 h-4 mr-1" /> Profit Accuracy Ratio</div>
                <div className={`text-2xl font-bold ${profitRatioColor}`}>{stats.profit_ratio.toFixed(2)}x</div>
                <div className="text-xs text-gray-500 mt-1">Real / Sim</div>
            </div>

            <div className="bg-gray-800 border border-gray-700 p-4 rounded-xl shadow-md flex flex-col justify-between">
                <div className="text-gray-400 text-xs font-semibold uppercase flex items-center mb-2"><AlertTriangle className="w-4 h-4 mr-1" /> Floor Violations</div>
                <div className={`text-2xl font-bold ${stats.profit_floor_drops > 0 ? 'text-red-400' : 'text-gray-100'}`}>{stats.profit_floor_drops}</div>
                <div className="text-xs text-gray-500 mt-1">Dropped due to MIN_PROFIT</div>
            </div>

        </div>
    );
};

export default ExecutionHealth;
