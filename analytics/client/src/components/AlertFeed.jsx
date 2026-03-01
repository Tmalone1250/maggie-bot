import React, { useEffect, useState } from 'react';
import axios from 'axios';
import { AlertOctagon, Info } from 'lucide-react';

const AlertFeed = () => {
    const [alerts, setAlerts] = useState([]);

    useEffect(() => {
        const fetchAlerts = async () => {
            try {
                // Polling summary to derive alerts manually for the MVP Dashboard
                const res = await axios.get('http://localhost:3001/api/summary');
                const stats = res.data.summary;
                
                const activeAlerts = [];

                if (stats.win_rate > 0 && stats.win_rate < 0.70) {
                    activeAlerts.push({
                        id: 1,
                        level: 'critical',
                        message: `Inclusion Win Rate dropped to ${(stats.win_rate * 100).toFixed(1)}%. Bidding algorithm may be under-pricing inclusion.`
                    });
                }

                if (stats.profit_ratio > 0 && stats.profit_ratio < 0.75) {
                    activeAlerts.push({
                        id: 2,
                        level: 'warning',
                        message: `Substantial alpha leak detected. Real/Sim profit ratio is at ${stats.profit_ratio.toFixed(2)}x.`
                    });
                }

                if (stats.profit_floor_drops >= 3) {
                    activeAlerts.push({
                        id: 3,
                        level: 'critical',
                        message: `Profit Floor Tripwire activated ${stats.profit_floor_drops} times. Slippage logic needs emergency tuning.`
                    });
                }

                setAlerts(activeAlerts);
            } catch (err) {
                console.error("Failed to fetch alerts:", err);
            }
        };
        fetchAlerts();
        const interval = setInterval(fetchAlerts, 10000);
        return () => clearInterval(interval);
    }, []);

    if (alerts.length === 0) {
        return (
            <div className="mt-8 bg-gray-800/50 border border-gray-700 p-4 rounded-xl flex items-center text-gray-400">
                <Info className="w-5 h-5 mr-3 text-blue-400" />
                No active system anomalies detected. Models are executing within optimal bounds.
            </div>
        );
    }

    return (
        <div className="mt-8 space-y-3">
            <h3 className="text-gray-200 font-semibold mb-2 flex items-center">
                <AlertOctagon className="w-5 h-5 mr-2 text-red-500" />
                Active System Alerts ({alerts.length})
            </h3>
            {alerts.map(alert => (
                <div 
                    key={alert.id} 
                    className={`p-4 rounded-xl border flex items-start ${
                        alert.level === 'critical' 
                            ? 'bg-red-900/20 border-red-500/50 text-red-200' 
                            : 'bg-yellow-900/20 border-yellow-500/50 text-yellow-200'
                    }`}
                >
                    <AlertOctagon className={`w-5 h-5 mr-3 mt-0.5 ${alert.level === 'critical' ? 'text-red-500' : 'text-yellow-500'}`} />
                    <div>{alert.message}</div>
                </div>
            ))}
        </div>
    );
};

export default AlertFeed;
