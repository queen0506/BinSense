import { supabase } from '../supabase-init.js';

let wasteChart;
const ctx = document.getElementById('wasteChart').getContext('2d');

document.addEventListener('DOMContentLoaded', () => {
    initTrendChart();
    const loadBins = async () => {
        const { data, error } = await supabase.from('bins').select('*, bin_history(data)');
        if (error) return console.error('Analytics sync failed:', error);
        processAnalytics((data || []).map(bin => ({ ...bin, history: bin.bin_history })));
    };
    loadBins();
    supabase.channel('lgu-analytics-bins')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'bins' }, loadBins)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'bin_history' }, loadBins)
        .subscribe();

    document.getElementById('brgySelector').addEventListener('change', () => {
        loadBins();
    });
});

function initTrendChart() {
    wasteChart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'],
            datasets: [{
                label: 'Waste Volume (%)',
                data: [0, 0, 0, 0, 0, 0, 0],
                borderColor: '#99cc33',
                backgroundColor: 'rgba(153, 204, 51, 0.05)',
                fill: true,
                tension: 0.4
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: { display: false } },
            scales: {
                y: { beginAtZero: true, max: 100, ticks: { stepSize: 25, font: { size: 10 } } },
                x: { ticks: { font: { size: 10 } } }
            }
        }
    });
}

function processAnalytics(bins) {
    const selectedBrgy = document.getElementById('brgySelector').value;
    const filtered = selectedBrgy === 'all' ? bins : bins.filter(b => b.barangay === selectedBrgy);
    
    if (filtered.length === 0) {
        document.getElementById('nudgeEffectiveness').innerText = `0%`;
        document.getElementById('awarenessStatus').innerText = "No active bins detected in " + (selectedBrgy === 'all' ? "the community" : selectedBrgy) + ".";
        document.getElementById('statusIndicator').className = 'status-dot'; 
        wasteChart.data.datasets[0].data = [0, 0, 0, 0, 0, 0, 0];
        wasteChart.update();
        return;
    }

    let totalBinsChecked = filtered.length;
    let compliantBins = 0;

    filtered.forEach(bin => {
        // IMPROVED LOGIC: Real-time Health-First Compliance
        // We evaluate based on the current volume to see if it's currently a health risk.
        const currentVolume = bin.volume || bin.level || 0;
        
        // Compliance = Bin is kept below 75%. 
        // 0% is now considered PERFECT compliance (Citizens/LGU acted quickly).
        if (currentVolume < 75) {
            compliantBins++;
        }
    });

    const effectivenessScore = Math.round((compliantBins / totalBinsChecked) * 100);

    // Update Compliance UI
    document.getElementById('nudgeEffectiveness').innerText = `${effectivenessScore}%`;

    const awarenessStatus = document.getElementById('awarenessStatus');
    const statusIndicator = document.getElementById('statusIndicator');
    const planningAdvice = document.getElementById('planningAdvice');

    if (effectivenessScore >= 75) {
        awarenessStatus.innerText = "High Compliance: Community is successfully preventing overflow and health risks.";
        statusIndicator.className = 'status-dot status-good';
        planningAdvice.innerText = "Strategy: Maintain current collection frequency. The community is responding well.";
    } else {
        awarenessStatus.innerText = "Critical: Bins are staying full in " + selectedBrgy + ", increasing pest risks.";
        statusIndicator.className = 'status-dot status-critical';
        planningAdvice.innerText = "Action Required: Immediate collection needed to prevent disease spread.";
    }

    updateTrendGraph(filtered);
}

function updateTrendGraph(filteredBins) {
    let weeklyAverages = [0, 0, 0, 0, 0, 0, 0];
    let binCounts = [0, 0, 0, 0, 0, 0, 0];

    filteredBins.forEach(bin => {
        const dataPoints = (bin.history && bin.history.data) ? bin.history.data : [bin.volume || 0];
        
        dataPoints.forEach((value, index) => {
            if (index < 7) { 
                weeklyAverages[index] += value;
                binCounts[index] += 1;
            }
        });
    });

    const finalData = weeklyAverages.map((sum, i) => 
        binCounts[i] > 0 ? Math.round(sum / binCounts[i]) : 0
    );

    wasteChart.data.datasets[0].data = finalData;
    wasteChart.update('none'); 
}