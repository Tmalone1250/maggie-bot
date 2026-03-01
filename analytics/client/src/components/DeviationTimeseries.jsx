import React, { useEffect, useState } from 'react';
import axios from 'axios';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';

const DeviationTimeseries = () => {
    const [data, setData] = useState([]);

    useEffect(() => {
        const fetchTimeseries = async () => {
            try {
                const res = await axios.get('http://localhost:3001/api/deviation-timeseries');
                // Format timestamp
                const formatted = res.data.timeline.map(d => ({
                    ...d,
                    time: new Date(d.timestamp_utc).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})
                }));
                setData(formatted);
            } catch (err) {
                console.error("Failed to fetch timeseries data:", err);
            }
        };
        fetchTimeseries();
        const interval = setInterval(fetchTimeseries, 10000);
        return () => clearInterval(interval);
    }, []);

    if (!data.length) return <div className="text-gray-500 text-sm italic">Waiting for execution trades...</div>;

    return (
        <div className="h-64 w-full">
            <ResponsiveContainer width="100%" height="100%">
                <LineChart data={data} margin={{ top: 20, right: 30, left: 20, bottom: 5 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                    <XAxis dataKey="time" stroke="#9ca3af" />
                    <YAxis yAxisId="left" stroke="#8b5cf6" />
                    <YAxis yAxisId="right" orientation="right" stroke="#f59e0b" />
                    <Tooltip 
                        contentStyle={{ backgroundColor: '#1f2937', borderColor: '#374151', color: '#f3f4f6' }}
                    />
                    <Legend />
                    <Line yAxisId="left" type="monotone" dataKey="profit_deviation_usd" name="Profit Drift ($)" stroke="#8b5cf6" strokeWidth={2} dot={{ r: 2 }} activeDot={{ r: 6 }} />
                    <Line yAxisId="right" type="monotone" dataKey="gas_deviation_units" name="Gas Miss (Units)" stroke="#f59e0b" strokeWidth={2} dot={{ r: 2 }} />
                </LineChart>
            </ResponsiveContainer>
        </div>
    );
};

export default DeviationTimeseries;
