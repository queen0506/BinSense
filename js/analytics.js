import { supabase } from './supabase-init.js';

// --- 1. Chart Initialization ---
const ctx = document.getElementById('binChart').getContext('2d');
const gradient = ctx.createLinearGradient(0, 0, 0, 300);
gradient.addColorStop(0, 'rgba(153, 204, 51, 0.4)');
gradient.addColorStop(1, 'rgba(153, 204, 51, 0)');

const binChart = new Chart(ctx, {
    type: 'line',
    data: {
        labels: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'], // FIXED LABELS
        datasets: [{
            label: 'Avg Daily Fill (%)',
            data: [0, 0, 0, 0, 0, 0, 0], 
            borderColor: '#99cc33',
            borderWidth: 4,
            backgroundColor: gradient,
            fill: true,
            tension: 0.4,
            pointRadius: 5,
            pointBackgroundColor: '#99cc33'
        }]
    },
    options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: {
            y: { 
                beginAtZero: true, 
                max: 100, 
                ticks: { stepSize: 25, callback: (v) => v + '%' } 
            }
        }
    }
});

// --- 2. Auth Initializer ---
document.addEventListener('DOMContentLoaded', async () => {
    const { data: { user } } = await supabase.auth.getUser();

    if (user) {
        // Query user_connected_bins table
        const { data: connectedBins } = await supabase
            .from('user_connected_bins')
            .select('bin_id')
            .eq('user_id', user.id);

        if (connectedBins && connectedBins.length > 0) {
            const firstBinId = connectedBins[0].bin_id;
            startTracking(firstBinId);
        }
    }
});

// --- 3. Persistent Data Logic ---
async function startTracking(activeBinId) {
    const now = new Date();
    // JS: 0=Sun, 1=Mon... Mapping to Mon=0, Tue=1, Sun=6
    const chartIndex = now.getDay() === 0 ? 6 : now.getDay() - 1; 

    // A. Weekly Reset Logic (Prevents daily wipes, persists for 7 days)
    const currentWeek = getWeekNumber(now);
    const lastResetWeek = localStorage.getItem('last_reset_week');

    if (lastResetWeek !== String(currentWeek)) {
        await supabase
            .from('bin_history')
            .upsert({
                bin_id: activeBinId,
                data: [0, 0, 0, 0, 0, 0, 0],
                counts: [0, 0, 0, 0, 0, 0, 0]
            });
        localStorage.setItem('last_reset_week', currentWeek);
    }

    // B. Sync Weekly Data to Chart
    const fetchHistory = async () => {
        const { data: history } = await supabase
            .from('bin_history')
            .select('data, counts')
            .eq('bin_id', activeBinId)
            .single();

        if (history && history.data && history.counts) {
            const averages = history.data.map((total, i) => 
                history.counts[i] > 0 ? Math.round(total / history.counts[i]) : 0
            );
            binChart.data.datasets[0].data = averages;
            binChart.update(); 
        }
    };

    await fetchHistory();

    // Listen for realtime bin_history changes
    supabase
        .channel(`bin-history-${activeBinId}`)
        .on('postgres_changes', { 
            event: '*', 
            schema: 'public', 
            table: 'bin_history', 
            filter: `bin_id=eq.${activeBinId}` 
        }, () => {
            fetchHistory();
        })
        .subscribe();

    // C. Real-time Accumulation
    supabase
        .channel(`bin-status-${activeBinId}`)
        .on('postgres_changes', { 
            event: 'UPDATE', 
            schema: 'public', 
            table: 'bins', 
            filter: `id=eq.${activeBinId}` 
        }, async (payload) => {
            const statusVal = payload.new?.status;
            if (statusVal === null || statusVal === undefined) return;

            let currentLevel = parseStatus(statusVal);

            const { data: snap } = await supabase
                .from('bin_history')
                .select('data, counts')
                .eq('bin_id', activeBinId)
                .single();

            let historyData = snap || { data: [0,0,0,0,0,0,0], counts: [0,0,0,0,0,0,0] };

            // Update ONLY today's specific index
            historyData.data[chartIndex] += currentLevel;
            historyData.counts[chartIndex] += 1;

            await supabase
                .from('bin_history')
                .upsert({
                    bin_id: activeBinId,
                    data: historyData.data,
                    counts: historyData.counts
                });
            
            const todayAvg = Math.round(historyData.data[chartIndex] / historyData.counts[chartIndex]);
            updateEfficiencyUI(currentLevel, todayAvg);
        })
        .subscribe();
}

// --- 4. Helpers ---
function getWeekNumber(d) {
    d = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
    d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
    var yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
    return Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
}

function parseStatus(val) {
    const s = String(val).toLowerCase();
    if (s === 'full') return 100;
    if (s === 'filling') return 50;
    if (s === 'available') return 0;
    return parseInt(s.match(/\d+/) || 0);
}

function updateEfficiencyUI(current, avg) {
    const title = document.querySelector('.status-text h3');
    const desc = document.querySelector('.status-text p');
    if (!title || !desc) return;

    if (current >= 90) {
        title.innerText = "Bin is full!";
        desc.innerText = "Your usage is currently peaking. Collect the trash now!";
    } else {
        title.innerText = "You're doing great!";
        desc.innerText = `Today's average usage is ${avg}%. Keep collecting responsibly!`;
    }
}