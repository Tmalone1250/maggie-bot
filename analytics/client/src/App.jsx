import React from 'react';
import ExecutionHealth from './components/ExecutionHealth';
import InclusionChart from './components/InclusionChart';
import ProfitScatter from './components/ProfitScatter';
import DeviationTimeseries from './components/DeviationTimeseries';
import AlertFeed from './components/AlertFeed';

function App() {
  return (
    <div className="min-h-screen bg-gray-900 text-white p-6 font-sans">
      <header className="mb-8">
        <h1 className="text-3xl font-bold text-gray-100 flex items-center">
          <span className="text-blue-500 mr-3">⚡</span> Maggie Execution Observatory
        </h1>
        <p className="text-gray-400 mt-2 text-sm">Real-time simulation drift and inclusion telemetry</p>
      </header>

      <main className="space-y-6">
        {/* Layer 1: High Level Health */}
        <section>
          <ExecutionHealth />
        </section>

        {/* Layer 2: Inclusion & Drift */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <section className="bg-gray-800 p-4 rounded-xl shadow-lg border border-gray-700">
            <h2 className="text-lg font-semibold mb-4 text-gray-200">Inclusion Bidding Efficacy</h2>
            <InclusionChart />
          </section>
          
          <section className="bg-gray-800 p-4 rounded-xl shadow-lg border border-gray-700">
            <h2 className="text-lg font-semibold mb-4 text-gray-200">Simulation Leakage (Real vs Sim)</h2>
            <ProfitScatter />
          </section>

          <section className="bg-gray-800 p-4 rounded-xl shadow-lg border border-gray-700 lg:col-span-2">
            <h2 className="text-lg font-semibold mb-4 text-gray-200">Execution Drift (Time Series)</h2>
            <DeviationTimeseries />
          </section>
        </div>

      </main>

      {/* Persistent Alerts */}
      <AlertFeed />
    </div>
  );
}

export default App;
