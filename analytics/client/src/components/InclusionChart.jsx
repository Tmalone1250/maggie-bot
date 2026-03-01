import React, { useEffect, useState } from 'react';
import axios from 'axios';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell, CartesianGrid } from 'recharts';

const InclusionChart = () => {
    const [data, setData] = useState([]);

    useEffect(() => {
        const fetchInclusion = async () => {
            try {
                const res = await axios.get('http://localhost:3001/api/inclusion');
                const formatted = res.data.distribution.map(d => ({
                    delta: `+${d.inclusion_delta} blk`,
                    count: d.count,
                    color: d.inclusion_delta === 0 ? '#4ade80' : 
                           d.inclusion_delta === 1 ? '#facc15' : '#ef4444' // Green, Yellow, Red
                }));

                // Append drops
                if (res.data.dropped_attempts > 0) {
                    formatted.push({ 
                        delta: 'Dropped', 
                        count: res.data.dropped_attempts,
                        color: '#b91c1c'
                    });
                }
                
                setData(formatted);
            } catch (err) {
                console.error("Failed to fetch inclusion data:", err);
            }
        };
        fetchInclusion();
        const interval = setInterval(fetchInclusion, 10000);
        return () => clearInterval(interval);
    }, []);

    if (!data.length) return <div className="text-gray-500 text-sm italic">Waiting for execution trades...</div>;

    return (
        <div className="h-64 w-full">
            <ResponsiveContainer width="100%" height="100%">
                <BarChart data={data} margin={{ top: 20, right: 30, left: 0, bottom: 5 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#374151" vertical={false} />
                    <XAxis dataKey="delta" stroke="#9ca3af" />
                    <YAxis stroke="#9ca3af" />
                    <Tooltip 
                        contentStyle={{ backgroundColor: '#1f2937', borderColor: '#374151', color: '#f3f4f6' }}
                    />
                    <Bar dataKey="count" radius={[4, 4, 0, 0]}>
                        {data.map((entry, index) => (
                            <Cell key={`cell-${index}`} fill={entry.color} />
                        ))}
                    </Bar>
                </BarChart>
            </ResponsiveContainer>
        </div>
    );
};

export default InclusionChart;
