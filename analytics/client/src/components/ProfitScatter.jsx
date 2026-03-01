import React, { useEffect, useState } from 'react';
import axios from 'axios';
import { ScatterChart, Scatter, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine } from 'recharts';

const ProfitScatter = () => {
    const [data, setData] = useState([]);

    useEffect(() => {
        const fetchScatter = async () => {
            try {
                const res = await axios.get('http://localhost:3001/api/profit-scatter');
                setData(res.data.trades);
            } catch (err) {
                console.error("Failed to fetch scatter data:", err);
            }
        };
        fetchScatter();
        const interval = setInterval(fetchScatter, 10000);
        return () => clearInterval(interval);
    }, []);

    if (!data.length) return <div className="text-gray-500 text-sm italic">Waiting for execution trades...</div>;

    return (
        <div className="h-64 w-full">
            <ResponsiveContainer width="100%" height="100%">
                <ScatterChart margin={{ top: 20, right: 20, bottom: 20, left: 20 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
                    <XAxis 
                        type="number" 
                        dataKey="simulated_profit_usd" 
                        name="Simulated ($)" 
                        unit="$" 
                        stroke="#9ca3af"
                        label={{ value: "Simulated Profit", position: "bottom", fill: "#9ca3af" }}
                    />
                    <YAxis 
                        type="number" 
                        dataKey="real_profit_usd" 
                        name="Realized ($)" 
                        unit="$"
                        stroke="#9ca3af"
                        label={{ value: "Real Profit", angle: -90, position: "left", fill: "#9ca3af" }}
                    />
                    <Tooltip 
                        cursor={{ strokeDasharray: '3 3' }} 
                        contentStyle={{ backgroundColor: '#1f2937', borderColor: '#374151', color: '#f3f4f6' }}
                    />
                    <Scatter name="Executions" data={data} fill="#8b5cf6" />
                    {/* Perfect alignment reference line */}
                    <ReferenceLine segment={[{x: 0, y: 0}, {x: 10, y: 10}]} stroke="#4ade80" strokeDasharray="3 3" />
                </ScatterChart>
            </ResponsiveContainer>
        </div>
    );
};

export default ProfitScatter;
