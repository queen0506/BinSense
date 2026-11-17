import { supabase } from '../supabase-init.js';
import { initializeLguNotifications } from './lgu-notifications.js';

let wasteChart;
const ctx = document.getElementById('wasteChart').getContext('2d');

initializeLguNotifications(supabase).catch(error => {
    console.error('Unable to initialize LGU notifications:', error);
});

document.addEventListener('DOMContentLoaded', () => {
    initTrendChart();

    const loadBins = async () => {
        const { data, error } = await supabase.from('bins').select('*, bin_history(data)');
        if (error) return console.error('Analytics sync failed:', error);
        processAnalytics((data || []).map(bin => ({ ...bin, history: bin.bin_history })));
    };

        // PAGINATION & FILTER STATE
    let currentPage = 1;
    const pageSize = 10;
    let totalRecords = 0;

    const loadCollectionRecords = async () => {
        const selectedBrgy = document.getElementById('brgySelector').value;
        const dateFilter = document.getElementById('dateFilter').value;
        
        const tbody = document.getElementById('collectionRecordsBody');
        tbody.innerHTML = '<tr><td colspan="4" style="text-align: center; color: #888; padding: 20px;">Loading records...</td></tr>';

        // Calculate Pagination Range
        const from = (currentPage - 1) * pageSize;
        const to = from + pageSize - 1;

        // Base Query (with exact count for pagination)
        let query = supabase.from('collection_records')
            .select(`
                *,
                bins (barangay),
                notifications (barangay)
            `, { count: 'exact' })
            .order('created_at', { ascending: false })
            .range(from, to); 

        // 1. Barangay Filter
        if (selectedBrgy !== 'all') {
            query = query.eq('bins.barangay', selectedBrgy);
        }

        // 2. Date Filter Logic
        if (dateFilter !== 'all') {
            const now = new Date();
            let startDate;

            if (dateFilter === 'today') {
                startDate = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
            } else if (dateFilter === 'week') {
                // Start of the current week (Sunday)
                const firstDay = new Date(now.setDate(now.getDate() - now.getDay()));
                startDate = new Date(firstDay.setHours(0,0,0,0)).toISOString();
            } else if (dateFilter === 'month') {
                // Start of the current month
                startDate = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
            }

            if (startDate) {
                query = query.gte('created_at', startDate);
            }
        }

        const { data, error, count } = await query;
        
        if (error) {
            console.error('Failed to load records:', error);
            tbody.innerHTML = '<tr><td colspan="4" style="text-align: center; color: #ff4444;">Failed to load records.</td></tr>';
            return;
        }

        totalRecords = count || 0;
        updatePaginationUI();

        if (!data || data.length === 0) {
            tbody.innerHTML = '<tr><td colspan="4" style="text-align: center; color: #888; padding: 20px;">No collection records found.</td></tr>';
            return;
        }

                tbody.innerHTML = data.map(rec => {
            let binInfo = 'Unassigned';
            
            if (rec.bin_id) {
                const brgyName = rec.barangay || (rec.bins ? rec.bins.barangay : '');
                binInfo = `${rec.bin_id} <br><span style="color:#888; font-size:0.75rem;">${brgyName}</span>`;
            } 
            else if (rec.barangay) {
                binInfo = `<span style="color:#48742C;">Brgy. ${rec.barangay}</span>`;
            } 
            else if (rec.notifications && rec.notifications.barangay) {
                binInfo = `<span style="color:#48742C;">Brgy. ${rec.notifications.barangay}</span>`;
            }
            
            const dateObj = new Date(rec.created_at);
            const dateStr = dateObj.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
            const timeStr = dateObj.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });

            return `
                <tr>
                    <td style="font-weight: 600;">${binInfo}</td>
                    <td>${dateStr} <br><span style="color:#888; font-size:0.75rem;">${timeStr}</span></td>
                    <td><span class="actual-name">${rec.actual_collector_name}</span></td>
                    <td><span class="registered-name">${rec.registered_collector_name}</span></td>
                </tr>
            `;
        }).join('');
    };

    const updatePaginationUI = () => {
        const totalPages = Math.ceil(totalRecords / pageSize) || 1;
        const pageInfo = document.getElementById('pageInfo');
        const prevBtn = document.getElementById('prevPageBtn');
        const nextBtn = document.getElementById('nextPageBtn');

        pageInfo.textContent = `Page ${currentPage} of ${totalPages}`;
        
        prevBtn.disabled = currentPage === 1;
        nextBtn.disabled = currentPage >= totalPages;
    };

    document.getElementById('prevPageBtn').addEventListener('click', () => {
        if (currentPage > 1) {
            currentPage--;
            loadCollectionRecords();
        }
    });

    document.getElementById('nextPageBtn').addEventListener('click', () => {
        const totalPages = Math.ceil(totalRecords / pageSize);
        if (currentPage < totalPages) {
            currentPage++;
            loadCollectionRecords();
        }
    });

    document.getElementById('dateFilter').addEventListener('change', () => {
        currentPage = 1; 
        loadCollectionRecords();
    });

    loadBins();
    loadCollectionRecords();

    supabase.channel('lgu-analytics-sync')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'bins' }, loadBins)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'bin_history' }, loadBins)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'collection_records' }, loadCollectionRecords)
        .subscribe();

    document.getElementById('brgySelector').addEventListener('change', () => {
        currentPage = 1; 
        loadBins();
        loadCollectionRecords(); 
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